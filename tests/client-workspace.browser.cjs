const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');fs.mkdirSync(out,{recursive:true});
const today=new Date().toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
const user={id:'u1',username:'demo',name:'陈晓',role:'admin'},users=[user,{id:'u2',username:'limin',name:'李敏',role:'sales'}];
let clients=Array.from({length:55},(_,i)=>({id:'c'+i,company:['Atlas Machinery','Nova Industrial','Sol Manufacturing','Delta Packaging','Northstar Co.','Prime Equipment'][i%6]+(i>=6?' Group':''),country:['阿联酋','德国','墨西哥','泰国','加拿大','英国'][i%6],contactName:['Omar Hassan','Anna Weber','Carlos Ruiz','Niran','James','Oliver'][i%6],contactEmail:'contact'+i+'@example.com',contactPhone:'+12025550123',owner:i%2?'u2':'u1',ownerName:i%2?'李敏':'陈晓',stage:['A','S','B','C'][i%4],source:['阿里巴巴','官网','展会'][i%3],tags:[i%2?'经销商':'终端客户'],star:i%3===0,productInterest:'包装机 CA-320',nextFollowUp:i%3===0?yesterday:'',createdAt:Date.now()-i*86400000,updatedAt:Date.now()}));
const orders=Array.from({length:55},(_,i)=>({id:'o'+i,orderNo:'CA2609'+i,clientId:'c'+i,clientName:clients[i].company,owner:'u1',amount:12800+i*900,currency:'USD',status:'生产中',orderDate:new Date(2026,8-i,10).toISOString().slice(0,10),createdAt:Date.now()}));
const inquiries=clients.map((c,i)=>({id:'i'+i,clientId:c.id,clientName:c.company,country:c.country,owner:'u1',ownerName:'陈晓',product:'包装机采购方案',status:['新询盘','已报价','等回复','谈判中','成交'][i%5],receivedAt:today,nextFollowAt:i<3?yesterday:'',expectedAmount:18800,currency:'USD',updatedAt:Date.now()}));
let tasks=[{id:'t1',title:'确认 Atlas 包装机配置',dueDate:today,priority:'高',status:'待办',owner:'u1',clientName:'Atlas Machinery'},{id:'t2',title:'整理本周出货资料',dueDate:yesterday,priority:'中',status:'待办',owner:'u1'}];
let quotes=[{id:'q1',quoteNo:'QT260929',clientId:'c0',clientName:clients[0].company,owner:'u1',ownerName:'陈晓',createdAt:Date.now(),currency:'USD',status:'已发送',version:1,tradeTerms:'FOB',depositPercent:30,items:[{type:'equipment',name:'包装机',description:'CA-320',qty:2,unit:'SET',unitPrice:12000}]}];
let fx=7.12;const writes=[],errors=[],consoleErrors=[],missing=[];

let held=true,failClients=false,releaseClients;
const gate=new Promise(resolve=>releaseClients=resolve);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FTW_CHROME});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname;
  if(u.hostname!=='crm.test')return route.abort();
  if(p.startsWith('/api/')){
   if(p==='/api/clients'&&held)await gate;
   if(p==='/api/clients'&&failClients)return route.fulfill({status:503,json:{error:'Unavailable test'}});
   if(req.method()!=='GET'){
    writes.push({path:p,method:req.method(),body:req.postDataJSON()});
    if(p.startsWith('/api/clients/')){const c=clients.find(c=>c.id===p.split('/').pop());if(c)Object.assign(c,req.postDataJSON());return route.fulfill({json:c||{}});}
    return route.fulfill({json:{ok:true}});
   }
   const data={'/api/me':user,'/api/users':users,'/api/clients':clients,'/api/orders':orders,'/api/inquiries':inquiries,'/api/tasks':tasks,'/api/quotations':quotes,
    '/api/rates':{base:'USD',rates:{USD:1,CNY:7.12,EUR:.92,GBP:.78,AED:3.67},source:'测试汇率',updated:Date.now()},
    '/api/settings':{inquirySources:['官网']},'/api/ui-prefs':{},'/api/version':{buildId:'test',updating:false},'/api/announcement':{userId:user.id,read:true,announcement:null}};
   return route.fulfill({json:data[p]??[]});
  }
  const file=path.join(root,'public',p==='/'?'index.html':decodeURIComponent(p).slice(1));
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});
  missing.push(p);return route.fulfill({status:404,body:'not found'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://crm.test/#/clients');await page.locator('#clientDataState').waitFor({state:'visible'});
 assert.match(await page.locator('#clientDataState').innerText(),/正在加载/);assert.equal(await page.locator('#clientCards .client-empty').isVisible(),false);
 held=false;releaseClients();await page.waitForFunction(()=>dashSources.get('core')==='ready'&&getAllInquiries().length===55);
 await page.waitForFunction(()=>document.querySelector('#clientBody').rows.length===20);
 assert.equal(await page.locator('#clientCards .client-card').count(),20);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.cl-table th[data-col="contact"]')).display==='none');
 assert.equal(await page.locator('.cl-table th[data-col=follow]').isVisible(),true);
 assert.equal(await page.locator('#view-clients').getAttribute('data-client-view'),'table');
 assert(await page.evaluate(()=>{renderClients();const table=document.querySelector('.cl-table'),visible=row=>Array.from(row.cells).filter(c=>getComputedStyle(c).display!=='none').map(c=>c.dataset.col).join('|');return Array.from(table.tBodies[0].rows).every(row=>visible(row)===visible(table.tHead.rows[0]));}),'headers and rows must align in the same render');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'clients-default-desktop.png'),animations:'disabled'});
 await page.locator('#clientSelectPage').check();assert.match(await page.locator('#clientBatchInfo').textContent(),/20/);
 await page.locator('[data-client-page="2"]').click();assert.equal(await page.locator('#clientSelectPage').isChecked(),false);
 await page.locator('#clientBody .cb-client').first().check();assert.match(await page.locator('#clientBatchInfo').textContent(),/21/);assert.equal(await page.locator('#cbClientAll').isChecked(),false);
 await page.locator('[data-client-view=cards]').click();assert.equal(await page.locator('#clientCards .client-card-check').first().isChecked(),true);
 assert.equal(await page.locator('.cl-panel').isVisible(),false);
 await page.locator('#clientSelectionClear').click();assert.match(await page.locator('#clientBatchInfo').textContent(),/0/);
 await page.locator('[data-client-summary-scope=new]').click();assert.equal(await page.evaluate(()=>clientPage),1);assert.match(await page.locator('#clientResultCount').textContent(),/30 个/);
 await page.locator('#clientFilterChips [data-client-clear=scope]').click();assert.match(await page.locator('#clientResultCount').textContent(),/55 个/);
 await page.locator('[data-client-scope=high]').click();assert.equal(await page.evaluate(()=>clientPageRows.every(c=>['S','A'].includes(c.stage))),true);
 await page.locator('[data-client-clear-all]').click();
 await page.locator('#clientPageSize').selectOption('50');assert.equal(await page.locator('#clientCards .client-card').count(),50);
 await page.locator('[data-client-page="2"]').click();assert.equal(await page.locator('#clientCards .client-card').count(),5);
 await page.reload();await page.waitForFunction(()=>dashSources.get('core')==='ready');assert.equal(await page.locator('#clientPageSize').inputValue(),'50');assert.equal(await page.locator('#view-clients').getAttribute('data-client-view'),'cards');
 await page.locator('#clientCards [data-client-new-task]').first().click();assert(await page.locator('#modal.open').isVisible());assert.match(await page.locator('#modalForm').innerText(),/客户/);assert.equal(await page.locator('#modalForm [name=related]').inputValue(),'client:c0');await page.evaluate(()=>closeModal());
 // Saved columns must survive both render modes and reloads.
 const saved={hiddenKeys:['source','follow'],labelKeys:{owner:'负责人（自定义）'}};
 await page.evaluate(saved=>{localStorage.setItem('ftw_table_cols_v1',JSON.stringify({clientBody:saved}));localStorage.setItem('ftw_client_col_order',JSON.stringify(['check','name','owner','star','country','contact','phase','grade','source','phone','prod','comm','health','ai','created','follow','rel','ops']));localStorage.setItem('ftw_client_col_widths',JSON.stringify({name:260}));},saved);
 await page.reload();await page.waitForFunction(()=>dashSources.get('core')==='ready');await page.locator('[data-client-view=table]').click();await page.waitForFunction(()=>document.querySelector('.cl-table th[data-col=follow]').classList.contains('col-hidden'));
 assert.equal(await page.locator('.cl-table th[data-col=contact]').isVisible(),true);assert.match(await page.locator('.cl-table th[data-col=owner]').textContent(),/自定义/);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('ftw_table_cols_v1')).clientBody),saved);
 await page.screenshot({path:path.join(out,'clients-desktop.png'),fullPage:true,animations:'disabled'});
 // Mobile uses cards automatically for a first-time account preference.
 await page.evaluate(()=>localStorage.removeItem(clientPreferenceKey()));await page.setViewportSize({width:390,height:844});await page.reload();await page.waitForFunction(()=>dashSources.get('core')==='ready');
 assert.equal(await page.locator('#view-clients').getAttribute('data-client-view'),'cards');assert.equal(await page.locator('#clientFilterPanel').isVisible(),false);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'clients-default-mobile.png'),animations:'disabled'});
 await page.locator('#clientFilterToggle').click();assert(await page.locator('#cfOwner').locator('..').isVisible());
 await page.evaluate(()=>{const field=document.getElementById('cfFollow');field.value='missing';field.dispatchEvent(new Event('change',{bubbles:true}));});await page.locator('#clientFilterToggle').click();assert(await page.locator('#clientFilterChips [data-client-clear=cfFollow]').isVisible());
 await page.locator('#clientFilterChips [data-client-clear=cfFollow]').click();assert.match(await page.locator('#clientResultCount').textContent(),/55 个/);
 for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'clients-mobile.png'),fullPage:true,animations:'disabled'});
 failClients=true;await page.evaluate(()=>loadAll().catch(()=>{}));await page.waitForFunction(()=>document.querySelector('#view-clients').dataset.clientState==='error');assert(await page.locator('[data-client-retry]').isVisible());
 failClients=false;await page.locator('[data-client-retry]').click();await page.waitForFunction(()=>dashSources.get('core')==='ready');
 // No results and first use both offer a working action.
 await page.locator('#clientSearch').fill('no-such-client');assert(await page.locator('#clientCards [data-client-clear-all]').isVisible());await page.locator('#clientCards [data-client-clear-all]').click();assert.equal(await page.locator('#clientCards .client-card').count(),20);
 clients=[];await page.evaluate(()=>loadAll());await page.waitForFunction(()=>dashSources.get('core')==='ready');assert(await page.locator('#clientCards [data-client-add]').isVisible());await page.locator('#clientCards [data-client-add]').click();assert(await page.locator('#modal.open').isVisible());await page.evaluate(()=>closeModal());
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);console.log(JSON.stringify({passed:true,pagination:true,crossPageSelection:true,sharedViews:true,preferencesPreserved:true,mobileFilters:true,emptyAndFailure:true,widths:[320,390,768,1024,1440],errors,writes:writes.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
