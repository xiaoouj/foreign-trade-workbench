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
   await page.evaluate(async()=>{location.hash='/quotations';await loadQuotations();});
   await page.waitForTimeout(500);
   await page.evaluate(()=>{
     quotations=[{id:'q1',quoteNo:'Q-001',clientName:'Test Buyer',projectName:'Project A',ownerName:'Sales A',tradeTerms:'FOB Shanghai',status:'已发送',validUntil:'2026-12-31',version:3,currency:'CNY',items:[{name:'Machine',qty:2,unitPrice:100}]}];
   });
   const configs=[
    {hiddenKeys:['c2'],labelKeys:{c4:'旧金额',c8:'旧负责人'},orderKeys:['c8','c4','c0','c1','c2','c3','c5','c6','c7','c9']},
    {hidden:[2],labels:{4:'旧金额'},order:[8,4,0,1,2,3,5,6,7,9]},
    {schemaVersion:2,hiddenKeys:['tradeTerms'],labelKeys:{amount:'自定义金额'},orderKeys:['owner','amount','quoteNo','clientName','validUntil','status','revision','projectName','tradeTerms','ops']},
    {}
   ];
   for(const cfg of configs){
     await page.evaluate(cfg=>{localStorage.setItem('ftw_table_cols_v1',JSON.stringify({qtBody:cfg}));renderQuotations();},cfg);
     for(let i=0;i<3;i++){
       await page.waitForTimeout(350);
       const rows=await page.locator('.sales-quote-table').evaluate(t=>({heads:[...t.querySelectorAll('thead th')].map(c=>({key:c.dataset.col,hidden:c.classList.contains('col-hidden')})),cells:[...t.tBodies[0].rows[0].cells].map(c=>({key:c.dataset.col,hidden:c.classList.contains('col-hidden'),text:c.textContent}))}));
       assert.deepEqual(rows.heads,rows.cells.map(({key,hidden})=>({key,hidden})));
       const label=await page.locator('.sales-quote-table th[data-col=amount]').textContent();
       assert.equal(label,Object.keys(cfg).length?(cfg.schemaVersion===2?'自定义金额':'旧金额'):'报价金额');
       const text=Object.fromEntries(rows.cells.map(c=>[c.key,c.text]));
       assert.equal(text.owner,'Sales A');assert.match(text.amount,/200/);assert.equal(text.projectName,'Project A');assert.equal(text.tradeTerms,'FOB Shanghai');
       if(cfg.schemaVersion!==2&&Object.keys(cfg).length){assert(rows.cells.find(c=>c.key==='projectName').hidden);assert.equal(rows.cells.find(c=>c.key==='amount').hidden,false);}
       await page.evaluate(()=>renderQuotations());
     }
   }
   let prompt='';
   await page.route('**/api/ai/chat',async route=>{
     prompt=route.request().postDataJSON().messages[0].content;
     await route.fulfill({json:{choices:[{message:{content:JSON.stringify({quoteNo:'AI-001',clientName:'New Buyer',contactName:'Alice',projectName:'Packing line',currency:'RMB',tradeTerms:'FOB Shanghai',depositPercent:'30%',country:'德国',contactEmail:'buyer@example.test',paymentTerms:'30% deposit, 70% before shipment',validUntil:'2026-12-31',deliveryDays:45,totalAmount:2200,items:[{type:'equipment',name:'Machine',description:'Model A',qty:2,unit:'SET',unitPrice:'1,000'},{type:'shipping',name:'Freight',qty:1,unit:'lot',unitPrice:200}]})}}]}});
   });
   await page.evaluate(async()=>renderAiQuotePreview(await extractQuotation('Test quotation')));
   for(const key of ['tradeTerms','depositPercent','contactEmail'])assert(prompt.includes(key));
   for(const [name,value] of Object.entries({quoteNo:'AI-001',clientName:'New Buyer',currency:'CNY',tradeTerms:'FOB Shanghai',depositPercent:'30',deliveryDays:'45',paymentTerms:'30% deposit, 70% before shipment'}))assert.equal(await page.locator('#modalForm [name="'+name+'"]').inputValue(),value);
   assert.equal(await page.locator('.qt-line').count(),2);assert.equal(await page.locator('.qt-price').first().inputValue(),'1000');
   assert.match(await page.locator('#qtTotalDisplay').textContent(),/2,200/);
   assert.deepEqual(errors,[]);
   console.log('PASS legacy/new quotation column preferences, repeated rerender alignment and AI extraction-to-form mapping');
   assert.match(await page.locator('#qtAiAmountCheck').textContent(),/金额核对一致/);
   await page.locator('.qt-price').first().fill('900');
   assert.match(await page.locator('#qtAiAmountCheck').textContent(),/相差 200/);
   await page.locator('.qt-price').first().fill('');
   assert.match(await page.locator('#qtAiAmountCheck').textContent(),/单价缺失/);
   await context.close();
  }
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
