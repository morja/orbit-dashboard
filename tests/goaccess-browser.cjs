const {chromium}=require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const assert=require('node:assert/strict');
(async()=>{
 const fixture=spawn('python3',[require('node:path').join(__dirname, 'serve_goaccess_fixture.py')]);
 fixture.stderr.on('data',data=>process.stderr.write(data));
 const ready=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Traffic fixture did not start')),15000);
  readline.createInterface({input:fixture.stdout}).once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line));});
  fixture.once('exit',code=>{clearTimeout(timer);reject(new Error('Traffic fixture exited: '+code));});
 });
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.ORBIT_BROWSER_EXECUTABLE || undefined,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(ready.url+'/#key='+ready.key);
  await page.waitForSelector('#project-table tbody tr');
  let downloads = 0;
  page.on('request', request => {
   if (request.url().endsWith('/api/goaccess/refresh')) downloads++;
  });
  let releaseCache;
  const cacheGate = new Promise(resolve => { releaseCache = resolve; });
  await page.route('**/api/goaccess', async route => {
   await cacheGate;
   await route.continue();
  });
  await page.locator('nav [data-view="goaccess"]').click();
  await page.waitForFunction(() => document.querySelector('#goaccess-refresh')?.disabled);
  assert.equal(await page.locator('#goaccess-refresh').innerText(), 'Loading reports…');
  assert.equal(downloads, 0, 'Opening Web traffic must only read the local cache');
  releaseCache();
  await page.waitForSelector('[data-goaccess-report="demo"]');
  await page.waitForFunction(() => !document.querySelector('#goaccess-refresh')?.disabled);
  await page.unroute('**/api/goaccess');
  assert.equal(await page.locator('#goaccess-period').inputValue(), '30');
  assert.match(await page.locator('[data-goaccess-report="demo"]').innerText(), /37/);
  await page.locator('#goaccess-period').selectOption('7');
  assert.match(await page.locator('[data-goaccess-report="demo"] dd').first().innerText(), /12,000/);
  await page.locator('#goaccess-period').selectOption('all');
  assert.match(await page.locator('[data-goaccess-report="demo"]').innerText(), /80/);
  await page.locator('#goaccess-period').selectOption('30');
  assert.equal(await page.locator('[data-goaccess-report="demo"] .goaccess-hostname').innerText(), 'example.test');
  // A failed download must not leave a stale notice after reloading the cache.
  let releaseDownload;
  const downloadGate = new Promise(resolve => { releaseDownload = resolve; });
  await page.route('**/api/goaccess/refresh', async route => {
   await downloadGate;
   await route.fulfill({
   status: 503, contentType: 'application/json',
   body: JSON.stringify({error: 'GoAccess download unavailable; the previous local copy is preserved'})
   });
  });
  await page.locator('#goaccess-refresh').click();
  await page.waitForFunction(() => document.querySelector('#goaccess-refresh')?.disabled);
  await page.locator('nav [data-view="overview"]').click();
  await page.locator('nav [data-view="goaccess"]').click();
  assert.equal(await page.locator('#goaccess-refresh').isDisabled(), true);
  assert.equal(await page.locator('#goaccess-refresh').innerText(), 'Loading reports…');
  assert.equal(downloads, 1, 'Navigation must not start another download');
  releaseDownload();
  await page.waitForFunction(() => document.querySelector('.goaccess-toolbar .notice')?.textContent.includes('GoAccess download unavailable'));
  await page.unroute('**/api/goaccess/refresh');
  await page.locator('nav [data-view="overview"]').click();
  await page.locator('nav [data-view="goaccess"]').click();
  await page.waitForSelector('[data-goaccess-report="demo"]');
  await page.waitForFunction(() => !document.querySelector('.goaccess-toolbar .notice'));
  assert.equal(await page.locator('[data-goaccess-report="demo"]').count(), 1);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.goaccess-card')).paddingTop === '10px');
  assert.ok(await page.locator('.goaccess-toolbar').evaluate(el => el.getBoundingClientRect().height) < 90, 'Toolbar stays compact');
  await page.locator('[data-goaccess-report="demo"]').click();
  await page.waitForSelector('.goaccess-page-table tbody tr');
  assert.equal(await page.locator('iframe').count(), 0, 'The page overview is the default view');
  assert.equal(await page.locator('.goaccess-page-table tbody tr').count(), 25);
  assert.match(await page.locator('.goaccess-page-table tbody').innerText(), /620/);
  assert.doesNotMatch(await page.locator('.goaccess-page-table tbody').innerText(), /filament|livewire|admin|favicon|language/);
  assert.equal(await page.locator('.goaccess-page-metrics dd').first().innerText(), '3,922');
  assert.equal(await page.locator('.goaccess-page-metrics dd').last().innerText(), '41');
  // Query variants are combined without adding their overlapping visitors.
  const search = page.locator('#goaccess-search');
  await search.pressSequentially('events');
  assert.equal(await search.inputValue(), 'events');
  assert.equal(await search.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.goaccess-page-table tbody tr').count(), 1);
  assert.equal(await page.locator('.goaccess-page-count > span').first().innerText(), '236');
  assert.equal(await page.locator('.goaccess-page-visitors').innerText(), '—');
  await search.fill('teachers');
  assert.equal(await page.locator('.goaccess-page-table tbody tr').count(), 2);
  await page.locator('#goaccess-page-merge').check();
  assert.equal(await page.locator('.goaccess-page-table tbody tr').count(), 1);
  assert.equal(await page.locator('.goaccess-page-count > span').first().innerText(), '876');
  assert.equal(await page.locator('.goaccess-page-visitors').innerText(), '—');
  await page.locator('#goaccess-page-merge').uncheck();
  await search.fill('not-a-page');
  assert.match(await page.locator('.goaccess-page-table .empty').innerText(), /No pages match/);
  await search.fill('');
  await page.locator('[data-goaccess-page="1"]').click();
  assert.equal(await page.locator('.goaccess-page-table tbody tr').count(), 16);
  assert.equal(await page.locator('.goaccess-page-table img').count(), 0, 'Request paths must render as text');
  await page.locator('[data-goaccess-page="-1"]').click();
  await page.locator('#goaccess-page-sort').focus();
  await page.locator('#goaccess-page-sort').selectOption('visitors');
  assert.equal(await page.locator('.goaccess-page-path').first().innerText(), '/en/teachers');
  await page.locator('#goaccess-page-sort').selectOption('requests');
  await page.locator('#goaccess-period').selectOption('7');
  await page.waitForFunction(() => document.querySelector('.goaccess-page-metrics dd')?.textContent === '1,961');
  await page.locator('#goaccess-period').selectOption('all');
  await page.waitForSelector('.goaccess-pages .notice');
  assert.match(await page.locator('.goaccess-pages .notice').innerText(), /may be incomplete/);
  await page.locator('#goaccess-period').selectOption('30');
  await page.waitForFunction(() => document.querySelector('.goaccess-page-metrics dd')?.textContent === '3,922');
  assert.equal(downloads, 1, 'Page filters and periods never use SSH');
  for (const language of ['en', 'de']) {
   for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
     await page.setViewportSize({width, height: 1000});
     await page.evaluate(async ({language, theme}) => {
      Object.assign((await import('/js/store.js')).store.data.config, {language, theme});
      (await import('/js/render.js')).render({force: true});
     }, {language, theme});
     assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
     assert.equal(await page.locator('.goaccess-page-table').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
     const sizes = await page.locator('.goaccess-pages h2, .goaccess-card h2').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize));
     assert.equal(new Set(sizes).size, 1, 'Page and report cards reuse the heading token');
     assert.match(await page.locator('[data-goaccess-mode="pages"]').innerText(), language === 'de' ? /Besuchte Seiten/ : /Visited pages/);
     await page.screenshot({path: `/tmp/orbit-pages-${language}-${theme}-${width}.png`, fullPage: true});
    }
   }
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.evaluate(async () => {
   Object.assign((await import('/js/store.js')).store.data.config, {language: 'en', theme: 'light'});
   (await import('/js/render.js')).render({force: true});
  });
  await page.locator('[data-goaccess-report="legacy"]').click();
  await page.waitForFunction(() => document.querySelector('.goaccess-pages')?.textContent.includes('no readable page data'));
  assert.equal(await page.locator('.goaccess-page-metrics').count(), 0);
  await page.locator('[data-goaccess-report="waiting"]').click();
  assert.match(await page.locator('.goaccess-pages').innerText(), /Awaiting data/);
  await page.locator('[data-goaccess-report="demo"]').click();
  await page.locator('[data-goaccess-mode="technical"]').click();
  await page.frameLocator('iframe').locator('h1').waitFor();
  let frame=page.frames().find(frame=>frame.url().includes('/api/goaccess/reports/'));
  assert.equal(await frame.evaluate(()=>window.reportWorks&&window.isolated),true);
  assert.equal(await page.evaluate(()=>document.body.dataset.compromised),undefined);
  const loaded=await frame.evaluate(()=>performance.timeOrigin);
  await page.waitForTimeout(12000);
  frame=page.frames().find(frame=>frame.url().includes('/api/goaccess/reports/'));
  assert.equal(await frame.evaluate(()=>performance.timeOrigin),loaded,'Polling must preserve report');
  for(const theme of ['light','dark']) {
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.screenshot({path:'/tmp/orbit-goaccess-'+theme+'.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/orbit-goaccess-narrow.png',fullPage:true});
  await page.locator('#settings-topbar').click();
  await page.locator('[data-settings-tab="appearance"]').click();
  await page.locator('#setting-language').selectOption('de');
  await page.locator('.close-settings').first().click();
  await page.locator('nav [data-view="goaccess"]').click();
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('GoAccess UI passed: escaped labels, report scripts, isolated origin, polling stability, themes and narrow layout.');
 }finally{if(browser)await browser.close();fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1});
