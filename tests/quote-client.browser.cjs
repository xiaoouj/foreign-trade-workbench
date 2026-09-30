const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'crm-full-ui-')),password=crypto.randomUUID();
 const root=path.resolve(__dirname, '..');
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:'4192'},stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 let browser;
 try{
  for(let i=0;i<200;i++){try{if((await fetch('http://127.0.0.1:4192/api/version')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.FTW_CHROME ? {executablePath:process.env.FTW_CHROME} : {})});
  for(const entry of ['/']){
   const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(/\/api\/fx/.test(u.pathname))return route.fulfill({json:{rates:{CNY:7,USD:1},base:'USD'}});return route.continue();});
   await page.goto('http://127.0.0.1:4192'+entry);
   await page.locator('#loginUser').fill('admin');
   await page.locator(entry==='/'?'#loginPwd':'#loginPw').fill(password);
   if(entry==='/')await page.locator('#loginForm button[type=submit]').click();else await page.locator('#loginBtn').click();
   await page.locator('#updateNotice').waitFor({state:'visible'});
   assert.match(await page.locator('#updateNotice').innerText(),/更新汇总/);
   await page.getByRole('button',{name:'知道了',exact:true}).click();
   let failures=1;
   await page.route('**/api/clients/from-quotation',route=>failures-- > 0 ? route.fulfill({status:503,json:{error:'测试建档失败'}}) : route.continue());
   await page.evaluate(async()=>{
     const r=await api('/api/quotations',{method:'POST',body:JSON.stringify({clientName:'AC Test Company',contactName:'Alice',country:'智利',quoteNo:'Q-TEST',notes:'Initial',items:[{type:'equipment',name:'Machine',qty:1,unit:'SET',unitPrice:100}]})});
     const quote=await r.json();await loadQuotations();openQuoteModal(quote.id);
   });
   await page.locator('#qtCreateClient').waitFor({state:'visible'});
   await page.locator('[name=contactName]').fill('New Contact');
   await page.locator('[name=notes]').fill('Unsaved payment terms');
   await page.locator('.qt-price').fill('250');
   await page.locator('#qtCreateClient').click();
   await page.waitForFunction(()=>document.querySelector('#qtClientArchiveStatus').textContent.includes('测试建档失败'));
   assert.equal(await page.locator('.qt-price').inputValue(),'250');
   assert.equal(await page.locator('[name=notes]').inputValue(),'Unsaved payment terms');
   await page.locator('#qtCreateClient').click();
   await page.waitForFunction(()=>document.querySelector('#qtClientArchiveStatus').textContent.includes('客户已建档'));
   assert.equal(await page.locator('#qtCreateClient').isVisible(),false);
   assert.equal(await page.locator('.qt-price').inputValue(),'250');
   assert.equal(await page.locator('[name=notes]').inputValue(),'Unsaved payment terms');
   const client=await page.evaluate(async()=>{const rows=await (await api('/api/clients')).json();return rows.find(x=>x.company==='AC Test Company');});
   assert.equal(client.contactName,'New Contact');assert.equal(client.country,'智利');
   if(process.env.FTW_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'quote-client-created.png')});
   await page.locator('#modalFoot [type=submit]').click();await page.waitForTimeout(500);
   const saved=await page.evaluate(async()=> (await (await api('/api/quotations')).json()).find(x=>x.quoteNo==='Q-TEST'));
   assert.equal(saved.clientId,client.id);assert.equal(saved.items[0].unitPrice,250);assert.equal(saved.notes,'Unsaved payment terms');
   await page.evaluate(id=>openQuoteModal(id),saved.id);await page.waitForTimeout(200);
   assert.equal(await page.locator('#qtCreateClient').isVisible(),false);
   await page.evaluate(()=>openQuoteModal(null,{clientName:'  ac test company  '}));
   assert.equal(await page.locator('#qtCreateClient').isVisible(),false);
   assert.equal(await page.locator('select[name=clientName]').inputValue(),'AC Test Company');
   await page.evaluate(()=>openQuoteModal(null,{clientName:'Mobile New Company',contactName:'Bob'}));
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
   const button=await page.locator('#qtCreateClient').boundingBox();assert(button.x>=0&&button.x+button.width<=391,JSON.stringify(button));
   if(process.env.FTW_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'quote-client-mobile.png')});
   assert.deepEqual(errors,[]);console.log('PASS quote one-click create, failure retry, draft preservation, details/owner transfer, saved linkage, existing client and mobile layout');
   await context.close();
  }
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
