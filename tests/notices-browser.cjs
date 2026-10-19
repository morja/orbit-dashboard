const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

(async () => {
  const fixture = spawn(process.env.ORBIT_TEST_PYTHON || 'python3', [path.join(__dirname, 'serve_dashboard_fixture.py')]);
  fixture.stderr.on('data', data => process.stderr.write(data));
  let browser;
  try {
    const lines = readline.createInterface({ input: fixture.stdout });
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture did not start')), 15000);
      lines.once('line', line => { clearTimeout(timeout); resolve(JSON.parse(line)); });
      fixture.once('exit', code => { clearTimeout(timeout); reject(new Error('Fixture exited: ' + code)); });
    });
    browser = await chromium.launch({ executablePath: process.env.ORBIT_BROWSER_EXECUTABLE || undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const baseline = await (await page.request.get(ready.url + '/api/state')).json();
    const clean = structuredClone(baseline);
    clean.projects_checked_at = new Date().toISOString();
    clean.project_errors = [];
    clean.errors = {};
    clean.ddev.error = null;
    let snapshot = clean;
    await page.route('**/api/state', route => route.fulfill({ json: snapshot }));
    await page.goto(ready.url + '/#key=' + ready.key);
    await page.waitForSelector('#project-table tbody tr');
    const button = page.locator('#notices-toggle');
    const panel = page.locator('#notices-panel');
    const open = () => panel.evaluate(el => el.matches(':popover-open'));
    const apply = async data => {
      snapshot = data;
      await page.evaluate(async data => {
        (await import('/js/store.js')).store.data = data;
        (await import('/js/render.js')).render({ force: true });
      }, data);
    };
    const contentTop = () => page.locator('#content').evaluate(el => el.firstElementChild.getBoundingClientRect().top);
    const initialTop = await contentTop();
    assert(await page.locator('#notices-count').isHidden());
    const freshnessCases = await page.evaluate(async data => {
      const { projectFreshness } = await import('/js/freshness.js');
      const now = Date.now();
      const delayed = { ...data, projects_checked_at: new Date(now - 9 * 60000).toISOString(),
        config: { ...data.config, projects_background_enabled: true, intervals: { ...data.config.intervals, projects: 600 } } };
      return [
        projectFreshness(delayed, now).stale,
        projectFreshness({ ...delayed, config: { ...delayed.config, projects_background_enabled: false } }, now).stale,
        projectFreshness({ ...data, projects_checked_at: 'invalid' }, now).stale,
      ];
    }, clean);
    assert.deepEqual(freshnessCases, [false, true, true], 'Freshness must respect configurable background checks, paused checks and invalid timestamps');
    await button.click();
    assert(await open());
    assert.match(await panel.innerText(), /No current notices/);
    await page.keyboard.press('Escape');
    assert.equal(await open(), false);
    assert(await button.evaluate(el => el === document.activeElement));

    // A normal five-minute background interval must not produce stale warnings.
    const aging = { ...clean, config: { ...clean.config, projects_background_enabled: true,
      intervals: { ...clean.config.intervals, projects: 300 } },
      projects_checked_at: new Date(Date.now() - 4 * 60000).toISOString() };
    await apply(aging);
    assert.match(await page.locator('#live-label').innerText(), /Projects · checked 4 min ago/);
    assert.equal(await page.locator('#live-label').getAttribute('data-freshness'), 'current');
    assert(await page.locator('#notices-count').isHidden());
    const old = { ...aging, projects_checked_at: new Date(Date.now() - 20 * 60000).toISOString() };
    await apply(old);
    assert.match(await page.locator('#live-label').innerText(), /Older project data · checked 20 min ago/);
    assert.equal(await page.locator('#live-label').getAttribute('data-freshness'), 'stale');
    assert.equal(await page.locator('#notices-count').innerText(), '1');
    await apply({ ...old, checking: ['projects'] });
    assert.match(await page.locator('#live-label').innerText(), /Updating projects · checked 20 min ago/);

    // Foreground state is fetched after activity registration, then checks are polled quickly.
    await apply(aging);
    let activityRegistered = false;
    let readTooEarly = false;
    let finishTimer;
    await page.unroute('**/api/state');
    await page.route('**/api/state', route => {
      if (!activityRegistered) readTooEarly = true;
      return route.fulfill({ json: snapshot });
    });
    await page.route('**/api/activity', async route => {
      if (route.request().postDataJSON().active) {
        await new Promise(resolve => setTimeout(resolve, 100));
        activityRegistered = true;
        snapshot = { ...aging, checking: ['projects'] };
        finishTimer = setTimeout(() => { snapshot = { ...aging, checking: [], projects_checked_at: new Date().toISOString() }; }, 500);
      }
      await route.fulfill({ json: { ok: true } });
    });
    await page.evaluate(() => {
      window.orbitWindowActive = true;
      window.dispatchEvent(new Event('orbit-activity'));
    });
    await page.waitForFunction(() => document.getElementById('live-label').textContent.includes('Updating projects'));
    await page.waitForFunction(() => document.getElementById('live-label').textContent.includes('Projects · just checked'), null, { timeout: 4000 });
    assert.equal(readTooEarly, false, 'Foreground checks must be registered before fetching cached state');
    clearTimeout(finishTimer);
    await page.unroute('**/api/activity');
    await page.unroute('**/api/state');
    await page.route('**/api/state', route => route.fulfill({ json: snapshot }));
    await page.evaluate(() => { delete window.orbitWindowActive; });
    await apply(clean);

    const warning = structuredClone(clean);
    warning.ddev.error = 'DDEV is unavailable. Docker may be stopped or unreachable.';
    warning.projects_checked_at = new Date(Date.now() - 3600 * 1000).toISOString();
    await apply(warning);
    assert.equal(await page.locator('#notices-count').innerText(), '2');
    assert.equal(await contentTop(), initialTop, 'Notices must not move dashboard content');
    assert.equal(await page.locator('#content > .notice, #connection-error').count(), 0);
    await button.click();
    await page.waitForFunction(() => document.getElementById('notices-toggle').getAttribute('aria-expanded') === 'true');
    assert.match(await panel.innerText(), /DDEV is unavailable/);
    assert.match(await panel.innerText(), /Git and project values are out of date/);
    assert.equal(await panel.locator('.attention-row').count(), 2);
    await panel.locator('a').first().focus();
    assert(await page.evaluate(async () => {
      const link = document.activeElement;
      (await import('/js/render.js')).render();
      return link === document.activeElement && link.isConnected;
    }), 'Unchanged polling must preserve focused links');

    await apply({ ...warning, ddev: clean.ddev });
    assert(await open());
    assert.equal(await page.locator('#notices-count').innerText(), '1');
    assert(await panel.locator('button').evaluate(el => el === document.activeElement), 'A resolved focused notice returns focus to Close');
    await apply(clean);
    assert.match(await panel.innerText(), /No current notices/);
    await page.locator('#title').click();
    assert.equal(await open(), false, 'Outside click closes the panel');

    // Workspace text remains text, and repeated notices are grouped once.
    const hostile = 'Project folder is unavailable: /example/<img src=x onerror="window.injected=true">';
    await apply({ ...clean, project_errors: [hostile, hostile] });
    await button.click();
    assert.equal(await panel.locator('.attention-row').count(), 1);
    assert.equal(await panel.locator('img, script').count(), 0);
    assert.match(await panel.innerText(), /<img src=x/);
    await page.keyboard.press('Escape');

    // Connection failures stay visible through a red badge and the existing status.
    await apply(clean);
    await page.unroute('**/api/state');
    await page.route('**/api/state', route => route.fulfill({ status: 503, json: { error: 'Offline' } }));
    await page.evaluate(async () => (await import('/js/refresh.js')).poll());
    assert.equal(await button.getAttribute('data-level'), 'error');
    assert.match(await page.locator('#live-label').innerText(), /Connection lost/);
    assert.match(await page.locator('#notices-announcement').innerText(), /connection was lost/);
    await button.click();
    assert.match(await panel.innerText(), /last values remain visible/);
    await page.unroute('**/api/state');
    await page.route('**/api/state', route => route.fulfill({ status: 304 }));
    await page.evaluate(async () => (await import('/js/refresh.js')).poll());
    assert.equal(await button.getAttribute('data-level'), 'clear');
    assert(!(await page.locator('#live-label').innerText()).includes('Connection lost'));
    await page.keyboard.press('Escape');
    await page.unroute('**/api/state');
    await page.route('**/api/state', route => route.fulfill({ json: snapshot }));

    // The utility is reachable in both languages, themes and sidebar modes, at high zoom.
    for (const language of ['en', 'de']) {
      for (const theme of ['light', 'dark']) {
        for (const width of [1440, 390]) {
          for (const zoom of [100, 200]) {
            await page.setViewportSize({ width, height: 1000 });
            await apply({ ...warning, config: { ...warning.config, language, theme, zoom } });
            for (const sidebar of ['expanded', 'collapsed']) {
              await page.evaluate(sidebar => { document.body.dataset.sidebar = sidebar; }, sidebar);
              assert(await button.isVisible());
              assert(await page.locator('#notices-count').isVisible());
              if (width === 390 && zoom === 100) {
                const boxes = await page.evaluate(() => {
                  const brand = document.querySelector('.brand').getBoundingClientRect();
                  const nav = document.querySelector('.sidebar nav').getBoundingClientRect();
                  const utility = document.getElementById('notices-toggle').getBoundingClientRect();
                  return { brandRight: brand.right, navLeft: nav.left, navRight: nav.right, utilityLeft: utility.left };
                });
                assert(boxes.brandRight <= boxes.navLeft + 1 && boxes.navRight <= boxes.utilityLeft + 1,
                  `Mobile navigation must not overlap: ${JSON.stringify(boxes)}`);
              }
              await button.click();
              assert(await open());
              assert.match(await panel.locator('h2').innerText(), language === 'en' ? /Notices/ : /Hinweise/);
              assert.match(await page.locator('#live-label').innerText(), language === 'en' ? /Older project data/ : /Ältere Projektwerte/);
              await page.waitForFunction(() => {
                const box = document.getElementById('notices-panel').getBoundingClientRect();
                return box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
              });
              const box = await panel.boundingBox();
              assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 1001,
                `Notice panel must fit: ${JSON.stringify({language, theme, width, zoom, sidebar, box})}`);
              if (language === 'en' && zoom === 100 && sidebar === 'expanded') {
                await page.screenshot({ path: path.join(os.tmpdir(), `orbit-notices-${theme}-${width}.png`) });
              }
              await page.keyboard.press('Escape');
            }
          }
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 600 });
    await apply({ ...clean, project_errors: Array.from({length: 40}, (_, index) => `Project folder is unavailable: /example/${index}/` + 'long-path/'.repeat(20)) });
    await page.evaluate(() => { document.body.dataset.sidebar = 'expanded'; });
    await button.click();
    await page.waitForFunction(() => {
      const box = document.getElementById('notices-panel').getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight + 1;
    });
    assert(await page.locator('#notices-list').evaluate(el => el.scrollHeight > el.clientHeight), 'Long notice lists scroll inside the panel');
    assert(await page.evaluate(async () => {
      const list = document.getElementById('notices-list');
      list.scrollTop = 500;
      const before = list.scrollTop;
      (await import('/js/render.js')).render();
      return list.scrollTop === before;
    }), 'Polling preserves the notice list scroll position');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await apply({ ...warning, config: { ...warning.config, theme: 'light' } });
    await page.evaluate(() => { document.body.dataset.sidebar = 'expanded'; });
    await button.click();
    await panel.locator('a[href="#docker"]').click();
    await page.waitForFunction(() => document.body.dataset.view === 'docker');
    assert.equal(await open(), false, 'A detail link closes the notice panel');
    assert.deepEqual(errors, []);
    console.log('Notices passed: no content shift, keyboard, outside click, focus, resolution, escaping, connection recovery, languages, themes, collapsed sidebar, narrow layout and zoom.');
  } finally {
    await browser?.close();
    fixture.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
