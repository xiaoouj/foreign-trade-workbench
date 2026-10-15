const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');await fs.mkdir(out,{recursive:true});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inquiry-links-ui-')),password=crypto.randomUUID();
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:'4196'},stdio:['ignore','pipe','pipe']});let log='',browser;server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 try{
 for(let i=0;i<200;i++){try{if((await fetch('http://127.0.0.1:4196/api/version')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.FTW_CHROME});const page=await browser.newPage({viewport:{width:1218,height:790}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(u.pathname==='/api/rates')return route.fulfill({json:{base:'USD',rates:{USD:1,CNY:7},updated:Date.now()}});return route.continue();});
 await page.goto('http://127.0.0.1:4196/#/enquiry');await page.locator('#loginUser').fill('admin');await page.locator('#loginPwd').fill(password);await page.locator('#loginForm button[type=submit]').click();await page.locator('#view-enquiry.active').waitFor();await page.waitForTimeout(500);if(await page.locator('#updateNotice').isVisible())await page.getByRole('button',{name:'知道了',exact:true}).click();
 const chooseForm=async(name,value)=>{await page.evaluate(()=>window.ftwComboScan());const select=page.locator(`#modalForm [name=${name}]`),text=await select.evaluate((s,v)=>[...s.options].find(o=>o.value===v).textContent,value);await select.locator('..').locator('.ftw-combo input').fill(text);await page.locator('.ftw-combo-list').getByText(text,{exact:true}).click();};
 const fixture=await page.evaluate(async()=>{
 const make=async(type,body)=>{const r=await api('/api/'+type,{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
 const client=await make('clients',{company:'Atlas Test',country:'德国'}),another=await make('clients',{company:'Other Test'});
 const inquiry=await make('inquiries',{clientId:client.id,clientName:client.company,product:'包装机 A',status:'新询盘',receivedAt:'2026-10-13'});
 const second=await make('inquiries',{clientId:client.id,clientName:client.company,product:'输送机 B',status:'新询盘',receivedAt:'2026-10-13'});
 const quote=await make('quotations',{clientId:client.id,clientName:client.company,quoteNo:'TEST-Q1',projectName:'包装机',status:'草稿',currency:'USD',items:[{type:'equipment',name:'包装机',qty:1,unit:'SET',unitPrice:100}]});
 await loadAll();await refreshInquiries();await loadQuotations();return {client,another,inquiry,second,quote};});

 // Model an unlinked quotation that predates automatic provisioning.
 const quoteFile=path.join(dir,'quotations.json'),seedQuotes=JSON.parse(await fs.readFile(quoteFile,'utf8'));delete seedQuotes.find(q=>q.id===fixture.quote.id).inquiryId;await fs.writeFile(quoteFile,JSON.stringify(seedQuotes));await page.evaluate(()=>loadQuotations());await page.waitForTimeout(150);
 // Link an existing quotation to exactly one of two inquiries for this customer.
 await page.locator('#view-enquiry [data-subtab=board]').click();
 await page.locator(`#inqBoard [data-inq-links="${fixture.inquiry.id}"]`).click();await page.locator('#modalForm [name=linkQuote]').selectOption(fixture.quote.id);await page.locator('#modalForm').evaluate(f=>f.requestSubmit());await page.locator('#modal.open').waitFor({state:'hidden'});await page.waitForFunction(id=>window.getAllInquiries().find(q=>q.id===id).status==='已报价',fixture.inquiry.id);
 assert.equal(await page.evaluate(id=>window.getAllInquiries().find(q=>q.id===id).status,fixture.second.id),'新询盘');
 await page.evaluate(id=>openQuoteModal(id),fixture.quote.id);assert.equal(await page.locator('[name=inquiryId]').inputValue(),fixture.inquiry.id);
 // Customer change clears incompatible inquiry selection and does not resurrect it on return.
 await chooseForm('clientName',fixture.another.company);assert.equal(await page.locator('[name=inquiryId]').inputValue(),'');await chooseForm('clientName',fixture.client.company);assert.equal(await page.locator('[name=inquiryId]').inputValue(),'');await page.evaluate(()=>closeModal());await page.locator('#modal.open').waitFor({state:'hidden'});
 await page.evaluate(()=>switchView('quotations'));await page.locator('[data-qt-status-edit]').selectOption('已发送');await page.waitForFunction(id=>window.getAllInquiries().find(q=>q.id===id).status==='等回复',fixture.inquiry.id);
 await page.locator('[data-qt-status-edit]').selectOption('客户确认');await page.waitForFunction(id=>window.getAllInquiries().find(q=>q.id===id).status==='谈判中',fixture.inquiry.id);
 await page.locator('#qtDetailOrder').click();await page.waitForFunction(()=>orders.length===1);assert.equal(await page.evaluate(()=>orders[0].inquiryId),fixture.inquiry.id);assert.equal(await page.evaluate(id=>getAllInquiries().find(q=>q.id===id).status,fixture.inquiry.id),'谈判中');
 await page.evaluate(()=>openOrderModal(orders[0].id));assert.equal(await page.locator('[name=inquiryId]').inputValue(),fixture.inquiry.id);await chooseForm('status','已确认');await page.locator('#modalForm').evaluate(f=>f.requestSubmit());await page.locator('#modal.open').waitFor({state:'hidden'});await page.waitForFunction(id=>getAllInquiries().find(q=>q.id===id).status==='成交',fixture.inquiry.id);
 await page.evaluate(()=>switchView('enquiry'));await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'inquiry-board-linked.png'),fullPage:true,animations:'disabled'});await page.locator(`#inqBoard [data-inq-links="${fixture.inquiry.id}"]`).click();assert.match(await page.locator('#modalForm').innerText(),/订单 TEST-Q1/);assert.match(await page.locator('#modalForm').innerText(),/阶段记录/);await page.screenshot({path:path.join(out,'inquiry-link-detail.png'),fullPage:true,animations:'disabled'});await page.evaluate(()=>closeModal());await page.locator('#modal.open').waitFor({state:'hidden'});

 // A historical inquiry recorded under a person's name can be explicitly mapped to a company.
 const alias=await page.evaluate(async()=>{const create=async(type,body)=>{const r=await api('/api/'+type,{method:'POST',body:JSON.stringify(body)});return r.json();};const c=await create('clients',{company:'Company Archive',contactName:'Alex'}),i=await create('inquiries',{clientName:'Alex',product:'设备 C',status:'新询盘'}),q=await create('quotations',{quoteNo:'ALIAS-Q',clientId:c.id,clientName:c.company,status:'已发送'});await loadAll();await refreshInquiries();await loadQuotations();return {c,i,q};});
 const aliasQuotes=JSON.parse(await fs.readFile(quoteFile,'utf8'));delete aliasQuotes.find(q=>q.id===alias.q.id).inquiryId;await fs.writeFile(quoteFile,JSON.stringify(aliasQuotes));await page.evaluate(()=>loadQuotations());await page.waitForTimeout(150);
 await page.evaluate(id=>openInquiryLinks(id),alias.i.id);await page.locator('#modalForm [name=linkClient]').selectOption(alias.c.id);await page.locator('#modalForm [name=linkQuote]').selectOption(alias.q.id);await page.locator('#modalForm').evaluate(f=>f.requestSubmit());await page.locator('#modal.open').waitFor({state:'hidden'});await page.waitForFunction(id=>getAllInquiries().find(q=>q.id===id).status==='等回复',alias.i.id);assert.equal(await page.evaluate(id=>getAllInquiries().find(q=>q.id===id).clientName,alias.i.id),'Company Archive');
 await page.reload();await page.waitForTimeout(700);assert.equal(await page.evaluate(id=>getAllInquiries().find(q=>q.id===id).status,fixture.inquiry.id),'成交');
 await page.setViewportSize({width:390,height:844});await page.evaluate(id=>openInquiryLinks(id),fixture.inquiry.id);await page.waitForTimeout(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile linkage modal overflow');await page.screenshot({path:path.join(out,'inquiry-links-mobile.png'),fullPage:true,animations:'disabled'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,errors,stage:'won after confirmed order'}));
 }finally{await browser?.close();server.kill('SIGTERM');if(server.exitCode===null)await once(server,'exit');await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
