const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');await fs.mkdir(out,{recursive:true});
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'workflow-browser-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let log='',browser;server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 try{
  let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
  browser=await chromium.launch({headless:true,executablePath:process.env.FTW_CHROME});
  const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/rates**',r=>r.fulfill({json:{rates:{CNY:7,USD:1,EUR:.9},base:'USD',updated:Date.now(),source:'测试汇率'}}));
  await page.goto(base+'/#/orders');await page.locator('#loginUser').fill('admin');await page.locator('#loginPwd').fill(password);await page.locator('#loginForm button[type=submit]').click();await page.locator('#view-orders.active').waitFor();
  await page.waitForTimeout(600);if(await page.locator('#updateNotice').isVisible())await page.getByRole('button',{name:'知道了',exact:true}).click();
  const ids=await page.evaluate(async()=>{
    const client=await(await api('/api/clients',{method:'POST',body:JSON.stringify({company:'订单流程测试客户',country:'中国'})})).json();
    const records=[
      ['pending','待确认',1000,{paidPercent:0}],['pre','待收预付款',2000,{depositPercent:30}],
      ['prod','生产中',10000,{depositPercent:30,paidPercent:30,productionProgress:50}],
      ['tail','待收尾款',5000,{paidPercent:40,productionProgress:100}],['ready','待发货',3000,{paidPercent:100}],
      ['shipped','已发货',4000,{paidPercent:100}],['complete','已完成',6000,{}],
      ['oldpre','已确认',8000,{}],['oldpaid','已收款',7000,{}],['unknown','生产中',9000,{depositPercent:30}],
      ['cancel','已取消',11000,{paidPercent:30,notes:'取消后保留原始资料'}],['usd','生产中',100,{currency:'USD',paidPercent:20}]
    ];
    const ids={client:client.id};
    for(const [key,status,amount,extra] of records){const r=await api('/api/orders',{method:'POST',body:JSON.stringify({orderNo:'FLOW-'+key,clientId:client.id,clientName:client.company,amount,currency:'CNY',status,orderDate:todayStr(),...extra})});if(!r.ok)throw Error(await r.text());ids[key]=(await r.json()).id;}
    // A won opportunity is independent reference data, never a second copy of revenue.
    await api('/api/inquiries',{method:'POST',body:JSON.stringify({clientId:client.id,clientName:client.company,product:'独立成交商机',status:'成交',expectedAmount:999999,currency:'CNY',receivedAt:todayStr()})});
    await loadAll();return ids;
  });
  await page.waitForFunction(()=>rateData?.rates?.CNY===7);
  const money=async(id,n)=>assert.equal((await page.locator('#'+id).textContent()).replace(/[^\d.-]/g,''),String(n),id);
  const totals=async()=>{await money('okMonthAmount',44700);await money('okContractAmount',55700);await money('okPaidAmount',25140);await money('okAmount',21560);};
  await totals();assert.equal(await page.locator('#okTotal').textContent(),'12');assert.equal(await page.locator('#okProducing').textContent(),'3');assert.equal(await page.locator('#okPending').textContent(),'2');
  assert.match(await page.locator('#orderPaymentNote').textContent(),/1 笔.*待核对/);
  assert.match(await page.locator('#orderPaymentNote').textContent(),/2 笔历史/);
  const prodRow=page.locator('#orderBody tr').filter({has:page.locator(`[data-oid="${ids.prod}"]`)});
  assert.match(await prodRow.locator('[data-col=c6]').textContent(),/已收 30%/);
  await page.locator('#orderStatusFilter').selectOption('生产中');await money('okMonthAmount',19700);await money('okPaidAmount',3140);await money('okAmount',7560);
  await page.locator('#orderStatusFilter').selectOption('已取消');assert.equal(await page.locator('#okTotal').textContent(),'1');await money('okMonthAmount',0);await money('okPaidAmount',0);await money('okAmount',0);assert.match(await page.locator('#orderBody').textContent(),/FLOW-cancel/);
  await page.locator('#orderFilterReset').click();await totals();
  // Each independent view must agree on full production-and-later turnover.
  await page.evaluate(()=>renderDashKpis());await money('statMonthRevenue',44700);
  await page.evaluate(()=>switchView('performance'));await page.waitForFunction(()=>perfTargetReady);await money('pfActual',44700);
  await page.evaluate(()=>{switchView('finance');finances=[];renderFinance();});
  assert.match(await page.locator('#finSummary').textContent(),/25,140/);assert.match(await page.locator('#finSummary').textContent(),/21,560/);
  await page.evaluate(id=>{openClientDrawer(id);},ids.client);assert.match(await page.locator('#clientDrawerBody .cd-kpis').textContent(),/44,700/);await page.evaluate(()=>closeClientDrawer());
  await page.evaluate(id=>openOrderDetail(id),ids.prod);
  assert.deepEqual(await page.locator('.sales-milestones b').allTextContents(),['订单确认','收预付款','生产','收尾款','发货','完成']);
  assert.equal(await page.locator('.sales-milestones .current b').textContent(),'生产');
  assert.match(await page.locator('.sales-payment-cards').textContent(),/3,000\.00/);assert.match(await page.locator('.sales-payment-cards').textContent(),/7,000\.00/);
  await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'workflow-detail.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'workflow-detail-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1440,height:1050});
  // Updating actual cash to 100% changes cash/balance, never doubles turnover.
  await page.locator('#salesPaymentEdit').click();await page.locator('#modalForm [name=paidPercent]').fill('100');await page.locator('#modalFoot button[type=submit]').click();await page.waitForFunction(id=>orders.find(o=>o.id===id).paidPercent===100,ids.prod);
  await page.evaluate(()=>switchView('orders'));await money('okMonthAmount',44700);await money('okPaidAmount',32140);await money('okAmount',14560);
  await page.evaluate(id=>openOrderModal(id),ids.prod);const status=page.locator('#modalForm select[name=status]');
  assert.deepEqual(await status.locator('option').evaluateAll(xs=>xs.map(x=>x.value)),['待确认','待收预付款','生产中','待收尾款','待发货','已发货','已完成','已取消']);
  await status.selectOption('待收尾款');await page.locator('#modalFoot button[type=submit]').click();await page.waitForFunction(id=>orders.find(o=>o.id===id).status==='待收尾款',ids.prod);
  // Batch transition uses the same new stages and keeps payment data.
  await page.evaluate(id=>{orderSelected=new Set([id]);openOrderBatchEdit();},ids.prod);
  await page.locator('#bmStatus').selectOption('待发货');await page.locator('#modalForm [type=submit]').click();await page.waitForFunction(id=>orders.find(o=>o.id===id).status==='待发货',ids.prod);
  await money('okMonthAmount',44700);await money('okPaidAmount',32140);await money('okAmount',14560);
  // Saving a planned shipment keeps the order awaiting shipment; dispatching it
  // later advances the order without altering its receipt percentage.
  await page.evaluate(id=>{const o=orders.find(o=>o.id===id);openShipmentModal(null,{orderNo:o.orderNo,clientName:o.clientName,status:'待发货'});},ids.prod);
  await page.locator('#modalForm [name=shipmentNo]').fill('SHIP-FLOW');await page.locator('#modalFoot button[type=submit]').click();await page.waitForFunction(()=>shipments.some(s=>s.shipmentNo==='SHIP-FLOW'));
  assert.equal(await page.evaluate(id=>orders.find(o=>o.id===id).status,ids.prod),'待发货');
  await page.evaluate(()=>openShipmentModal(shipments.find(s=>s.shipmentNo==='SHIP-FLOW').id));await page.locator('#modalForm select[name=status]').selectOption('已发货');await page.locator('#modalFoot button[type=submit]').click();await page.waitForFunction(id=>orders.find(o=>o.id===id).status==='已发货',ids.prod);
  await money('okMonthAmount',44700);await money('okPaidAmount',32140);await money('okAmount',14560);
  await page.reload();await page.locator('#view-orders.active').waitFor();await page.waitForFunction(()=>orders.length===12);await page.waitForTimeout(600);if(await page.locator('#updateNotice').isVisible())await page.getByRole('button',{name:'知道了',exact:true}).click();
  await money('okMonthAmount',44700);assert.equal(await page.evaluate(id=>orders.find(o=>o.id===id).paidPercent,ids.prod),100);
  const cancelled=await page.evaluate(id=>orders.find(o=>o.id===id),ids.cancel);assert.equal(cancelled.notes,'取消后保留原始资料');assert.equal(cancelled.paidPercent,30);
  await page.screenshot({path:path.join(out,'workflow-orders-desktop.png'),fullPage:true});
  await page.setViewportSize({width:689,height:791});await page.screenshot({path:path.join(out,'workflow-orders-tablet.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'workflow-orders-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,turnover:44700,initialCollected:25140,initialOutstanding:21560,unknownPayments:1,cancelledRetained:true,newWorkflow:true,batch:true,reload:true,desktopTabletMobile:true,errors}));
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
