const {chromium}=require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const assert=require('node:assert/strict');
(async()=>{
 const fixture=spawn('python3',[require('node:path').join(__dirname, 'serve_goaccess_fixture.py')]);
 fixture.stderr.on('data',data=>process.stderr.write(data));
 const ready=await new Promise(resolve=>readline.createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line))));
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
  assert.match(await page.locator('[data-goaccess-report="demo"] dd').first().innerText(), /120/);
  await page.locator('#goaccess-period').selectOption('all');
  assert.match(await page.locator('[data-goaccess-report="demo"]').innerText(), /80/);
  await page.locator('#goaccess-period').selectOption('30');
  assert.equal(await page.locator('.goaccess-hostname').innerText(), 'example.test');
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
