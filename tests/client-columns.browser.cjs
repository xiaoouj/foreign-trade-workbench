const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'crm-full-ui-')),password=crypto.randomUUID();
 const root=path.resolve(__dirname, '..');
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:'4189'},stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 let browser;
 try{
  for(let i=0;i<200;i++){try{if((await fetch('http://127.0.0.1:4189/api/version')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.FTW_CHROME ? {executablePath:process.env.FTW_CHROME} : {})});
  for(const entry of ['/']){
   const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(/\/api\/fx/.test(u.pathname))return route.fulfill({json:{rates:{CNY:7,USD:1},base:'USD'}});return route.continue();});
   await page.goto('http://127.0.0.1:4189'+entry);
   await page.locator('#loginUser').fill('admin');
   await page.locator(entry==='/'?'#loginPwd':'#loginPw').fill(password);
   if(entry==='/')await page.locator('#loginForm button[type=submit]').click();else await page.locator('#loginBtn').click();
   await page.locator('#updateNotice').waitFor({state:'visible'});
   assert.match(await page.locator('#updateNotice').innerText(),/更新汇总/);
   await page.getByRole('button',{name:'知道了',exact:true}).click();
   await page.evaluate(()=>switchView('clients'));await page.waitForTimeout(500);
   await page.evaluate(()=>{
     allUsers=[{id:'u1',name:'陈经理'},{id:'u2',name:'李业务'}];
     clients=[{id:'c1',company:'Acme Ltd',contactName:'Alice',owner:'u1',ownerName:'旧姓名',stage:'A',country:'美国'}, {id:'c2',company:'Second',owner:'gone',ownerName:'历史跟进人'}, {id:'c3',company:'Unassigned'}];
     localStorage.setItem('ftw_client_col_order',JSON.stringify(['check','star','name','contact','country','phase','grade','source','phone','prod','comm','health','ai','created','rel','ops']));
     renderClients();
   });
   await page.waitForTimeout(300);
   assert.deepEqual(await page.locator('#clientBody td[data-col=owner]').allTextContents(),['陈经理','历史跟进人','未分配']);
   let keys=await page.locator('.cl-table thead th').evaluateAll(els=>els.map(el=>el.dataset.col));
   assert.equal(keys[keys.indexOf('contact')+1],'owner');
   await page.locator('#clientColCfg').click();await page.locator('.col-cfg-compact').waitFor({state:'visible'});
   const modal=page.locator('#modal .modal-box');let box=await modal.boundingBox();assert(box.width<=620&&box.height<620,JSON.stringify(box));
   assert.equal(await page.locator('.col-cfg-rename:visible').count(),0);
   await page.waitForTimeout(350);if(process.env.FTW_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'columns-desktop.png')});
   const ownerRow=page.locator('.col-cfg-row[data-col-key=owner]');
   await page.locator('#colRenameToggle').click();await ownerRow.locator('input[type=text]').fill('客户负责人');
   await ownerRow.locator('input[type=checkbox]').uncheck();await page.locator('#colSave').click();await page.waitForTimeout(350);
   assert.equal(await page.locator('.cl-table th[data-col=owner]').isVisible(),false);
   await page.locator('#clientColCfg').click();await page.waitForTimeout(250);
   await page.locator('.col-cfg-row[data-col-key=owner] input[type=checkbox]').check();await page.locator('#colSave').click();await page.waitForTimeout(350);
   assert.equal((await page.locator('.cl-table th[data-col=owner]').innerText()).trim(),'客户负责人');
   await page.locator('#clientColCfg').click();await page.waitForTimeout(250);
   await page.locator('.col-cfg-row[data-col-key=owner] [data-mv="-1"]').click();await page.waitForTimeout(250);
   await page.locator('#colSave').click();await page.waitForTimeout(350);
   await page.evaluate(()=>renderClients());await page.waitForTimeout(300);
   keys=await page.locator('.cl-table thead th').evaluateAll(els=>els.map(el=>el.dataset.col));
   const bodyKeys=await page.locator('#clientBody tr').first().locator('td').evaluateAll(els=>els.map(el=>el.dataset.col));
   assert.deepEqual(bodyKeys,keys);assert(keys.indexOf('owner')<keys.indexOf('contact'));
   await page.locator('#clientColCfg').click();await page.waitForTimeout(250);await page.locator('#colReset').click();await page.waitForTimeout(350);
   assert.equal((await page.locator('.cl-table th[data-col=owner]').innerText()).trim(),'跟进人');
   keys=await page.locator('.cl-table thead th').evaluateAll(els=>els.map(el=>el.dataset.col));assert.equal(keys[keys.indexOf('contact')+1],'owner');
   await page.evaluate(()=>{localStorage.setItem('ftw_table_cols_v1',JSON.stringify({clientBody:{hidden:[4],labels:{4:'地区'}}}));renderClients();});await page.waitForTimeout(350);
   assert.equal(await page.locator('.cl-table th[data-col=owner]').isVisible(),true);
   assert.equal(await page.locator('.cl-table th[data-col=country]').isVisible(),false);
   assert.equal(await page.locator('.cl-table th[data-col=country]').textContent(),'地区');
   await page.locator('#clientColCfg').click();await page.waitForTimeout(250);await page.locator('#colReset').click();await page.waitForTimeout(350);
   if(process.env.FTW_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'clients-desktop.png')});
   await page.locator('#clientColCfg').click();await page.waitForTimeout(250);await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
   box=await modal.boundingBox();assert(box.x>=0&&box.x+box.width<=391,JSON.stringify(box));
   if(process.env.FTW_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'columns-mobile.png')});
   assert.deepEqual(errors,[]);
   console.log('PASS owner name lookup/fallback, legacy order migration, compact settings, hide/show, rename preservation, reorder, reset, mobile layout');
   const releaseErrors=errors.filter(x=>/update|notice|session/i.test(x));assert.deepEqual(releaseErrors,[]);
   console.log(entry+': real login and release notice OK; page errors: '+JSON.stringify(errors));
   await context.close();
  }
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
