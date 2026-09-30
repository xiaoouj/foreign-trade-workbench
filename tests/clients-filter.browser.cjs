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
  await page.evaluate(()=>{clients=[{id:'a',company:'Same',owner:'u1',country:'中国',source:'展会'},{id:'b',company:'Same',owner:'u2',country:'美国',source:'网站'},{id:'c',company:'Other',owner:'u1',country:'中国',source:'网站'}];switchView('clients');renderClients();});
  await page.locator('#cfOwner').selectOption('u1');assert.equal(await page.locator('#clientBody tr').count(),2);
  await page.locator('#cfSource').selectOption('展会');assert.equal(await page.locator('#clientBody tr').count(),1);assert.equal(await page.evaluate(()=>currentClientList().length),1);
  await page.locator('#cfReset').click();assert.equal(await page.locator('#clientBody tr').count(),3);
  await page.locator('#clientDedup').click();assert.equal(await page.locator('[data-dedup-remove]').count(),2);assert.equal(await page.locator('[data-dedup-remove]:checked').count(),0);
  await page.locator('[data-dedup-remove="a"]').check();assert.equal(await page.locator('[data-dedup-remove="a"]').isChecked(),true);
  await page.locator('[data-dedup-remove="b"]').check();await page.locator('[data-dedup-g]').click();assert.equal(await page.locator('[data-dedup-remove]').count(),2);
  await page.locator('[data-dedup-remove="b"]').uncheck();await page.evaluate(()=>{window.removedIds=[];batchDeleteRecords=async ids=>{window.removedIds=ids;};});await page.locator('[data-dedup-g]').click();assert.deepEqual(await page.evaluate(()=>window.removedIds),['a']);
  await page.evaluate(()=>closeModal());await page.waitForTimeout(400);await page.setViewportSize({width:712,height:769});await page.screenshot({path:'/tmp/clients-filter.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('PASS client combined filters, AI scope, reset, selectable duplicates, keep guard, mobile');
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
