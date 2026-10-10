/* Generate public README images from synthetic data only. */
const {chromium} = require(process.env.ORBIT_PLAYWRIGHT_MODULE || 'playwright');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

(async () => {
  const root = path.join(__dirname, '..');
  const fixture = spawn(process.env.ORBIT_TEST_PYTHON || 'python3', [path.join(root, 'tests/serve_dashboard_fixture.py')]);
  fixture.stderr.on('data', data => process.stderr.write(data));
  let browser;
  try {
    const lines = readline.createInterface({input:fixture.stdout});
    const ready = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timed out')),15000);
      lines.once('line', line => {clearTimeout(timer); resolve(JSON.parse(line));});
      fixture.once('exit', code => {clearTimeout(timer); reject(new Error('Fixture exited: '+code));});
    });
    browser = await chromium.launch({executablePath:process.env.ORBIT_BROWSER_EXECUTABLE || undefined,headless:true});
    const page = await browser.newPage({viewport:{width:1600,height:1060},deviceScaleFactor:1});
    // A transient localhost connection reset may occur while Chromium opens.
    for(let attempt=0;attempt<3;attempt++) {
      try {
        await page.goto(ready.url+'/#key='+ready.key);
        await page.waitForSelector('#project-table tbody tr',{timeout:10000});
        break;
      } catch(error) { if(attempt===2) throw error; }
    }
    await page.evaluate(async () => {
      const {store} = await import('/js/store.js');
      const {render} = await import('/js/render.js');
      const now = Date.now();
      store.data.config.theme = 'dark';
      store.data.config.palette = 'orbit';
      store.data.config.moon_label = 'Demo server';
      store.data.config.servers[0].label = 'Demo server';
      store.data.servers[0].label = 'Demo server';
      store.data.projects.forEach((project,index) => {
        project.path = '/Users/developer/Work/'+(project.category==='Clients'?'Clients/Acme/':'Projects/')+project.name;
        project.last_modified = now/1000-(index+1)*7200;
      });
      store.data.ddev.projects = [
        {name:'portal',path:'/Users/developer/Work/Clients/Acme/portal',status:'running'},
        {name:'shop',path:'/Users/developer/Work/Clients/Acme/shop',status:'running'},
        {name:'analytics',path:'/Users/developer/Work/Projects/analytics',status:'stopped'},
      ];
      store.data.ddev.running = 2;
      Object.assign(store.data.docker,{errors:[],colima_status:'running',profile:'default',docker_on_colima:true,host_bytes:26*2**30,vm_disk:{total:50*2**30,used:20*2**30,free:30*2**30,percent:40}});
      const status = {checked_at:new Date().toISOString(),error:null,warnings:[],
        memory:{total:8*2**30,used:3*2**30},disk:{total:100*2**30,used:32*2**30,free:68*2**30},
        sections:{
          SYSTEM:[{label:'Hostname',value:'demo.example.com'},{label:'IP addresses',value:'192.0.2.10 2001:db8::10'},{label:'Operating system',value:'Linux x86_64'},{label:'Uptime',value:'555975 seconds'}],
          SPEICHER:[{label:'Home-Dateisystem',value:'32 / 100 GiB used (32 %)'},{label:'Freier Platz',value:'68 GiB'}],
          BACKUP:[{label:'Letzter Erfolg',value:'Today, 08:30 UTC'},{label:'Zeitplan',value:'Daily, 02:40 UTC'}],
          DIENSTE:[{label:'Webserver',value:'active'},{label:'PostgreSQL',value:'active'},{label:'Worker',value:'active'}],
          WEBSEITEN:[{label:'app.example.com',value:'reachable (HTTPS, HTTP 200)'},{label:'docs.example.com',value:'reachable (HTTPS, HTTP 200)'}],
          PORTS:[{label:'HTTPS · TCP 443',value:'listening locally'},{label:'Database · TCP 5432',value:'listening locally'}],
        }};
      store.data.servers[0].status = status;
      store.data.moon = status;
      render();
    });
    await page.screenshot({path:path.join(root,'docs/screenshots/overview-dark.png'),fullPage:true});
    await page.evaluate(async () => {
      (await import('/js/store.js')).store.data.config.theme='light';
      (await import('/js/render.js')).render();
    });
    await page.screenshot({path:path.join(root,'docs/screenshots/overview-light.png'),fullPage:true});
    await page.evaluate(async () => {
      const {store}=await import('/js/store.js');
      store.data.config.theme='dark';store.view='docker';
      store.integrationLists.ddev.status='running';
      (await import('/js/render.js')).render();
    });
    await page.screenshot({path:path.join(root,'docs/screenshots/docker.png'),fullPage:true});
    await page.evaluate(async () => {
      (await import('/js/store.js')).store.view='moon';
      (await import('/js/render.js')).render();
    });
    await page.screenshot({path:path.join(root,'docs/screenshots/servers.png'),fullPage:true});
    console.log('Four synthetic README screenshots created.');
  } finally {
    if(browser) await browser.close();
    fixture.kill('SIGTERM');
  }
})().catch(error => {console.error(error);process.exitCode=1;});
