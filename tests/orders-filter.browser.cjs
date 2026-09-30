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
  await page.evaluate(()=>{
   allUsers=[{id:'u1',name:'张三',username:'zhang1'},{id:'u2',name:'张三',username:'zhang2'}];
   orders=[
    {id:'1',orderNo:'ST260001',clientName:'A',owner:'u1',ownerName:'旧姓名',orderDate:'2026-01-02',amount:100,currency:'CNY',status:'待确认'},
    {id:'2',orderNo:'ST260002',clientName:'B',owner:'u2',orderDate:'2026-01-03',amount:200,currency:'CNY',status:'已收款'},
    {id:'3',orderNo:'ST250003',clientName:'A',owner:'u1',orderDate:'2025-02-01',amount:300,currency:'CNY',status:'已发货'},
    {id:'4',orderNo:'ST260004',clientName:'A',orderDate:'2026-02-01',amount:400,currency:'CNY',status:'已取消'},
    {id:'5',orderNo:'ST250005',clientName:'B',owner:'u1',orderDate:'',createdAt:new Date(2025,0,4).getTime(),amount:500,currency:'CNY',status:'已完成'},
    {id:'6',orderNo:'ST260006',clientName:'B',owner:'gone',ownerName:'历史负责人',orderDate:'invalid',createdAt:Date.now(),amount:600,currency:'CNY',status:'已确认'}];
   renderOrders();
  });
  assert.deepEqual(await page.locator('#orderBody .cb-order').evaluateAll(xs=>xs.map(x=>x.dataset.oid)),['4','2','1','3','6','5']);
  const count=async(n)=>assert.equal(await page.locator('#okTotal').textContent(),String(n));
  const money=async(id,n)=>assert.equal((await page.locator('#'+id).textContent()).replace(/[^\d.-]/g,''),String(n));
  await count(6);await money('okMonthAmount',1700);await money('okAmount',1000);await money('okPaidAmount',700);
  assert.equal(await page.locator('#orderOwnerFilter option').count(),5);
  assert.match(await page.locator('#orderBody').textContent(),/历史负责人/);
  await page.locator('#orderYearFilter').selectOption('2026');await count(3);await money('okMonthAmount',300);
  await page.locator('#orderMonthFilter').selectOption('01');await count(2);await money('okPaidAmount',200);
  await page.locator('#orderOwnerFilter').selectOption('id:u1');await count(1);await money('okAmount',100);
  await page.locator('#orderStatusFilter').selectOption('已完成');await count(0);await money('okMonthAmount',0);
  await page.locator('#orderFilterReset').click();await count(6);
  await page.locator('#orderYearFilter').selectOption('2025');await page.locator('#orderMonthFilter').selectOption('01');await count(1);await money('okPaidAmount',500);
  await page.locator('#orderFilterReset').click();
  // Old positional column preferences must continue targeting country, not owner.
  await page.evaluate(()=>{localStorage.setItem('ftw_table_cols_v1',JSON.stringify({orderBody:{hidden:[3],labels:{4:'原币金额'},order:[0,1,2,3,4,5,6,7,8,9]}}));renderOrders();});
  await page.waitForTimeout(300);assert.equal(await page.locator('#view-orders th[data-col=owner]').isVisible(),true);assert.equal(await page.locator('#view-orders th[data-col=c3]').isVisible(),false);assert.equal(await page.locator('#view-orders th[data-col=c4]').textContent(),'原币金额');
  await page.locator('#orderColumns').click();await page.locator('.col-cfg-row[data-col-key=owner]').waitFor();await page.locator('.col-cfg-row[data-col-key=owner] input[type=checkbox]').uncheck();await page.locator('#colSave').click();await page.waitForTimeout(200);assert.equal(await page.locator('#view-orders th[data-col=owner]').isVisible(),false);
  await page.locator('#orderYearFilter').selectOption('2026');await page.waitForTimeout(150);assert.equal(await page.locator('#orderBody td[data-col=owner]').first().isVisible(),false);
  await page.setViewportSize({width:712,height:769});await page.locator('#orderFilterReset').click();await page.screenshot({path:'/tmp/orders-filter-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('PASS combined filters, 6 linked cards, empty/reset, legacy dates, distinct owners, column migration, mobile');
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
