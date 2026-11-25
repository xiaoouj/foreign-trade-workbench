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

let empty=false, fail='', held=true, release;
const gate=new Promise(resolve=>release=resolve);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FTW_CHROME});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  await context.route('**/*', async route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   if(u.hostname!=='crm.test')return route.abort();
   if(p.startsWith('/api/')){
    if(p==='/api/inquiries'&&held)await gate;
    if(p===fail)return route.fulfill({status:503,json:{error:'test unavailable'}});
    const data={
     '/api/me':user,'/api/users':users,'/api/clients':empty?[]:clients,'/api/orders':empty?[]:orders,
     '/api/inquiries':empty?[]:inquiries,'/api/tasks':empty?[]:tasks,'/api/quotations':empty?[]:quotes,
     '/api/rates':{base:'USD',rates:{USD:1,CNY:7.12,EUR:.92,GBP:.78,AED:3.67},source:'测试汇率',updated:Date.now()},
     '/api/settings':{inquirySources:['官网']},'/api/ui-prefs':{},
     '/api/version':{buildId:'test',updating:false},'/api/announcement':{userId:user.id,read:true,announcement:null}
    };
    return route.fulfill({json:data[p]??[]});
   }
   const file=path.join(root,'public',p==='/'?'index.html':decodeURIComponent(p).slice(1));
   if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});
   return route.fulfill({status:404,body:'not found'});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://crm.test/');
  await page.waitForFunction(()=>dashSources.get('core')==='ready');
  assert.equal(await page.locator('#statFollow').evaluate(e=>e.closest('.stat-card').getAttribute('aria-busy')),'true');
  assert.equal(await page.locator('#todoList .dash-feedback').count(),1);
  assert.equal(await page.locator('#todoList .dash-empty').isVisible(),false);
  await page.screenshot({path:path.join(out,'home-loading.png'),fullPage:true,animations:'disabled'});
  held=false;release();
  await page.waitForFunction(()=>[...dashSources.values()].every(s=>s==='ready'));
  await page.waitForFunction(()=>!document.querySelector('#view-dashboard .dash-loading'));
  assert.equal(await page.locator('#statFollow').textContent(),'3');
  assert.equal(await page.locator('#statTasksToday').textContent(),'2','include overdue tasks');
  assert.equal(await page.locator('#statFollow').evaluate(e=>getComputedStyle(e.parentElement).color),'rgb(20, 26, 46)');
  assert.equal(await page.locator('#statMonthRevenue').evaluate(e=>getComputedStyle(e.parentElement).color),'rgb(20, 26, 46)');
  assert.match(await page.locator('#dashHint').textContent(),/3 条询盘.*2 项/);
  await page.keyboard.press('Control+k');assert.equal(await page.locator('#globalSearch').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');
  await page.evaluate(()=>{openClientModal();document.querySelector('#modalForm input').focus()});await page.keyboard.press('Control+k');assert.equal(await page.locator('#globalSearch').evaluate(e=>e===document.activeElement),false);await page.evaluate(()=>closeModal());
  await page.locator('#ftwClockToggle').click();assert.equal(await page.locator('#ftwClockGrid').isVisible(),false);
  await page.reload();await page.waitForFunction(()=>[...dashSources.values()].every(s=>s==='ready'));assert.equal(await page.locator('#ftwClockToggle').getAttribute('aria-expanded'),'false');
  await page.locator('#ftwClockToggle').click();assert(await page.locator('#ftwClockGrid').isVisible());
  await page.screenshot({path:path.join(out,'home-desktop.png'),fullPage:true,animations:'disabled'});
  for(const width of [320,390,768,1024,1440]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);
   assert(await page.locator('#flowSearchOpen').isVisible(),'search visible '+width);
   const columns=await page.locator('#view-dashboard>.stat-row').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);assert.equal(columns,width<=768?2:width<=1250?3:6);
   if(width===390)await page.screenshot({path:path.join(out,'home-mobile.png'),fullPage:true,animations:'disabled'});
  }
  await page.locator('#statFollow').evaluate(e=>e.closest('.stat-card').focus());await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#view-enquiry').classList.contains('active'));
  assert.equal(await page.locator('#inqFollowScope').inputValue(),'due');
  await page.evaluate(()=>switchView('dashboard'));await page.waitForFunction(()=>[...dashSources.values()].every(s=>s==='ready'));
  empty=true;await page.reload();await page.waitForFunction(()=>[...dashSources.values()].every(s=>s==='ready'),null,{timeout:8000}).catch(async error=>{console.log(await page.evaluate(()=>({states:[...dashSources],pending:[...dashPending],hint:document.querySelector('#dashHint').textContent})));console.log(errors);throw error});await page.waitForFunction(()=>document.querySelector('#pipelineList .dash-empty')!==null);
  assert(await page.locator('#todoList .dash-empty button').isVisible());assert(await page.locator('#oppList .dash-empty button').isVisible());
  await page.screenshot({path:path.join(out,'home-empty.png'),fullPage:true,animations:'disabled'});
  await page.locator('#pipelineList [data-dash-create]').click();assert(await page.locator('#modal.open').isVisible());await page.evaluate(()=>closeModal());
  await page.evaluate(()=>switchView('dashboard'));fail='/api/inquiries';
  await page.evaluate(()=>loadInquiries().catch(()=>{}));await page.waitForFunction(()=>document.querySelector('#todoList').classList.contains('dash-failed'));
  assert.equal(await page.locator('#statFollow').evaluate(e=>e.closest('.stat-card').classList.contains('dash-failed')),true);
  assert.equal(await page.locator('#todoList .dash-empty').isVisible(),false);
  await page.screenshot({path:path.join(out,'home-error.png'),fullPage:true,animations:'disabled'});
  fail='';await page.locator('#todoList [data-dash-retry]').click();await page.waitForFunction(()=>dashSources.get('inquiries')==='ready');
  await page.waitForFunction(()=>!document.querySelector('#todoList.dash-failed'));
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#dashHint').evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,loading:true,empty:true,errorRetry:true,shortcut:true,keyboardCards:true,clockPersistence:true,widths:[320,390,768,1024,1440],errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
