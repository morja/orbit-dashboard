const { chromium } = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

// Dashboard checks against a synthetic workspace; they never read the user's projects or server.
const shot = (name) => path.join(os.tmpdir(), `orbit-${name}.png`);

(async () => {
  const fixture = spawn(process.env.ORBIT_TEST_PYTHON || 'python3', [path.join(__dirname, 'serve_dashboard_fixture.py')]);
  fixture.stderr.on('data', (data) => process.stderr.write(data));
  let browser;
  try {
    const lines = readline.createInterface({ input: fixture.stdout });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture did not start')), 15000);
      lines.once('line', (line) => { clearTimeout(timer); resolve(JSON.parse(line)); });
      fixture.once('exit', (code) => { clearTimeout(timer); reject(new Error('Fixture exited: ' + code)); });
    });
    browser = await chromium.launch({ executablePath: process.env.ORBIT_BROWSER_EXECUTABLE || undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    const names = () => page.locator('#project-table .name-button strong').allTextContents();
    const paths = () => page.locator('.project-path').evaluateAll(items => items.map(node=>node.dataset.fullPath));

    await page.goto(ready.url + '/#key=' + ready.key);
    await page.waitForSelector('#project-table tbody tr');
    // Both Git previews use click-operated dialogs; polling must not replace history.
    let historyRequests = 0;
    page.on('request', request => { if (request.url().endsWith('/commits')) historyRequests++; });
    const historyButton = page.locator('.branch-history').first();
    await historyButton.hover();
    await page.waitForSelector('#git-mini-preview:not([hidden])');
    assert.equal(await page.locator('#git-mini-preview p').count(), 1);
    assert.equal(await page.locator('#git-mini-preview script').count(), 0);
    assert.match(await page.locator('#git-mini-preview small').innerText(), /ago/);
    await historyButton.click();
    assert(await page.locator('#git-mini-preview').isHidden());
    await page.waitForSelector('#git-dialog .git-history > div');
    assert.equal(await page.locator('#git-dialog .git-history > div').count(), 10);
    assert.equal(await page.locator('#git-dialog script').count(), 0);
    const stable = await page.evaluate(async () => {
      const dialog = document.getElementById('git-dialog');
      const html = dialog.innerHTML;
      for (let i = 0; i < 3; i++) (await import('/js/render.js')).render();
      return dialog.open && dialog.innerHTML === html;
    });
    assert(stable, 'History dialog must remain unchanged during polling redraws');
    assert.equal(historyRequests, 1);
    await page.keyboard.press('Escape');
    await historyButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#git-dialog[open] .git-history');
    assert.equal(historyRequests, 1, 'Repeated openings use cached history');
    const historyFrame = await page.locator('#git-dialog').boundingBox();
    await page.locator('[data-git-tab="files"]').click();
    assert.deepEqual(await page.locator('#git-dialog').boundingBox(), historyFrame, 'Switching Git tabs must keep the dialog frame unchanged');
    assert.equal(await page.locator('[data-git-tab="files"]').getAttribute('aria-selected'), 'true');
    assert(await page.locator('.git-status-summary').innerText());
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('#git-dialog .git-history');
    assert.equal(historyRequests, 1, 'Tabs share the history cache');

    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({width:390,height:780});
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty('--ui-zoom','1.5'); }, theme);
      const bounds = await page.locator('#git-dialog').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    }
    await page.locator('.close-git').click();
    await page.setViewportSize({width:1440,height:1100});
    await page.evaluate(() => { document.documentElement.dataset.theme='light'; document.documentElement.style.setProperty('--ui-zoom','1'); });
    // Service annotations persist on the backend; filters separate origin and scope.
    await page.locator('nav [data-view="services"]').click();
    const serviceRows = page.locator('[data-service-id]');
    await page.waitForSelector('[data-service-id]');
    assert.equal(await serviceRows.count(), 4);
    assert(await serviceRows.locator('td:nth-child(3)').evaluateAll(cells => cells.every(cell => [...cell.childNodes].every(node => node.nodeType !== Node.TEXT_NODE || node.textContent.trim() !== '0'))), 'A missing PID must not render a stray zero');
    assert(await page.locator('.service-program > div').evaluateAll(items => items.every(node => node.scrollWidth <= node.clientWidth + 1)), 'Long program paths must not overflow into the Details column');
    assert(await serviceRows.evaluateAll(rows => rows.every(row => [...row.cells].every(cell => {
      const bounds = cell.getBoundingClientRect();
      return [...cell.children].every(child => child.getBoundingClientRect().right <= bounds.right + 1);
    }))), 'Service content must remain inside its own table cell');
    await page.locator('[data-service-filter="origin"]').selectOption('own');
    assert.equal(await serviceRows.count(), 1, 'My services must include automatically detected custom services');
    await page.locator('[data-service-filter="status"]').selectOption('running');
    assert.equal(await serviceRows.count(), 0);
    await page.locator('#services-show-own').click();
    assert.equal(await serviceRows.count(), 1);
    assert.equal(await page.locator('[data-service-filter="origin"]').inputValue(), 'own');
    assert.equal(await page.locator('[data-service-filter="status"]').inputValue(), 'all');
    await page.locator('#services-reset').click();
    assert.equal(await serviceRows.filter({hasText: 'broken-worker'}).locator('.badge.red').count(), 1);
    await page.locator('[data-service-filter="scope"]').selectOption('system');
    assert.equal(await serviceRows.count(), 2);
    await page.locator('[data-service-filter="origin"]').selectOption('apple');
    assert.equal(await serviceRows.count(), 1);
    await page.locator('#services-reset').click();
    const backup = serviceRows.filter({hasText: 'custom-backup'});
    await backup.locator('[data-service-edit]').click();
    assert.match(await page.locator('#service-facts').innerText(), /VeryLongFrameworkName/);
    assert(await page.locator('#service-form').evaluate(form => parseFloat(getComputedStyle(form).rowGap) <= 10), 'Service details must use compact section spacing');
    assert(await page.locator('#service-form label').evaluateAll(labels => labels.every(label => parseFloat(getComputedStyle(label).marginTop) <= 4)), 'Service labels must not add large margins');
    await page.screenshot({path: shot('service-details-compact')});
    assert.equal(await page.locator('#service-own').isChecked(), true);
    await page.locator('#service-own').uncheck();
    await page.locator('#service-save').click();
    await page.waitForFunction(() => !document.getElementById('service-dialog').open);
    await page.locator('[data-service-filter="origin"]').selectOption('own');
    assert.equal(await serviceRows.count(), 0, 'Manual exclusion must override automatic ownership');
    assert.match(await page.locator('#content').innerText(), /Reset the other filters/);
    await page.locator('#services-reset').click();
    await backup.locator('[data-service-edit]').click();
    assert.equal(await backup.locator('.service-name strong').innerText(), 'backup.sh');
    await page.locator('#service-description').fill('My backup <script>literal</script>');
    await page.locator('#service-own').check();
    await page.locator('#service-favorite').check();
    await page.locator('#service-save').click();
    await page.waitForFunction(() => !document.getElementById('service-dialog').open);
    await page.reload();
    await page.waitForSelector('[data-service-id]');
    assert.match(await backup.innerText(), /My backup <script>literal<\/script>/);
    assert.equal(await backup.locator('script').count(), 0);
    await page.locator('[data-service-filter="origin"]').selectOption('own');
    assert.equal(await serviceRows.count(), 1);
    await page.reload();
    await page.waitForSelector('[data-service-id]');
    assert.equal(await serviceRows.count(), 1);
    assert.equal(await page.locator('[data-service-filter="origin"]').inputValue(), 'own');
    await page.locator('#services-reset').click();
    for (const language of ['en', 'de']) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(async ({language, theme}) => {
          Object.assign((await import('/js/store.js')).store.data.config, {language, theme});
          (await import('/js/render.js')).render();
        }, {language, theme});
        assert.match(await backup.innerText(), language === 'en' ? /Waiting for next start/ : /Wartet auf nächsten Start/);
        assert(await serviceRows.evaluateAll(rows => rows.every(row => [...row.cells].every(cell => cell.scrollWidth <= cell.clientWidth + 1))), 'Service cells must not overflow at desktop width');
        await page.screenshot({path: shot('services-desktop-' + language + '-' + theme), fullPage: true});
        await page.setViewportSize({width: 390, height: 844});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({path: shot('services-' + language + '-' + theme), fullPage: true});
        await page.setViewportSize({width: 1440, height: 1100});
      }
    }
    await page.locator('nav [data-view="overview"]').click();
    assert.match(await page.locator('.service-summary').innerText(), /My backup/);
    const cardFonts = await page.evaluate(() => {
      const font = selector => getComputedStyle(document.querySelector(selector)).fontSize;
      return {favoriteTitle: font('.favorite-services h2'), attentionTitle: font('.overview-attention h2'),
        favoriteText: font('.service-summary strong'), attentionText: font('.overview-attention .attention-row strong'),
        favoriteStatus: font('.service-summary p'), attentionDescription: font('.overview-attention .attention-row p')};
    });
    assert.equal(cardFonts.favoriteTitle, cardFonts.attentionTitle);
    assert.equal(cardFonts.favoriteText, cardFonts.attentionText);
    assert.equal(cardFonts.favoriteStatus, cardFonts.attentionDescription);
    await page.locator('.overview-rail').screenshot({path: '/private/tmp/orbit-style-audit.png'});
    assert.notEqual(await page.locator('nav [data-view="services"] svg').innerHTML(), await page.locator('.overview-attention h2 svg').innerHTML());

    await page.evaluate(async () => {
      Object.assign((await import('/js/store.js')).store.data.config, {language: 'en', theme: 'light'});
      (await import('/js/render.js')).render();
    });
    // Remote states stay distinguishable in both languages and appearances.
    for (const language of ['en', 'de']) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(async ({language, theme}) => {
          Object.assign((await import('/js/store.js')).store.data.config, {language, theme});
          (await import('/js/render.js')).render();
        }, {language, theme});
        const row = name => page.locator('#project-table tbody tr').filter({hasText: name});
        assert.equal(await row('shop').locator('.remote-state').innerText(), language === 'en' ? 'No remote' : 'Kein Remote');
        assert.equal(await row('intranet').locator('.remote-state').innerText(), language === 'en' ? 'No tracking branch' : 'Kein Tracking-Branch');
        assert.equal(await row('alpha-app').locator('.remote-state').innerText(), language === 'en' ? 'In sync' : 'Synchron');
        assert.equal(await row('portal').locator('.remote-state').innerText(), language === 'en' ? 'Comparison unavailable' : 'Vergleich nicht verfügbar');
        assert.match(await row('beta-site').locator('.branch').innerText(), /↑2.*↓1/);
        assert.equal(await row('beta-site').locator('.remote-state').count(), 0);
        assert(await page.locator('.remote-state').evaluateAll(items => items.every(el => {
          const branch = el.closest('.branch');
          if (!branch) return false;
          const status = el.getBoundingClientRect();
          const line = branch.getBoundingClientRect();
          return status.top >= line.top && status.bottom <= line.bottom + 1;
        })), 'Remote status must share the branch line');
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        await page.screenshot({path:shot(`remote-${language}-${theme}`),fullPage:true});
      }
    }
    await page.evaluate(async () => {
      Object.assign((await import('/js/store.js')).store.data.config, {language: 'en', theme: 'system'});
      (await import('/js/render.js')).render();
    });
    await page.locator('#search').focus();
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      store.view = 'projects';
      store.data.projects = Array.from({length:80},(_,i)=>({...store.data.projects[0],id:'scroll-'+i,name:'Scroll project '+i}));
      (await import('/js/render.js')).render();
      window.scrollTo(0,800);
    });
    const beforeRefresh = await page.evaluate(()=>window.scrollY);
    assert(beforeRefresh > 400,'Test page must be scrolled');
    await page.evaluate(async () => (await import('/js/render.js')).render());
    assert.equal(await page.evaluate(()=>window.scrollY),beforeRefresh,'Refreshing while search retains focus must preserve scroll');
    await page.reload();
    await page.waitForSelector('#project-table tbody tr');
    await page.setViewportSize({width:2200,height:1100});
    const controls = await page.locator('#search, #status-filters, #group').evaluateAll(items => items.map(el=>{const box=el.getBoundingClientRect();return box.top+box.height/2}));
    assert(Math.max(...controls)-Math.min(...controls)<2,'Search, filters and group must share a row when space is available');
    assert.match(await page.locator('.modified-cell').first().innerText(), /ago$/);
    assert.match(await page.locator('.modified-cell').first().getAttribute('title'), /\d{1,2}:\d{2}:\d{2}/);
    const relative = await page.evaluate(async () => {
      const {relativeTime} = await import('/js/format.js');
      const now = 1800000000000;
      const {setLanguage} = await import('/js/i18n.js');
      const english = [7200, 259200].map(age => relativeTime(now / 1000 - age, now));
      setLanguage('de');
      const german = [7200, 259200].map(age => relativeTime(now / 1000 - age, now));
      setLanguage('en');
      return [...english, ...german];
    });
    assert.deepEqual(relative, ['2 hours ago', '3 days ago', 'vor 2 Stunden', 'vor 3 Tagen']);
    await page.setViewportSize({width:1440,height:1100});
    const headings = await page.locator('#project-table thead th').allTextContents();
    assert(headings.indexOf('Last changed↓') > headings.findIndex(text=>text.startsWith('Git status')));
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      store.data.config.ddev_enabled = false;
      store.data.config.show_next_step = false;
      (await import('/js/render.js')).render();
    });
    assert.equal(await page.locator('[data-sort="ddev"], [data-sort="next_step"]').count(),0);
    assert.equal(await page.locator('.next-cell, .ddev-cell').count(),0);
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      store.data.config.ddev_enabled = true;
      store.data.config.show_next_step = true;
      (await import('/js/render.js')).render();
    });

    assert.equal(new URL(page.url()).hash, '#overview');
    assert.equal(await page.locator('#title').innerText(), 'Overview');
    assert.equal(await page.locator('.page-heading').isVisible(), false);
    assert.match(await page.locator('.server-metric').innerText(), /Moon.*54.4.*GiB free/s);
    assert.match(await page.locator('.overview-server').innerText(), /Free space.*54.4 GiB/s);
    assert(!(await page.locator('.overview-server').innerText()).includes('Last completion'));
    await page.locator('.server-services summary').first().click();
    await page.waitForSelector('.server-services[open]');
    await page.evaluate(async () => (await import('/js/render.js')).render());
    assert(await page.locator('.server-services').first().evaluate(el=>el.open), 'Expanded services survive refresh');
    await page.locator('.server-services summary').first().click();

    await page.setViewportSize({width:1180,height:760});
    const position = await page.evaluate(() => ({
      projects: document.querySelector('.overview-workspace>.project-section').getBoundingClientRect(),
      rail: document.querySelector('.overview-rail').getBoundingClientRect(),
      strip: document.querySelector('.overview-status').getBoundingClientRect(),
      first: document.querySelector('#project-table tbody tr').getBoundingClientRect().top,
    })).catch(() => null);
    assert(position);
    assert(position.first < 600, 'Projects start within the laptop viewport');
    assert.equal(await page.locator('.overview-status .metric').evaluateAll(items => new Set(items.map(el=>Math.round(el.getBoundingClientRect().top))).size),1);
    assert(await page.locator('.overview-rail').evaluate(el => el.getBoundingClientRect().left > document.querySelector('.overview-workspace>.project-section').getBoundingClientRect().left));
    await page.screenshot({path:shot('overview-laptop'),fullPage:true});
    await page.setViewportSize({width:3840,height:1600});
    assert(await page.locator('main').evaluate(el=>el.getBoundingClientRect().right>innerWidth-100));
    await page.screenshot({path:shot('overview-large'),fullPage:true});
    await page.setViewportSize({width:1440,height:1100});
    await page.screenshot({ path: shot('overview'), fullPage: true });

    // Sorting uses only the column headers.
    // Views switch through the address, so wait for the overview tiles to leave.
    await page.locator('nav a[data-view="projects"]').click();
    await page.waitForSelector('.metrics', { state: 'detached' });
    assert.equal(await page.locator('[data-sort="activity"]').locator('..').getAttribute('aria-sort'), 'descending');
    await page.evaluate(async () => {
      const node = document.querySelector('.project-path');
      node.dataset.displayPath = '~/Work/' + 'nested-directory/'.repeat(30) + 'project-name';
      node.title = node.dataset.displayPath;
      (await import('/js/paths.js')).fitProjectPaths();
    });
    const pathLabel = page.locator('.project-path').first();
    assert.match(await pathLabel.innerText(), /^~\/Work\/.*….*project-name$/);
    assert((await pathLabel.getAttribute('title')).length>400);
    assert(await pathLabel.evaluate(node=>node.scrollWidth<=node.clientWidth+1));

    for (const name of ['old-site', 'legacy-api', 'gamma-tool']) assert(!(await names()).includes(name));
    await page.locator('[data-sort="name"]').click();
    assert.equal(await page.locator('[data-sort="name"]').locator('..').getAttribute('aria-sort'), 'ascending');
    let shown = await names();
    assert.deepEqual(shown, [...shown].sort((a, b) => a.localeCompare(b, 'en-US')));
    await page.locator('[data-sort="name"]').click();
    shown = await names();
    assert.deepEqual(shown, [...shown].sort((a, b) => b.localeCompare(a, 'en-US')));
    for (const key of ['size', 'git', 'ddev', 'activity', 'next_step']) {
      await page.locator(`[data-sort="${key}"]`).click();
      assert.notEqual(await page.locator(`[data-sort="${key}"]`).locator('..').getAttribute('aria-sort'), 'none');
    }

    await page.locator('.git-preview').first().hover();
    await page.waitForSelector('#git-mini-preview li');
    assert((await page.locator('#git-mini-preview li').count()) <= 3);
    assert.equal(await page.locator('#git-mini-preview strong').innerText(), 'Changed files');
    assert(await page.locator('#git-mini-preview code').evaluateAll(items => items.every(item => {
      const style = getComputedStyle(item);
      return style.whiteSpace === 'nowrap' && style.fontFamily === getComputedStyle(item.closest('.git-mini-preview')).fontFamily;
    })), 'File mini previews must use the shared font without wrapping');

    assert.equal(await page.locator('.git-preview').first().getAttribute('title'), '');
    await page.locator('.git-preview').first().click();
    await page.waitForSelector('#git-dialog[open]');
    assert((await page.locator('#git-dialog .git-files code').count()) <= 12);
    await page.keyboard.press('Escape');

    // Actions send the key from the address.
    let terminalKey;
    await page.route('**/api/projects/*/terminal', async (route) => {
      terminalKey = route.request().headers()['x-orbit-key'];
      await route.fulfill({ json: { ok: true } });
    });
    await page.locator('.open-terminal').first().click();
    await page.waitForTimeout(200);
    assert.equal(terminalKey, ready.key);
    await page.unroute('**/api/projects/*/terminal');

    // The archive switch shows manually archived projects and the archive category.
    assert.equal(await page.locator('[data-category="Archive"]').count(), 0);
    await page.locator('#show-archived').check();
    for (const name of ['old-site', 'legacy-api', 'gamma-tool']) assert((await names()).includes(name));
    await page.locator('#search').fill('beta');
    assert.equal(await page.locator('#project-table tbody tr').count(), 1);
    assert.match(await page.locator('#project-table').innerText(), /beta-site/);
    await page.locator('#search').fill('no-project-has-this-name');
    assert.match(await page.locator('#project-table').innerText(), /No projects/);
    await page.locator('#search').fill('');

    await page.locator('[data-category="Clients"]').click();
    assert.equal(await page.locator('[data-category="Clients"]').getAttribute('aria-pressed'), 'true');
    assert((await paths()).every((value) => value.includes('/Work/Clients/')));
    await page.locator('#group').selectOption('Acme');
    assert.deepEqual((await names()).sort(), ['portal', 'shop']);
    await page.locator('[data-category="Own projects"]').click();
    assert.equal(await page.locator('#group').inputValue(), 'all');
    assert((await paths()).every((value) => value.includes('/Work/Projects/')));
    await page.locator('[data-category="Archive"]').click();
    assert((await paths()).every((value) => value.includes('/Work/Archive/')));
    // Hiding the archive again leaves the archive category.
    await page.locator('#show-archived').uncheck();
    assert.equal(await page.locator('[data-category="Archive"]').count(), 0);
    assert.equal(await page.locator('[data-category="all"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-category="Own projects"]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('[data-category="Own projects"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-category="all"]').click();

    // State filters toggle on a second click; the result bar offers a reset.
    const changes = page.locator('#status-filters [data-filter="changes"]');
    await changes.click();
    assert.equal(await changes.getAttribute('aria-pressed'), 'true');
    assert.deepEqual((await names()).sort(), ['alpha-app', 'shop']);
    assert.match(await page.locator('#result-bar').innerText(), /2 of \d+ projects/);
    await changes.click();
    assert.equal(await changes.getAttribute('aria-pressed'), 'false');
    await page.locator('#search').fill('beta');
    await page.locator('.reset-filters').click();
    assert.equal(await page.locator('#search').inputValue(), '');
    assert.equal(await page.locator('#result-bar').innerText(), '');

    // Overview choices survive attention shortcuts, navigation, and a reload.
    await page.locator('nav [data-view="overview"]').click();
    await page.waitForFunction(() => document.body.dataset.view === 'overview');
    await page.locator('#status-filters [data-filter="unpushed"]').click();
    const overviewSort = await page.evaluate(async () => (await import('/js/store.js')).store.sort);
    await page.locator('.metric-filter[data-filter="changes"]').first().click();
    await page.waitForFunction(() => document.body.dataset.view === 'projects');
    assert.equal(await changes.getAttribute('aria-pressed'), 'true');
    await page.locator('a[href="#overview"]').first().click();
    await page.waitForFunction(() => document.body.dataset.view === 'overview');
    assert.equal(await page.locator('#status-filters [data-filter="unpushed"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await changes.getAttribute('aria-pressed'), 'false');
    await page.reload();
    await page.waitForSelector('#status-filters');
    assert.equal(await page.locator('#status-filters [data-filter="unpushed"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(async () => (await import('/js/store.js')).store.sort), overviewSort);
    await page.locator('a[href="#projects"]').first().click();
    await page.waitForFunction(() => document.body.dataset.view === 'projects');
    assert.equal(await changes.getAttribute('aria-pressed'), 'true');
    await page.locator('.reset-filters').click();
    await page.locator('a[href="#overview"]').first().click();
    await page.waitForFunction(() => document.body.dataset.view === 'overview');
    await page.locator('.reset-filters').click();
    await page.locator('nav [data-view="projects"]').click();
    await page.waitForFunction(() => document.body.dataset.view === 'projects');

    await page.locator('.name-button').first().click();
    await page.waitForSelector('#project-dialog[open]');
    await page.locator('.close-dialog').first().click();
    assert.equal(await page.locator('#project-dialog[open]').count(), 0);
    let saved;
    await page.route('**/api/projects/*', async (route) => {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    });
    await page.locator('.name-button').first().click();
    await page.locator('#next-step').fill('Browser test: next step');
    await page.locator('#project-state').selectOption('archived');
    await page.locator('#project-priority').selectOption('high');
    await page.locator('#save-note').click();
    await page.waitForSelector('#project-dialog[open]', { state: 'detached' });
    assert.deepEqual(saved, { next_step: 'Browser test: next step', state: 'archived', priority: 'high' });
    await page.unroute('**/api/projects/*');

    // Without the key the dashboard can view but not change anything.
    const viewer = await browser.newPage();
    await viewer.goto(ready.url + '/#projects');
    await viewer.waitForSelector('#project-table tbody tr');
    await viewer.locator('#refresh').click();
    await viewer.waitForSelector('#toast:not([hidden])');
    assert.match(await viewer.locator('#toast').innerText(), /can only view Orbit/);
    await viewer.close();

    await page.locator('#settings').click();
    await page.waitForSelector('#settings-dialog[open]');
    await page.locator('.close-settings').first().click();

    await page.locator('nav a[data-view="docker"]').click();
    await page.waitForSelector('.docker-panel');
    assert.match(await page.locator('#content').innerText(), /Volumes \/ databases/);
    assert.match(await page.locator('#content').innerText(), /Colima on Mac/);
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      store.data.ddev.projects.push({name:'analytics',path:'/Users/developer/Work/analytics',status:'stopped'});
      (await import('/js/render.js')).render();
    });
    await page.locator('[data-list-state="ddev"]').selectOption('running');
    assert.equal(await page.locator('#ddev-list tbody tr').count(), 1);
    await page.locator('[data-list-state="ddev"]').selectOption('all');
    await page.locator('[data-list-sort="ddev"][data-key="name"]').click();
    assert.deepEqual(await page.locator('#ddev-list tbody td:first-child').allTextContents(), ['portal','analytics']);
    await page.locator('#ddev-search').fill('analytics');
    assert.equal(await page.locator('#ddev-list tbody tr').count(),1);
    await page.locator('#ddev-search').fill('');
    assert.equal(await page.locator('#container-list tbody tr').count(),3);
    await page.locator('[data-list-scope="containers"]').selectOption('outside');
    assert.equal(await page.locator('#container-list tbody tr').count(),2);
    await page.locator('[data-list-state="containers"]').selectOption('running');
    assert.equal(await page.locator('#container-list tbody td:first-child').innerText(),'app-database');
    await page.evaluate(async () => (await import('/js/render.js')).render());
    assert.equal(await page.locator('[data-list-scope="containers"]').inputValue(),'outside');
    await page.locator('[data-list-state="containers"]').selectOption('all');
    await page.locator('[data-list-scope="containers"]').selectOption('all');
    // Reload restores each list independently, while searches remain session-only.
    await page.locator('[data-list-state="ddev"]').selectOption('running');
    await page.locator('[data-list-scope="containers"]').selectOption('outside');
    await page.locator('#ddev-search').fill('portal');
    const savedLists = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-list-preferences-v1')));
    assert.equal(savedLists.ddev.status, 'running');
    assert.equal(savedLists.containers.scope, 'outside');
    assert(!JSON.stringify(savedLists).includes('query'), 'Search fields must never be saved');
    await page.reload();
    await page.waitForSelector('#ddev-list');
    assert.equal(await page.locator('[data-list-state="ddev"]').inputValue(), 'running');
    assert.equal(await page.locator('#ddev-search').inputValue(), '');
    assert.equal(await page.locator('[data-list-scope="containers"]').inputValue(), 'outside');
    await page.locator('[data-list-reset="ddev"]').click();
    assert.equal(await page.locator('[data-list-state="ddev"]').inputValue(), 'all');
    assert.equal(await page.locator('[data-list-sort="ddev"][data-key="name"]').locator('..').getAttribute('aria-sort'), 'descending');
    await page.locator('[data-list-reset="containers"]').click();
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      const preferences = await import('/js/list-preferences.js');
      store.filters.category = 'Example category';
      store.filters.query = 'Private search';
      store.sort = {key: 'name', direction: 'asc'};
      preferences.saveListPreferences();
    });
    await page.reload();
    await page.waitForSelector('#ddev-list');
    assert.deepEqual(await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      return [store.filters.category, store.filters.query, store.sort];
    }), ['Example category', '', {key: 'name', direction: 'asc'}]);
    await page.evaluate(async () => {
      const {syncListPreferences} = await import('/js/list-preferences.js');
      syncListPreferences({remember_list_preferences: false});
    });
    assert.equal(await page.evaluate(() => localStorage.getItem('orbit-list-preferences-v1')), null);
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      store.filters.category = 'all';
      (await import('/js/list-preferences.js')).syncListPreferences({});
    });
    await page.screenshot({ path: shot('docker'), fullPage: true });
    // Simulate a stopped runtime.
    const snapshot = await (await page.request.get(ready.url + '/api/state')).json();
    await page.route('**/api/state', (route) => route.fulfill({ json: { ...snapshot,
      docker: { status: 'unreachable', colima_status: 'stopped', checked_at: new Date().toISOString(), usage: [], errors: [] },
      ddev: { checked_at: null, error: 'DDEV unavailable.', projects: [], running: null },
    } }));
    await page.reload();
    await page.waitForSelector('.docker-panel');
    assert.match(await page.locator('#content').innerText(), /Stopped/);
    assert.match(await page.locator('#content').innerText(), /DDEV unavailable/);
    assert(!(await page.locator('#content').innerText()).includes('0 DDEV running'));
    await page.unroute('**/api/state');
    await page.reload();
    await page.waitForSelector('.docker-panel');

    await page.locator('nav a[data-view="moon"]').click();
    await page.waitForSelector('.moon-grid');
    await page.evaluate(async () => {
      const {store}=await import('/js/store.js');
      store.data.servers[0].website_links={'a-very-long-domain.example.com':'https://a-very-long-domain.example.com/dashboard?a=b'};
      (await import('/js/render.js')).render();
    });
    assert.equal(await page.locator('a:has-text("a-very-long-domain.example.com")').getAttribute('href'),'https://a-very-long-domain.example.com/dashboard?a=b');
    await page.setViewportSize({width:2200,height:1400});
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      const state = structuredClone(store.data);
      state.servers[0].status.sections.DIENSTE = Array.from({length:30},(_,i)=>({label:'Service '+i,value:'aktiv'}));
      state.servers[0].status.sections.SYSTEM = [
        {label:'Hostname',value:'fixture'},
        {label:'IP addresses',value:'192.0.2.10 10.0.0.1 2001:db8:1234:5678:9abc:def0:1234:5678'},
        {label:'Uptime',value:'555975 seconds'},
        {label:'RAM',value:'1.0 / 4.0 GiB used'},
      ];
      state.servers[0].status.memory = {used:1073741824,total:4294967296};
      state.servers[0].status.sections.SPEICHER = [{label:'Home-Dateisystem',value:'20 / 80 GiB used (25 %)'},{label:'Freier Platz',value:'60 GiB'}];
      state.servers[0].status.sections.PORTS = [{label:'HTTPS · TCP 443',value:'reachable'}];
      state.servers[0].status.sections['GASAMBA REVIEW-SMB'] = [{label:'Port 44545',value:'lokal erreichbar'}];
      store.data = state;
      (await import('/js/render.js')).render();
    });
    const cards = await page.locator('.moon-grid > .panel').evaluateAll(items => items.map(el=>({title:el.querySelector('h2').textContent,top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height,bottom:el.getBoundingClientRect().bottom})));
    assert.equal(cards[0].title,'System','System facts must lead the server view');
    assert.deepEqual(await page.locator('.server-address').allTextContents(),['192.0.2.10','10.0.0.1','2001:db8:1234:5678:9abc:def0:1234:5678']);
    assert.match(await page.locator('.server-facts > .panel').first().innerText(), /6 d 10 h 26 min/);
    assert.equal(await page.locator('.server-ram-chart [role="meter"]').getAttribute('aria-valuenow'),'25');
    await page.evaluate(()=>window.scrollTo(0,700));
    const serverScroll = await page.evaluate(()=>window.scrollY);
    await page.evaluate(async () => (await import('/js/render.js')).render());
    assert.equal(await page.evaluate(()=>window.scrollY),serverScroll,'Server refresh must preserve scrolling without a search field');
    await page.evaluate(()=>window.scrollTo(0,0));
    const storage = cards.find(card=>card.title==='Storage');
    const services = cards.find(card=>card.title==='Services');
    for (const title of ['Services','Websites','Ports']) assert(cards.find(card=>card.title===title).top>storage.bottom,title+' must grow below storage');
    assert.equal(await page.locator('.server-disk-chart').count(),1);
    assert(storage.height<services.height/2,'Storage must not stretch to the height of services');
    assert.match(await page.locator('#content').innerText(), /HTTPS · TCP 443/);
    assert.match(await page.locator('#content').innerText(), /Review-SMB · Port 44545/);
    await page.setViewportSize({width:1440,height:1100});
    await page.screenshot({ path: shot('moon'), fullPage: true });
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'System addresses and meters must fit a narrow viewport');
    await page.setViewportSize({width:1440,height:1100});
    // Multiple servers use an aggregate status and select one set of details.
    const multi = structuredClone(snapshot);
    multi.servers = [
      {label:'Moon', host:'example', command:'moon-status', status:{...snapshot.moon, warnings:[]}},
      {label:'Build <server>', host:'build', command:'moon-status', status:{...snapshot.moon, warnings:['Backup needs review']}},
      {label:'Offline', host:'offline', command:'moon-status', status:null},
    ];
    await page.route('**/api/state', route => route.fulfill({json:multi}));
    await page.reload();
    await page.waitForSelector('.server-choice');
    assert.equal(await page.locator('.server-choice').count(),3);
    await page.locator('.server-choice').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.server-section-title')?.textContent === 'Build <server>');
    assert.equal(await page.locator('.server-section-title').count(),1);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.server-section-title')?.textContent === 'Build <server>');
    await page.locator('nav [data-view="overview"]').click();
    await page.waitForSelector('.server-metric');
    assert.match(await page.locator('.server-metric').innerText(), /3.*enabled/s);
    assert.match(await page.locator('.server-metric').innerText(), /1 healthy.*2 need attention/s);
    assert.equal(await page.locator('.overview-server').count(),3);
    // Visibility hides cards, not connections or attention notices.
    const selected = structuredClone(multi);
    selected.servers[0].show_in_overview = false;
    selected.servers[2].show_in_overview = false;
    await page.evaluate(async snapshot => {
      (await import('/js/store.js')).store.data = snapshot;
      (await import('/js/render.js')).render();
    }, selected);
    assert.equal(await page.locator('.overview-server').count(),1);
    assert.match(await page.locator('.server-metric').innerText(), /Build <server>.*54.4/s);
    assert.match(await page.locator('.overview-attention').innerText(), /Build <server>/);
    selected.servers[1].show_in_overview = false;
    await page.evaluate(async snapshot => {
      (await import('/js/store.js')).store.data = snapshot;
      (await import('/js/render.js')).render();
    }, selected);
    assert.equal(await page.locator('.server-metric').count(),0);
    assert.equal(await page.locator('.overview-server').count(),0);
    await page.evaluate(async snapshot => {
      (await import('/js/store.js')).store.data = snapshot;
      (await import('/js/render.js')).render();
    }, multi);
    await page.locator('.overview-server').nth(1).locator('a').click();
    await page.waitForFunction(() => document.querySelector('.server-section-title')?.textContent === 'Build <server>');
    await page.screenshot({path:shot('servers-multiple'),fullPage:true});
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('body').getAttribute('data-sidebar'),'collapsed');
    await page.reload();
    await page.waitForSelector('.server-choice');
    assert.equal(await page.locator('body').getAttribute('data-sidebar'),'collapsed');
    await page.locator('#sidebar-toggle').click();
    // Every view remains inside a narrow window with the compact shared header.
    for (const view of ['overview','projects','docker','moon','storage','services']) {
      await page.setViewportSize({width:390,height:844});
      await page.locator(`nav [data-view="${view}"]`).click();
      assert(await page.locator('.section-heading h2').evaluateAll(headings => headings.every(heading => {
        const root = getComputedStyle(document.documentElement);
        const expected = parseFloat(root.fontSize) * parseFloat(root.getPropertyValue('--font-card-title'));
        return Math.abs(parseFloat(getComputedStyle(heading).fontSize) - expected) < .1;
      })), 'Card headings must use the same typography role in ' + view);

      await page.waitForFunction(view => document.body.dataset.view === view,view);
      assert.equal(await page.locator('.page-heading').isVisible(),false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,view);
      await page.screenshot({path:shot(view+'-mobile'),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1100});
    await page.unroute('**/api/state');
    await page.reload();
    await page.waitForSelector('#content .panel');
    await page.locator('nav a[data-view="storage"]').click();
    await page.waitForSelector('.size-bars');
    assert.equal(await page.locator('#content .moon-grid, #content .server-workspace').count(),0);
    assert(!(await page.locator('#content').innerText()).includes('Moon'));
    await page.screenshot({ path: shot('storage'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('nav a[data-view="overview"]').click();
    await page.screenshot({ path: shot('mobile'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // Older installs migrate shared selections into independent view objects.
    await page.evaluate(() => localStorage.setItem('orbit-list-preferences-v1', JSON.stringify({
      filters: {status: 'changes', category: 'all', group: 'all', showArchived: false},
      sort: {key: 'name', direction: 'asc'},
    })));
    await page.reload();
    await page.waitForSelector('#status-filters');
    assert.deepEqual(await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      const {overview, projects} = store.projectLists;
      const restored = [overview.filters.status, projects.filters.status, {...overview.sort}, {...projects.sort}];
      projects.filters.status = 'running';
      projects.sort.direction = 'desc';
      return [restored, overview.filters.status, overview.sort.direction];
    }), [['changes', 'changes', {key: 'name', direction: 'asc'}, {key: 'name', direction: 'asc'}], 'changes', 'asc']);
    assert.deepEqual(errors.filter((message) => !message.includes('403')), []);
    console.log('Dashboard checks passed: sorting, filters, archive, action key, dialogs, Docker, server, storage, narrow layout.');
  } finally {
    await browser?.close();
    fixture.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
