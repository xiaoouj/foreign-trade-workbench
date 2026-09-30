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
  if(p.startsWith('/api/quotations/')){const {reviseQuote}=await import('../sales-records.js');const i=quotes.findIndex(q=>q.id===p.split('/').pop());quotes[i]=reviseQuote(quotes[i],req.postDataJSON(),user,Date.now());return json(quotes[i]);}
  if(p.startsWith('/api/orders/')){const o=orders.find(o=>o.id===p.split('/').pop());Object.assign(o,req.postDataJSON());return json(o);}
  if(p.startsWith('/api/clients/')){let c=clients.find(c=>c.id===p.split('/').pop());if(c)Object.assign(c,req.postDataJSON());return json(c||{});}
  if(p==='/api/clients'){const c={id:'added',...req.postDataJSON()};clients.push(c);return route.fulfill({status:201,json:c});}
  if(p.startsWith('/api/tasks/')){const t=tasks.find(t=>t.id===p.split('/').pop());Object.assign(t,req.postDataJSON());return json(t);}
  return json({ok:true});
 }
 if(p==='/api/sales')return json({yearMonthly:Object.fromEntries(Array.from({length:12},(_,i)=>['2026-'+String(i+1).padStart(2,'0'),100000])),canEdit:true,budget:{2026:{company:1200000,allocated:500000,remaining:700000}}});
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
assert.equal(await page.locator('html').getAttribute('data-theme-style'),'blue');assert.equal(await page.locator('html').getAttribute('data-fui'),null);
await page.screenshot({path:path.join(out,'01-dashboard-desktop.png'),fullPage:true});
assert(await page.locator('#worldClocks').isVisible());assert(await page.locator('#rateRefreshBtn').isVisible());
const clockBefore=await page.locator('.ftw-clock-item time').first().textContent();await page.waitForTimeout(1100);assert.notEqual(await page.locator('.ftw-clock-item time').first().textContent(),clockBefore);
await page.locator('#ftwClockSettings').click();assert(await page.locator('#ftwClockSearch').isVisible());await page.keyboard.press('Escape');await page.evaluate(()=>closeModal());
fx=7.25;await page.locator('#rateRefreshBtn').click();await page.waitForTimeout(150);assert.equal(await page.locator('#rc1').textContent(),'7.2500');
fx=7.3;await page.locator('#tbRate').click();await page.waitForTimeout(150);assert.equal(await page.locator('#rc1').textContent(),'7.3000');
await page.locator('.nav-item[data-view=clients]').click();await page.waitForTimeout(250);
assert.equal(await page.locator('#csAll').textContent(),'12');assert.equal(await page.locator('#csStar').textContent(),'4');
await page.locator('#toast').waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'02-clients-desktop.png'),fullPage:true});
await page.locator('[data-client-scope=mine]').click();assert.equal(await page.locator('#clientBody tr').count(),6);
await page.locator('[data-client-scope=star]').click();assert.equal(await page.locator('#clientBody tr').count(),4);
await page.locator('[data-client-scope=due]').click();assert.equal(await page.locator('#clientBody tr').count(),4);
await page.locator('[data-client-scope=all]').click();await page.locator('#clientSearch').fill('does-not-exist');assert.match(await page.locator('#clientBody').innerText(),/没有符合条件/);await page.locator('#clientSearch').fill('Atlas');assert.equal(await page.locator('#clientBody tr').count(),2);await page.locator('#clientSearchClear').click();
await page.locator('[data-peek-c=c0]').click();assert(await page.locator('#clientDrawer').isVisible());await page.waitForTimeout(300);assert(await page.evaluate(()=>scrollX===0),'drawer focus must not scroll horizontally');await page.screenshot({path:path.join(out,'03-client-drawer.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await page.locator('#clientDrawer').getAttribute('aria-hidden'),'true');
await page.locator('#clientAdd').click();assert(await page.locator('#modal.open').isVisible());await page.screenshot({path:path.join(out,'04-client-form.png'),fullPage:true});await page.evaluate(()=>closeModal());
await page.locator('#clientColCfg').click();assert(await page.locator('#modal.open').isVisible());await page.evaluate(()=>closeModal());
await page.locator('.cl-more summary').click();await page.locator('#clientEditMode').click();assert(await page.locator('#clientBatchBar').isVisible());assert.equal(await page.locator('.cl-more').getAttribute('open'),null);
await page.locator('.cb-client').first().check();assert.match(await page.locator('#clientBatchInfo').textContent(),/1/);
await page.locator('.cl-more summary').click();await page.locator('#clientEditMode').click();
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'05-clients-mobile.png'),fullPage:true});
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile customers overflow');
await page.evaluate(()=>switchView('dashboard'));await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'06-dashboard-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile dashboard overflow');
await page.setViewportSize({width:1440,height:1050});await page.evaluate(()=>switchView('settings'));await page.waitForTimeout(200);assert.equal(await page.locator('[data-style]').count(),0);assert.equal(await page.locator('[data-mode]').count(),0);
for(const view of ['orders','quotations','enquiry','client-detail']){await page.evaluate(view=>{if(view==='client-detail')viewClientDetail('c0');else switchView(view)},view);await page.waitForTimeout(120);assert(await page.locator('#view-'+view).isVisible());}
// Sales layout and manual ratio persistence through reload.
await page.evaluate(()=>openOrderDetail('o0'));await page.waitForTimeout(150);
assert.equal(await page.locator('.sales-milestones li').count(),5);assert(!await page.locator('#view-order-detail').innerText().then(t=>t.includes('验货')));
await page.locator('#salesProgressEdit').click();await page.locator('[data-percent-preset=productionProgress]').selectOption('70');await page.locator('#modalForm').evaluate(f=>f.requestSubmit());await page.waitForTimeout(150);assert.equal(orders[0].productionProgress,70);
await page.locator('#salesPaymentEdit').click();await page.locator('[data-percent-preset=depositPercent]').selectOption('30');await page.locator('[name=paidPercent]').fill('12.5');await page.locator('#modalForm').evaluate(f=>f.requestSubmit());await page.waitForTimeout(150);assert.equal(orders[0].depositPercent,30);assert.equal(orders[0].paidPercent,12.5);
await page.reload();await page.waitForTimeout(700);assert.match(await page.locator('.sales-progress-label').innerText(),/70%/);assert.match(await page.locator('.sales-payment-cards').innerText(),/12.5%/);
await page.screenshot({path:path.join(out,'07-order-desktop.png'),fullPage:true});
await page.locator('[data-order-doc=pi]').first().click();await page.waitForTimeout(150);assert.equal(await page.locator('#d_docNo').inputValue(),'CA26090');
await page.evaluate(()=>switchView('quotations'));await page.waitForTimeout(150);assert.match(await page.locator('#qtSelectedDetail').innerText(),/修改节点/);
await page.locator('#qtDetailEdit').click();await page.locator('#modalForm [name=notes]').fill('增加备件包');await page.locator('#modalForm').evaluate(f=>f.requestSubmit());await page.waitForTimeout(200);assert.equal(quotes[0].version,2);
await page.locator('#qtDetailEdit').click();await page.locator('#modalForm').evaluate(f=>f.requestSubmit());await page.waitForTimeout(200);assert.equal(quotes[0].version,2);assert.match(await page.locator('.sales-quote-history').innerText(),/第 1 轮修改/);
await page.locator('[data-qt-revision]').first().click();assert.match(await page.locator('#modalForm').innerText(),/增加备件包/);await page.evaluate(()=>closeModal());await page.locator('#modal.open').waitFor({state:'hidden'});await page.locator('#toast').waitFor({state:'hidden'});
await page.screenshot({path:path.join(out,'08-quotations-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'09-quotations-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'quotes overflow');
await page.evaluate(()=>openOrderDetail('o0'));await page.waitForTimeout(100);await page.screenshot({path:path.join(out,'10-order-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'order overflow');await page.setViewportSize({width:1440,height:1050});
// Mutation regressions use only the intercepted synthetic API above.
await page.evaluate(()=>switchView('clients'));await page.waitForTimeout(100);
await page.locator('#clientAdd').click();await page.locator('#modalForm [name=company]').fill('Browser Test Customer');await page.locator('#modalForm [name=contactEmail]').fill('test@example.com');
await page.locator('#modalForm').evaluate(form=>form.requestSubmit());await page.waitForTimeout(350);assert(writes.some(w=>w.method==='POST'&&w.path==='/api/clients'&&w.body.company==='Browser Test Customer'));
await page.locator('[data-edit-c=added]').click();await page.locator('#modalForm [name=contactName]').fill('Updated Contact');await page.locator('#modalForm').evaluate(form=>form.requestSubmit());await page.waitForTimeout(350);assert.equal(clients.find(c=>c.id==='added').contactName,'Updated Contact');
await page.locator('[data-star-c=added]').click();await page.waitForTimeout(150);assert.equal(clients.find(c=>c.id==='added').star,true);assert.equal(await page.locator('#csStar').textContent(),'5');
await page.evaluate(()=>switchView('dashboard'));await page.waitForTimeout(350);await page.locator('[data-done=t1]').check();await page.waitForTimeout(150);assert.equal(tasks[0].status,'已完成');
// Existing custom column choices remain usable after the theme migration.
await page.evaluate(()=>{localStorage.setItem('ftw_table_cols_v1',JSON.stringify({clientBody:{hiddenKeys:['country'],labelKeys:{contact:'客户联系人'}}}));location.hash='/clients';});
await page.reload();await page.waitForTimeout(700);assert(await page.locator('.cl-table th[data-col=phone]').isVisible());assert.equal(await page.locator('.cl-table th[data-col=country]').isVisible(),false);assert.equal(await page.locator('.cl-table th[data-col=contact]').textContent(),'客户联系人');
assert.equal(await page.getByText('公海客户',{exact:true}).count(),0);
// Four requested refinements: responsive alignment, yearly archive, charts and mail retirement.
await page.evaluate(()=>switchView('dashboard'));await page.waitForTimeout(400);
for(const width of [1456,1920,2560]){
 await page.setViewportSize({width,height:1100});await page.waitForTimeout(150);
 const boxes=await page.locator('#view-dashboard>.stat-row>.stat-card').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}));assert.equal(new Set(boxes.map(r=>Math.round(r.top))).size,1);assert.equal(new Set(boxes.map(r=>Math.round(r.bottom))).size,1);
 const aligned=await page.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();const pairs=[['#worldClocks','#view-dashboard .rate-card'],['#view-dashboard .section-grid>.panel:nth-child(2)','#view-dashboard .dashboard-revenue'],['#view-dashboard .todo-card','#view-dashboard .ai-chat-card']];return pairs.map(([a,b])=>{const x=rect(a),y=rect(b);return Math.abs(x.top-y.top)<2&&Math.abs(x.bottom-y.bottom)<2;});});assert(aligned.every(Boolean),'dashboard row alignment at '+width);
 await page.screenshot({path:path.join(out,'refine-dashboard-'+width+'.png'),fullPage:true});
}
orders.push({id:'old24',orderNo:'OLD-2024',clientId:'c0',clientName:clients[0].company,orderDate:'2024-06-03',amount:6000,currency:'CNY',status:'已收款'},{id:'old25',orderNo:'OLD-2025',clientId:'c0',clientName:clients[0].company,orderDate:'2025-01-02',amount:9000,currency:'CNY',status:'已收款'},{id:'no-date',orderNo:'UNDATED',clientId:'c0',clientName:clients[0].company,amount:100,currency:'CNY',status:'待确认'});
await page.evaluate(()=>loadAll());await page.waitForTimeout(250);await page.setViewportSize({width:1456,height:1000});await page.evaluate(()=>viewClientDetail('c0'));await page.waitForTimeout(120);
assert.equal(await page.locator('#cdYear').inputValue(),'2026');await page.locator('#cdYear').selectOption('2024');assert.match(await page.locator('[data-client-section=orders]').innerText(),/OLD-2024/);assert(!await page.locator('[data-client-section=orders]').innerText().then(t=>t.includes('OLD-2025')));assert.match(await page.locator('.client-year-summary').innerText(),/6,000/);await page.screenshot({path:path.join(out,'refine-client-year.png'),fullPage:true});
await page.locator('#cdYear').selectOption('unknown');assert.match(await page.locator('[data-client-section=orders]').innerText(),/UNDATED/);await page.locator('#cdYear').selectOption('all');assert.equal(await page.locator('[data-client-order]').count(),4);await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'client archive mobile overflow');await page.screenshot({animations:'disabled',path:path.join(out,'refine-client-mobile.png'),fullPage:true});await page.setViewportSize({width:1456,height:1000});await page.waitForTimeout(300);
await page.evaluate(()=>switchView('performance'));await page.waitForTimeout(350);assert.equal(await page.locator('#pfMonthlyChart svg').count(),1);assert.equal(await page.locator('#pfCumulative svg').count(),1);assert.equal(await page.locator('#pfStatus svg').count(),1);assert.match(await page.locator('#pfTarget').innerText(),/100,000/);
await page.locator('[data-perf-mode=table]').click();assert.equal(await page.locator('#pfMonthlyChart tbody tr').count(),12);await page.locator('[data-perf-mode=chart]').click();await page.locator('#pfMonthlyChart [data-perf-month="2026-08"]').click();assert.equal(await page.locator('#perfDate').inputValue(),'2026-08');
await page.locator('#view-performance [data-period=year]').click();await page.waitForTimeout(550);console.log('GEOMETRY',await page.evaluate(()=>({x:scrollX,w:innerWidth,doc:document.documentElement.scrollWidth,sidebar:document.querySelector('.sidebar').getBoundingClientRect().toJSON(),content:document.querySelector('.content').getBoundingClientRect().toJSON(),periods:[...document.querySelectorAll('[data-period]')].map(b=>[b.dataset.period,b.className])})));assert(await page.evaluate(()=>scrollX===0&&document.documentElement.scrollWidth<=innerWidth+1),'desktop performance overflow');await page.screenshot({animations:'disabled',path:path.join(out,'refine-performance-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(550);await page.screenshot({animations:'disabled',path:path.join(out,'refine-performance-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'performance mobile overflow');
await page.evaluate(()=>{currentUser={id:'u2',role:'sales',name:'李敏'};refreshPerfOwners();document.querySelector('#perfOwner').value='company';salesConfig={yearMonthly:{'2026-09':100000},actual:{monthly:{'2026-09':{count:2,invalidCount:0,amounts:{CNY:50000}}}}};renderPerformance();});assert.equal(await page.locator('#pfStatus svg').count(),0);assert.match(await page.locator('#pfStatus').innerText(),/汇总/);
await page.evaluate(()=>switchView('settings'));await page.waitForTimeout(150);assert.equal(await page.locator('#setMail').count(),0);assert.equal(await page.locator('#mailSettingsPanel').count(),0);await page.evaluate(()=>switchView('mail'));await page.waitForTimeout(150);assert.equal(await page.locator('#mailSettings').count(),0);assert.equal(await page.getByText('配置 IMAP',{exact:true}).count(),0);
fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({errors,consoleErrors,missing,writes},null,2));
assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,errors,consoleErrors,missing,writes:writes.length}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
