const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'crm-full-ui-')),password=crypto.randomUUID();
 const root=path.resolve(__dirname, '..');
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:'4190'},stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 let browser;
 try{
  for(let i=0;i<200;i++){try{if((await fetch('http://127.0.0.1:4190/api/version')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.FTW_CHROME ? {executablePath:process.env.FTW_CHROME} : {})});
  for(const entry of ['/']){
   const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(/\/api\/fx/.test(u.pathname))return route.fulfill({json:{rates:{CNY:7,USD:1},base:'USD'}});return route.continue();});
   await page.goto('http://127.0.0.1:4190'+entry);
   await page.locator('#loginUser').fill('admin');
   await page.locator(entry==='/'?'#loginPwd':'#loginPw').fill(password);
   if(entry==='/')await page.locator('#loginForm button[type=submit]').click();else await page.locator('#loginBtn').click();
   await page.locator('#updateNotice').waitFor({state:'visible'});
   assert.match(await page.locator('#updateNotice').innerText(),/更新汇总/);
   await page.getByRole('button',{name:'知道了',exact:true}).click();
   await page.evaluate(async()=>{
     const create=async(username,name,role,managerId)=>{const r=await api('/api/users',{method:'POST',body:JSON.stringify({username,name,role,managerId,password:'ui-test-pass'})});return r.json();};
     const m=await create('manager','张经理','manager',currentUser.id);
     await create('sales','王业务','sales',m.id);
     await create('unassigned','未指定成员','manager');
     await loadUsers();openUserMgmt();
   });
   await page.locator('.um-layout').waitFor();await page.waitForTimeout(350);
   assert.equal(await page.locator('.um-row:visible').count(),4);
   assert((await page.locator('#modal .modal-box').boundingBox()).width<=841);
   const row=await page.locator('.um-row').first().boundingBox();assert(row.height<100,JSON.stringify(row));
   if(process.env.FTW_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'users-list.png')});
   await page.locator('[data-um-view=org]').click();
   assert.equal(await page.locator('.um-list').isVisible(),false);
   assert.equal(await page.locator('.um-node:visible').count(),4);
   assert.equal(await page.locator('.um-org > ul > li').count(),2);
   assert.equal(await page.locator('.um-org ul ul ul .um-node').count(),1);
   if(process.env.FTW_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'users-org.png')});
   await page.locator('.um-node').filter({hasText:'王业务'}).click();
   assert.equal(await page.locator('.um-list').isVisible(),true);
   assert.equal(await page.locator('.um-panel[data-panel=edit]:visible').count(),1);
   await page.locator('[data-um-cancel]:visible').click();
   await page.locator('#umSearch').fill('王业务');assert.equal(await page.locator('.um-row:visible').count(),1);
   await page.locator('#umSearch').fill('does-not-exist');assert.equal(await page.locator('.um-no-results').isVisible(),true);
   await page.locator('#umSearch').fill('');
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
   const box=await page.locator('#modal .modal-box').boundingBox();assert(box.x>=0&&box.x+box.width<=391,JSON.stringify(box));
   if(process.env.FTW_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'users-mobile.png')});
   await page.evaluate(()=>{currentUser={id:allUsers.find(u=>u.username==='sales').id,role:'sales'};openUserMgmt();});
   assert.equal(await page.locator('[data-um-tab=edit]').count(),1);
   assert.equal(await page.locator('[data-um-del]').count(),0);
   assert.equal(await page.locator('#umAddToggle').count(),0);
   await page.evaluate(()=>{openModal('Other','<div class="field">Other form</div>');});
   assert.equal(await page.locator('.um-layout').count(),0);
   assert.deepEqual(errors,[]);console.log('PASS compact users, true org hierarchy, search, edit navigation, mobile, sales controls and modal cleanup');
   await context.close();
  }
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
