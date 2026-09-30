const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'orders-filter-')),password=crypto.randomUUID();
 const server=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:'4193'},stdio:['ignore','pipe','pipe']});
 let log='',browser;server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 try{
  let ready=false;for(let i=0;i<1200;i++){try{if((await fetch('http://127.0.0.1:4193/api/version')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
  browser=await chromium.launch({headless:true,executablePath:process.env.FTW_CHROME});const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/fx**',r=>r.fulfill({json:{rates:{CNY:7,USD:1},base:'USD'}}));
  await page.goto('http://127.0.0.1:4193/#/orders');await page.locator('#loginUser').fill('admin');await page.locator('#loginPwd').fill(password);await page.locator('#loginForm button[type=submit]').click();await page.locator('#view-orders.active').waitFor();
  if(await page.locator('#updateNotice').isVisible())await page.getByRole('button',{name:'知道了',exact:true}).click();
  await page.evaluate(()=>switchView('settings'));
  assert.deepEqual(await page.locator('#view-settings [data-style]').evaluateAll(xs=>xs.map(x=>x.dataset.style)),['flow','vibe','apple','fui']);
  await page.locator('[data-style=fui]').click();
  assert.equal(await page.locator('html').getAttribute('data-fui'),'1');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.waitForTimeout(400);await page.screenshot({path:'/tmp/fui-settings.png'});
  await page.reload();await page.locator('#view-settings').waitFor();await page.waitForTimeout(800);assert.equal(await page.locator('html').getAttribute('data-fui'),'1');
  await page.evaluate(()=>{orders=[{id:'demo',orderNo:'ST06260090',clientName:'Sanbo Group B.V.',ownerName:'管理员',amount:7900,currency:'USD',status:'已收款',orderDate:'2026-08-20'}];switchView('orders');renderOrders();});
  await page.waitForTimeout(500);await page.screenshot({path:'/tmp/fui-orders.png'});
  await page.locator('[data-edit-o=demo]').click();await page.locator('#modal .modal-box').waitFor({state:'visible'});await page.waitForTimeout(400);await page.screenshot({path:'/tmp/fui-modal.png'});await page.evaluate(()=>closeModal());await page.waitForTimeout(350);
  await page.setViewportSize({width:715,height:769});await page.screenshot({path:'/tmp/fui-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>switchView('settings'));await page.locator('[data-mode=light]').click();assert.equal(await page.locator('html').getAttribute('data-fui'),'1');await page.waitForTimeout(450);await page.screenshot({path:'/tmp/fui-light.png'});
  await page.locator('[data-style=flow]').click();assert.equal(await page.locator('html').getAttribute('data-fui'),null);
  await page.evaluate(()=>{applyTheme({style:'mc',mode:'light'});renderSettings();});assert.equal(await page.locator('html').getAttribute('data-mc'),null);assert.equal(await page.locator('[data-style=flow]').getAttribute('class'),'style-opt active');
  assert.deepEqual(errors,[]);console.log('PASS FUI switching, persistence, removed-theme fallback, order modal, mobile, light mode');
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
