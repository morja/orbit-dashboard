const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const assert = require('node:assert/strict');

// Synthetic pages and refresh scripts only; see serve_custom_pages_fixture.py.
(async () => {
  const fixture = spawn(process.env.ORBIT_TEST_PYTHON || 'python3', [path.join(__dirname, 'serve_custom_pages_fixture.py')]);
  fixture.stderr.on('data', (data) => {
    const text = String(data);
    if (!/"(GET|POST) [^"]+" (200|304|400|404|409|502)/.test(text)) process.stderr.write(text);
  });
  let browser;
  try {
    const lines = readline.createInterface({ input: fixture.stdout });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture did not start')), 10000);
      lines.once('line', (line) => { clearTimeout(timer); resolve(JSON.parse(line)); });
      fixture.once('exit', (code) => { clearTimeout(timer); reject(new Error('Fixture exited: ' + code)); });
    });
    browser = await chromium.launch({ executablePath: process.env.ORBIT_BROWSER_EXECUTABLE || undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shot = (name) => page.screenshot({ path: path.join(os.tmpdir(), `orbit-custom-pages-${name}.png`) });
    const settings = async () => (await (await page.request.get(ready.url + '/api/settings')).json()).custom_pages;
    const frameElement = page.locator('#content .custom-page-frame');
    const pageFrame = () => page.frames().find((frame) => frame.url().includes('/api/custom-pages/'));
    const frameText = async () => (await pageFrame()?.evaluate(() => document.body?.innerText).catch(() => '')) || '';
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

    await page.goto(ready.url + '/#key=' + ready.key);
    await page.waitForSelector('#custom-pages-nav a');

    // Sidebar: one entry per enabled page, after the built-in destinations, with the page icon.
    const links = page.locator('#custom-pages-nav a');
    assert.deepEqual(await links.allInnerTexts(), ['Status board', 'Failing page', 'Not yet generated', 'Static <b>page</b>']);
    assert.equal(await links.first().locator('svg path').count(), 2);
    assert.equal(await page.locator('nav a[data-view="storage"] + #custom-pages-nav').count(), 1);
    assert.equal(await page.locator('#page-refresh').isVisible(), false);

    // Page view: name, generated time, own Refresh, sandboxed frame with appearance parameters.
    await links.first().click();
    await page.waitForFunction(() => location.hash === '#page?id=status');
    await frameElement.waitFor();
    assert.equal(await page.locator('#title').innerText(), 'Status board');
    assert.match(await page.locator('#page-generated').innerText(), /^Generated .+ ago$|^Generated now$/);
    assert.equal(await page.locator('#page-refresh').isVisible(), true);
    assert.equal(await page.locator('#refresh').isVisible(), false);
    assert.equal(await page.locator('#live-label').isVisible(), false);
    assert.equal(await frameElement.getAttribute('sandbox'), 'allow-scripts');
    const source = new URL(await frameElement.getAttribute('src'), ready.url);
    assert.equal(source.pathname, '/api/custom-pages/status');
    assert.deepEqual(Object.fromEntries(source.searchParams), { theme: 'light', palette: 'orbit', scale: '1' });
    assert.equal(await links.first().getAttribute('class'), 'active');
    await page.waitForTimeout(300);
    assert.match(await frameText(), /Version 1/);
    assert.equal(await pageFrame().evaluate(() => document.documentElement.dataset.theme), 'light');

    // The page cannot reach Orbit: opaque origin, no parent DOM, no network.
    const isolation = await pageFrame().evaluate(async () => {
      let parentAccess = 'blocked';
      try { parentAccess = parent.document.title ? 'open' : 'open'; } catch { parentAccess = 'blocked'; }
      let network = 'blocked';
      try { await fetch('/api/state'); network = 'open'; } catch { network = 'blocked'; }
      let storage = 'blocked';
      try { localStorage.getItem('orbit-action-key'); storage = 'open'; } catch { storage = 'blocked'; }
      return { origin: origin, parentAccess, network, storage };
    });
    assert.deepEqual(isolation, { origin: 'null', parentAccess: 'blocked', network: 'blocked', storage: 'blocked' });
    await shot('light');

    // Direct links keep the selection on reload.
    await page.reload();
    await frameElement.waitFor();
    assert.equal(await page.locator('#title').innerText(), 'Status board');
    assert.equal(await page.locator('#custom-pages-nav a.active').innerText(), 'Status board');

    // Refresh: busy button while the command runs, then a new file version and a toast.
    await page.locator('#page-refresh').click();
    await page.waitForSelector('#page-refresh.busy');
    assert.equal(await page.locator('#page-refresh').isDisabled(), true);
    await page.waitForSelector('#page-refresh:not(.busy)', { timeout: 10000 });
    assert.equal(await page.locator('#toast').innerText(), 'Page refreshed.');
    await page.waitForFunction(() => document.querySelector('.custom-page-frame'));
    await page.waitForTimeout(400);
    assert.match(await frameText(), /Version 2/);

    // Failure: the error and the last stderr lines stay visible above the last good page.
    await page.locator('#custom-pages-nav a[data-page-id="failing"]').click();
    await frameElement.waitFor();
    await page.locator('#page-refresh').click();
    const failure = page.locator('.custom-page-error');
    await failure.waitFor({ timeout: 10000 });
    assert.match(await failure.innerText(), /exit code 3/);
    assert.match(await failure.innerText(), /synthetic failure: data source unavailable/);
    assert.equal(await frameElement.count(), 1);
    await shot('error');

    // Missing file: a quiet empty state, with Refresh only when a command exists.
    await page.locator('#custom-pages-nav a[data-page-id="static"]').click();
    await page.waitForSelector('.custom-page-empty');
    assert.match(await page.locator('.custom-page-empty').innerText(), /No page generated yet/);
    assert.equal(await page.locator('.custom-page-generate').count(), 0);
    assert.equal(await page.locator('#page-refresh').isVisible(), false);
    assert.equal(await page.locator('#page-generated').innerText(), 'Not generated yet');
    assert.equal(await page.locator('#title').innerText(), 'Static <b>page</b>');
    await page.locator('#custom-pages-nav a[data-page-id="later"]').click();
    await page.locator('.custom-page-generate').click();
    await frameElement.waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    assert.match(await frameText(), /Version later/);

    // Unknown IDs show a notice instead of an error page.
    await page.goto(ready.url + '/#page?id=unknown');
    await page.waitForSelector('.custom-page-empty');
    assert.match(await page.locator('.custom-page-empty').innerText(), /This page is not available/);

    // Appearance changes reach the page: preview in Settings, Cancel restores, Save keeps.
    await page.goto(ready.url + '/#page?id=status');
    await frameElement.waitFor();
    await page.locator('#settings-topbar').click();
    await page.locator('#setting-theme').selectOption('dark');
    await page.waitForFunction(() => document.querySelector('.custom-page-frame').src.includes('theme=dark'));
    await page.locator('.close-settings').first().click();
    await page.waitForFunction(() => document.querySelector('.custom-page-frame').src.includes('theme=light'));
    await page.locator('#settings-topbar').click();
    await page.locator('#setting-theme').selectOption('dark');
    await page.locator('#setting-palette').selectOption('ocean');
    await page.locator('#setting-font_size').selectOption('120');
    await page.locator('#save-settings').click();
    await page.waitForSelector('#settings-dialog', { state: 'hidden' });
    await frameElement.waitFor();
    await page.waitForFunction(() => document.querySelector('.custom-page-frame').src.includes('theme=dark&palette=ocean&scale=1.2'));
    await page.waitForTimeout(400);
    assert.equal(await pageFrame().evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await pageFrame().evaluate(() => document.documentElement.dataset.palette), 'ocean');
    await shot('dark');

    // Settings: list, reorder, rename, disable, remove and add.
    await page.locator('#settings-topbar').click();
    await page.locator('[data-settings-tab="tools"]').click();
    const rows = page.locator('.settings-custom-page');
    assert.equal(await rows.count(), 4);
    assert.equal(await rows.nth(0).locator('[data-page="name"]').inputValue(), 'Status board');
    await page.locator('#add-custom-page').scrollIntoViewIfNeeded();
    await shot('settings-dark');
    await rows.nth(1).locator('[data-move="-1"]').click();
    assert.equal(await rows.nth(0).locator('[data-page="name"]').inputValue(), 'Failing page');
    await rows.nth(0).locator('[data-move="1"]').click();
    assert.equal(await rows.nth(1).locator('[data-page="name"]').inputValue(), 'Failing page');
    await rows.nth(0).locator('[data-page="name"]').fill('Cockpit status');
    await rows.nth(1).locator('[data-page="enabled"]').uncheck();
    await rows.nth(3).locator('.remove-custom-page').click();
    assert.equal(await rows.count(), 3);
    await page.locator('#add-custom-page').click();
    await rows.nth(3).locator('[data-page="name"]').fill('Added page');
    await rows.nth(3).locator('[data-page="file"]').fill(ready.folder + '/pages/added.html');
    await rows.nth(3).locator('[data-move="-1"]').click();
    // Invalid commands are refused by the backend and keep the dialog open.
    await rows.nth(2).locator('[data-page="refresh_command"]').fill('make-page --all');
    await page.locator('#save-settings').click();
    await page.waitForSelector('#settings-error:not([hidden])');
    assert.match(await page.locator('#settings-error').innerText(), /absolute path to a single executable/);
    await rows.nth(2).locator('[data-page="refresh_command"]').fill('');
    await page.locator('#save-settings').click();
    await page.waitForSelector('#settings-dialog', { state: 'hidden' });
    const saved = await settings();
    assert.deepEqual(saved.map((item) => [item.name, item.enabled]), [
      ['Cockpit status', true], ['Failing page', false], ['Added page', true], ['Not yet generated', true]]);
    assert.equal(saved[0].id, 'status');
    assert.match(saved[2].id, /^[a-f0-9]{12}$/);
    assert.equal(saved[2].refresh_command, '');
    assert.match(saved[3].refresh_command, /make-later$/);
    assert.deepEqual(await links.allInnerTexts(), ['Cockpit status', 'Added page', 'Not yet generated']);
    assert.equal(await page.locator('#title').innerText(), 'Cockpit status');

    // German interface: static and generated text, page names stay unchanged.
    await page.locator('#settings-topbar').click();
    await page.locator('#setting-language').selectOption('de');
    // Automatic appearance lets the narrow checks below follow the emulated system scheme.
    await page.locator('#setting-theme').selectOption('system');
    await page.locator('#save-settings').click();
    await page.waitForSelector('#settings-dialog', { state: 'hidden' });
    await page.waitForFunction(() => document.documentElement.lang === 'de');
    assert.match(await page.locator('#page-generated').innerText(), /^Erzeugt /);
    assert.equal(await page.locator('#page-refresh').innerText(), 'Aktualisieren');
    assert.deepEqual(await links.allInnerTexts(), ['Cockpit status', 'Added page', 'Not yet generated']);
    await page.locator('#custom-pages-nav a').nth(1).click();
    await page.waitForSelector('.custom-page-empty');
    assert.match(await page.locator('.custom-page-empty').innerText(), /Noch keine Seite erzeugt/);
    await page.locator('#settings-topbar').click();
    await page.locator('[data-settings-tab="tools"]').click();
    assert.match(await page.locator('#settings-panel-tools').innerText(), /Eigene Seiten/);
    assert.match(await page.locator('#settings-panel-tools').innerText(), /Befehl zum Aktualisieren/);
    await page.locator('#add-custom-page').scrollIntoViewIfNeeded();
    await shot('settings-german-light');
    await page.locator('.close-settings').first().click();

    // Narrow viewport, in both appearances: no horizontal page scroll, frame within the width.
    await page.goto(ready.url + '/#page?id=status');
    await frameElement.waitFor();
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [390, 700]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(150);
        assert(await noOverflow(), `Page view must not overflow at ${width}px (${scheme})`);
        const box = await frameElement.boundingBox();
        assert(box.width <= width && box.x >= 0, 'The frame stays within the viewport');
        assert.equal(await page.locator('#page-refresh').isVisible(), true);
        assert.equal(await page.locator('#page-generated').isVisible(), true);
      }
      await shot(`narrow-${scheme}`);
    }
    await page.locator('#settings-topbar').click();
    await page.locator('[data-settings-tab="tools"]').click();
    assert(await page.locator('#settings-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await page.locator('.settings-custom-page').first().scrollIntoViewIfNeeded();
    await shot('settings-narrow');
    await page.locator('.close-settings').first().click();

    assert.deepEqual(errors, []);
    console.log('Custom pages passed: sidebar, direct links, sandboxed frame, theme parameters, refresh success/failure/busy, empty states, settings editing, English/German, light/dark and narrow layout.');
  } finally {
    if (browser) await browser.close();
    fixture.kill('SIGTERM');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
