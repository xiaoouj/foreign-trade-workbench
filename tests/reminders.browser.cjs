const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'crm-full-ui-')),password=crypto.randomUUID();
 const root=path.resolve(__dirname, '..');
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:'4191'},stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 let browser;
 try{
  for(let i=0;i<200;i++){try{if((await fetch('http://127.0.0.1:4191/api/version')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.FTW_CHROME ? {executablePath:process.env.FTW_CHROME} : {})});
  for(const entry of ['/']){
   const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(/\/api\/fx/.test(u.pathname))return route.fulfill({json:{rates:{CNY:7,USD:1},base:'USD'}});return route.continue();});
   await page.goto('http://127.0.0.1:4191'+entry);
   await page.locator('#loginUser').fill('admin');
   await page.locator(entry==='/'?'#loginPwd':'#loginPw').fill(password);
   if(entry==='/')await page.locator('#loginForm button[type=submit]').click();else await page.locator('#loginBtn').click();
   await page.locator('#updateNotice').waitFor({state:'visible'});
   assert.match(await page.locator('#updateNotice').innerText(),/更新汇总/);
   await page.getByRole('button',{name:'知道了',exact:true}).click();
   await page.evaluate(async()=>{
     await api('/api/tasks',{method:'POST',body:JSON.stringify({title:'测试跟进',dueDate:'2020-01-01',status:'待处理'})});
     await api('/api/system-notices',{method:'POST',body:JSON.stringify({title:'维护时间说明',content:'仅测试环境通知，不影响正式数据。\n更新内容可以反复查看。'})});
   });
   await page.locator('#tbBell').click();
   await page.locator('#remList .rem-item').waitFor();
   assert.equal(await page.locator('#remFollowTab').getAttribute('aria-selected'),'true');
   assert.equal(await page.locator('#remFollowCount').innerText(),'1');
   await page.waitForFunction(()=>document.querySelector('#remSystemCount')?.textContent==='1');
   assert.equal(await page.locator('#bellBadge').innerText(),'2');
   await page.locator('#remSystemTab').click();
   await page.locator('.system-notice').first().waitFor();
   assert.equal(await page.locator('#remFollowPanel').isVisible(),false);
   assert.equal(await page.locator('.system-notice').count(),2);
   const update=page.locator('.system-notice').filter({hasText:'更新汇总'});
   await update.locator('summary').click();
   assert(await update.locator('.system-notice-content').isVisible());
   const notice=page.locator('.system-notice').filter({hasText:'维护时间说明'});
   await notice.locator('summary').click();
   await page.waitForFunction(()=>document.querySelector('#remSystemCount').textContent==='0');
   assert.equal(await page.locator('#bellBadge').innerText(),'1');
   assert.equal(await notice.locator('[data-system-read]').isVisible(),false);
   if(process.env.FTW_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'system-reminders.png')});
   await page.locator('#systemRefresh').click();await page.waitForTimeout(250);
   assert.equal(await page.locator('.system-notice').count(),2);
   assert.equal(await notice.locator('.system-read-state').innerText(),'已读');
   await page.locator('#remFollowTab').click();
   assert.equal(await page.locator('#remList .rem-item').count(),1);
   await page.locator('[data-dismiss]').click();
   await page.waitForFunction(()=>document.querySelector('#remCount').textContent==='0');
   assert.match(await page.locator('#remList').innerText(),/暂无待办/);
   await page.locator('#remSystemTab').click();
   await page.locator('#systemPublish').click();
   await page.locator('#modalForm input[name=title]').fill('<b>原文标题</b>');
   await page.locator('#modalForm textarea[name=content]').fill('<img src=x onerror=alert(1)>');
   await page.locator('#modalFoot [type=submit]').click();
   await page.waitForFunction(()=>document.querySelectorAll('.system-notice').length===3);
   assert.equal(await page.locator('.system-notice b').count(),0);
   assert.equal(await page.locator('.system-notice img').count(),0);
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
   const panel=await page.locator('#remSystemPanel').boundingBox();assert(panel.x>=0&&panel.x+panel.width<=391,JSON.stringify(panel));
   if(process.env.FTW_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'system-reminders-mobile.png')});
   await page.evaluate(()=>{window.__ftwNoticeUser=null;document.dispatchEvent(new Event('ftw:session-change'));});
   assert.equal(await page.locator('.system-notice').count(),0);
   assert.equal(await page.locator('#bellBadge').innerText(),'0');
   assert.deepEqual(errors,[]);console.log('PASS tabs, follow-up unchanged, shared popup read state, archive reread, isolated reads, safe text, publication form, badge, mobile, session cleanup');
   await context.close();
  }
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
