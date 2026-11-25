const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');fs.mkdirSync(out,{recursive:true});
const today=new Date().toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
const user={id:'u1',username:'demo',name:'陈晓',role:'admin'},users=[user,{id:'u2',username:'limin',name:'李敏',role:'sales'}];
let clients=Array.from({length:12},(_,i)=>({id:'c'+i,company:['Atlas Machinery','Nova Industrial','Sol Manufacturing','Delta Packaging','Northstar Co.','Prime Equipment'][i%6]+(i>=6?' Group':''),country:['阿联酋','德国','墨西哥','泰国','加拿大','英国'][i%6],contactName:['Omar Hassan','Anna Weber','Carlos Ruiz','Niran','James','Oliver'][i%6],contactEmail:'contact'+i+'@example.com',contactPhone:'+12025550123',owner:i%2?'u2':'u1',ownerName:i%2?'李敏':'陈晓',stage:['A','S','B','C'][i%4],source:['阿里巴巴','官网','展会'][i%3],tags:[i%2?'经销商':'终端客户'],star:i%3===0,productInterest:'包装机 CA-320',nextFollowUp:i%3===0?yesterday:'',createdAt:Date.now()-i*86400000,updatedAt:Date.now()}));
const orders=[{"id": "paid", "orderNo": "ST02260128", "status": "已收款", "orderDate": "2026-10-19"}, {"id": "production", "orderNo": "ST01260110", "status": "生产中", "orderDate": "2026-10-12", "createdAt": "2026-10-21T00:00:00Z"}, {"id": "pending", "orderNo": "ST02260127", "status": "待确认", "orderDate": null, "createdAt": "2026-10-19T16:30:00Z"}, {"id": "confirmed", "orderNo": "ST02260125", "status": "已确认", "orderDate": "2026-10-12"}, {"id": "paidMissing", "orderNo": "ST02260090", "status": "已收款", "createdAt": "2026-10-18T00:00:00Z"}, {"id": "shipped", "orderNo": "ST02260101", "status": "已发货", "orderDate": "2026-10-17"}, {"id": "confirmedMissing", "orderNo": "ST02260088", "status": "已确认", "createdAt": "2026-10-16T00:00:00Z"}, {"id": "complete", "orderNo": "ST02260077", "status": "已完成", "orderDate": "2026-10-15"}, {"id": "cancelled", "orderNo": "ST02260066", "status": "已取消", "orderDate": "invalid", "createdAt": "2026-10-14T00:00:00Z"}, {"id": "unknown", "orderNo": "ST99999999", "status": "待确认", "orderDate": null, "createdAt": null}].map(o=>({clientName:'日期排序测试',owner:'u1',amount:100,currency:'CNY',...o}));
const inquiries=clients.map((c,i)=>({id:'i'+i,clientId:c.id,clientName:c.company,country:c.country,owner:'u1',ownerName:'陈晓',product:'包装机采购方案',status:['新询盘','已报价','等回复','谈判中','成交'][i%5],receivedAt:today,nextFollowAt:i<3?yesterday:'',expectedAmount:18800,currency:'USD',updatedAt:Date.now()}));
let tasks=[{id:'t1',title:'确认 Atlas 包装机配置',dueDate:today,priority:'高',status:'待办',owner:'u1',clientName:'Atlas Machinery'},{id:'t2',title:'整理本周出货资料',dueDate:yesterday,priority:'中',status:'待办',owner:'u1'}];
let quotes=[{id:'q1',quoteNo:'QT260929',clientId:'c0',clientName:clients[0].company,owner:'u1',ownerName:'陈晓',createdAt:Date.now(),currency:'USD',status:'已发送',version:1,tradeTerms:'FOB',depositPercent:30,items:[{type:'equipment',name:'包装机',description:'CA-320',qty:2,unit:'SET',unitPrice:12000}]}];
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
await page.evaluate(()=>switchView('orders'));await page.waitForTimeout(300);

const rowIds=()=>page.locator('#orderBody .cb-order').evaluateAll(xs=>xs.map(x=>x.dataset.oid));
const expected=['pending','paid','paidMissing','shipped','confirmedMissing','complete','cancelled','confirmed','production','unknown'];
await page.waitForTimeout(150);assert.deepEqual(await rowIds(),expected);
const shown=await page.locator('#orderBody tr').evaluateAll(rows=>rows.map(row=>row.querySelector('[data-col=c7]').textContent));
assert.deepEqual(shown,['2026-10-20','2026-10-19','2026-10-18','2026-10-17','2026-10-16','2026-10-15','2026-10-14','2026-10-12','2026-10-12','-']);
assert.match(await page.locator('#orderBody tr').first().locator('[data-col=c7]').getAttribute('title'),/创建日期/);
for(const status of ['待确认','已确认','生产中','已发货','已收款','已完成','已取消']){
 await page.locator('#orderStatusFilter').selectOption(status);await page.waitForTimeout(120);
 assert.deepEqual(await rowIds(),expected.filter(id=>orders.find(o=>o.id===id).status===status),status);
}
await page.locator('#orderFilterReset').click();
await page.locator('#orderYearFilter').selectOption('2026');await page.locator('#orderMonthFilter').selectOption('10');
assert.deepEqual(await rowIds(),expected.slice(0,-1));
await page.locator('#orderFilterReset').click();
// Date header sorting must leave truly unknown dates last in either direction.
const dateHeader=page.locator('#view-orders th[data-col=c7]');
await dateHeader.click();await page.waitForTimeout(200);
const ascending=await rowIds();assert.equal(ascending[0],'confirmed');assert.equal(ascending.at(-1),'unknown');
await dateHeader.click();await page.waitForTimeout(200);assert.deepEqual(await rowIds(),expected);
// Filtering while a header sort is active and clearing it both recover correctly.
await page.locator('#orderStatusFilter').selectOption('已收款');await page.waitForTimeout(200);assert.deepEqual(await rowIds(),['paid','paidMissing']);
await dateHeader.click();await page.waitForTimeout(180);assert.equal(await dateHeader.getAttribute('data-sort'),null);
await page.locator('#orderFilterReset').click();await page.waitForTimeout(180);assert.deepEqual(await rowIds(),expected);
// Changing only payment state must not move an order to a different date position.
await page.evaluate(()=>{orders.find(o=>o.id==='pending').status='已收款';renderOrders();});await page.waitForTimeout(180);assert.deepEqual(await rowIds(),expected);
assert.equal(orders.find(o=>o.id==='pending').orderDate,null);assert.equal(writes.length,0);
await page.setViewportSize({width:802,height:791});await page.screenshot({path:path.join(out,'order-date-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'order-date-mobile.png'),fullPage:true});
assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
console.log(JSON.stringify({passed:true,mixedStatusDateOrder:true,missingDateFallback:true,allStatusFilters:true,yearMonthFilter:true,manualDateSort:true,unknownDatesLast:true,clearRestoresDefault:true,statusChangeKeepsPosition:true,businessWrites:writes.length,errors}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
