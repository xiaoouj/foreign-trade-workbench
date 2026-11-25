const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');fs.mkdirSync(out,{recursive:true});
const today=new Date().toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
const user={id:'u1',username:'demo',name:'陈晓',role:'admin'},users=[user,{id:'u2',username:'limin',name:'李敏',role:'sales'}];
let clients=Array.from({length:12},(_,i)=>({id:'c'+i,company:['Atlas Machinery','Nova Industrial','Sol Manufacturing','Delta Packaging','Northstar Co.','Prime Equipment'][i%6]+(i>=6?' Group':''),country:['阿联酋','德国','墨西哥','泰国','加拿大','英国'][i%6],contactName:['Omar Hassan','Anna Weber','Carlos Ruiz','Niran','James','Oliver'][i%6],contactEmail:'contact'+i+'@example.com',contactPhone:'+12025550123',owner:i%2?'u2':'u1',ownerName:i%2?'李敏':'陈晓',stage:['A','S','B','C'][i%4],source:['阿里巴巴','官网','展会'][i%3],tags:[i%2?'经销商':'终端客户'],star:i%3===0,productInterest:'包装机 CA-320',nextFollowUp:i%3===0?yesterday:'',createdAt:Date.now()-i*86400000,updatedAt:Date.now()}));
const orders=Array.from({length:12},(_,i)=>({id:'o'+i,orderNo:'CA2609'+i,clientId:'c'+i,clientName:clients[i].company,owner:'u1',amount:12800+i*900,currency:'USD',status:'生产中',orderDate:new Date(2026,8-i,10).toISOString().slice(0,10),createdAt:Date.now()}));
const inquiries=clients.map((c,i)=>({id:'i'+i,clientId:c.id,clientName:c.company,country:c.country,owner:'u1',ownerName:'陈晓',product:'包装机采购方案',status:['新询盘','已报价','等回复','谈判中','成交'][i%5],receivedAt:today,nextFollowAt:i<3?yesterday:'',expectedAmount:18800,currency:'USD',updatedAt:Date.now()}));
let tasks=[{id:'t1',title:'确认 Atlas 包装机配置',dueDate:today,priority:'高',status:'待办',owner:'u1',clientName:'Atlas Machinery'},{id:'t2',title:'整理本周出货资料',dueDate:yesterday,priority:'中',status:'待办',owner:'u1'}];
let quotes=[{id:'q1',quoteNo:'QT260929',clientId:'c0',clientName:clients[0].company,owner:'u1',ownerName:'陈晓',createdAt:Date.now(),currency:'USD',status:'已发送',version:1,tradeTerms:'FOB',depositPercent:30,items:[{type:'equipment',name:'包装机',description:'CA-320',qty:2,unit:'SET',unitPrice:12000}]}];
quotes.push({...quotes[0],id:'legacy',quoteNo:'LEGACY',status:'已转订单'});
let convertMode='success',releaseConversion;
let fx=7.12;const writes=[],errors=[],consoleErrors=[],missing=[];
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.FTW_CHROME ? {executablePath:process.env.FTW_CHROME} : {})});try{
const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN'});
await context.addInitScript(()=>localStorage.setItem('ftw_theme',JSON.stringify({style:'fui',mode:'dark'})));
await context.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url()),p=u.pathname;
 if(u.hostname!=='crm.test')return route.abort();
 if(p.startsWith('/api/')){
 const json=body=>route.fulfill({json:body});
 if(req.method()!=='GET'){
  writes.push({path:p,method:req.method(),body:req.postDataJSON()});
  if(p.endsWith('/convert-to-order')){
   if(convertMode==='failure')return route.fulfill({status:500,json:{error:'测试保存失败'}});
   if(convertMode==='pending')await new Promise(resolve=>releaseConversion=resolve);
   const q=quotes.find(q=>q.id===p.split('/')[3]);
   let order=orders.find(o=>o.quoteId===q.id),created=!order;
   if(!order){order={id:'converted-'+q.id,quoteId:q.id,orderNo:q.quoteNo,clientName:q.clientName,status:'待确认'};orders.push(order);}
   q.status='已转订单';q.orderId=order.id;
   return route.fulfill({status:created?201:200,json:{created,order,quotation:q}});
  }
  if(p.startsWith('/api/quotations/')){const reviseQuote=(q,b)=>({...q,...b});const i=quotes.findIndex(q=>q.id===p.split('/').pop());quotes[i]=reviseQuote(quotes[i],req.postDataJSON(),user,Date.now());return json(quotes[i]);}
  if(p.startsWith('/api/orders/')){const o=orders.find(o=>o.id===p.split('/').pop());Object.assign(o,req.postDataJSON());return json(o);}
  if(p.startsWith('/api/clients/')){let c=clients.find(c=>c.id===p.split('/').pop());if(c)Object.assign(c,req.postDataJSON());return json(c||{});}
  if(p==='/api/clients'){const c={id:'added',...req.postDataJSON()};clients.push(c);return route.fulfill({status:201,json:c});}
  if(p.startsWith('/api/tasks/')){const t=tasks.find(t=>t.id===p.split('/').pop());Object.assign(t,req.postDataJSON());return json(t);}
  return json({ok:true});
 }
 if(p==='/api/me')return json(user);if(p==='/api/users')return json(users);
 if(p==='/api/clients')return json(clients);if(p==='/api/orders')return json(orders);if(p==='/api/inquiries')return json(inquiries);if(p==='/api/tasks')return json(tasks);
 if(p==='/api/rates')return json({base:'USD',rates:{USD:1,CNY:fx,EUR:.92,GBP:.78,AED:3.67},source:'测试汇率',updated:Date.now()});
 if(p==='/api/quotations')return json(quotes);
 if(p==='/api/comms')return json([{id:'m1',clientName:clients[0].company,date:today,content:'已确认包装机方案，等待客户反馈报价。',channel:'邮件'}]);
 if(p==='/api/ui-prefs')return json({});if(p==='/api/settings')return json({inquirySources:['官网','展会','阿里巴巴']});
 if(p==='/api/version')return json({buildId:'test',updating:false});if(p==='/api/announcement')return json({userId:user.id,read:true,announcement:null});
 if(p.includes('reminder'))return json({items:[],total:0});
 return json([]);
 }
 const file=path.join(root,'public',p==='/'?'index.html':decodeURIComponent(p).slice(1));
 if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});
 missing.push(p);return route.fulfill({status:404,body:'not found'});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
await page.goto('http://crm.test/');await page.waitForSelector('#clientBody tr',{state:'attached'});await page.waitForTimeout(1300);
await page.evaluate(()=>switchView('quotations'));await page.waitForTimeout(300);

const select=()=>page.locator('[data-qt-status-edit=q1]');
const conversionWrites=()=>writes.filter(w=>w.path.endsWith('/convert-to-order'));
// Cancelling a state change sends no write and restores the original select value.
page.once('dialog',d=>d.dismiss());await select().selectOption('已转订单');
await page.waitForTimeout(80);assert.equal(conversionWrites().length,0);assert.equal(await select().inputValue(),'已发送');
// A failed transaction leaves both display and saved quotation at their original state.
convertMode='failure';page.once('dialog',d=>d.accept());await select().selectOption('已转订单');
await page.waitForFunction(()=>!document.querySelector('[data-qt-status-edit=q1]').disabled);
assert.equal(await select().inputValue(),'已发送');assert.equal(quotes[0].status,'已发送');
assert.equal(orders.filter(o=>o.quoteId==='q1').length,0);
// The editor cannot bypass conversion by manually setting the derived state.
await page.evaluate(()=>openQuoteModal('q1'));assert.equal(await page.locator('#modalForm [name=status] option[value="已转订单"]').count(),0);
await page.evaluate(()=>closeModal());await page.waitForTimeout(300);
// One in-flight operation is shared by the dropdown and detail entry points.
convertMode='pending';const before=conversionWrites().length;
page.once('dialog',d=>d.accept());await select().selectOption('已转订单');
await page.waitForTimeout(80);await page.evaluate(()=>convertQuoteToOrder('q1'));
assert.equal(conversionWrites().length,before+1);releaseConversion();
await page.waitForFunction(()=>getAllQuotations().find(q=>q.id==='q1').orderId && qtConverting.size===0);
assert.equal(orders.filter(o=>o.quoteId==='q1').length,1);assert.equal(quotes[0].orderId,'converted-q1');
assert.equal(writes.filter(w=>w.path==='/api/orders'&&w.method==='POST').length,0);
assert.equal(writes.filter(w=>w.path==='/api/quotations/q1'&&w.body.status==='已转订单').length,0);
// A later explicit retry reuses the existing order.
convertMode='success';page.once('dialog',d=>d.accept());await page.evaluate(()=>convertQuoteToOrder('q1'));
assert.equal(orders.filter(o=>o.quoteId==='q1').length,1);
// Legacy records offer a repair action without altering other legacy records automatically.
await page.evaluate(()=>{qtSelectedId='legacy';renderQuotations();});
assert.equal(await page.locator('#qtDetailOrder').innerText(),'补建订单');assert.equal(await page.locator('#qtDetailOrder').isEnabled(),true);
page.once('dialog',d=>d.accept());await page.locator('#qtDetailOrder').click();
await page.waitForFunction(()=>getAllQuotations().find(q=>q.id==='legacy').orderId && qtConverting.size===0);
assert.equal(orders.filter(o=>o.quoteId==='legacy').length,1);
assert.equal(await page.locator('#qtDetailOrder').innerText(),'已关联订单');
await page.setViewportSize({width:802,height:791});await page.screenshot({path:path.join(out,'quote-order-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'quote-order-mobile.png'),fullPage:true});
assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
console.log(JSON.stringify({passed:true,cancelRestoresState:true,failureRestoresState:true,singleConversionRequest:true,pendingDuplicateBlocked:true,retryReusesOrder:true,legacyRepair:true,manualStatusBypassRemoved:true,errors,missing}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
