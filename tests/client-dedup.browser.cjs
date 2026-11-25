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

let empty=false, fail='', held=false, release;
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

  await page.goto('http://crm.test/#/clients');await page.waitForFunction(()=>dashSources.get('core')==='ready');
  const setRows=async records=>page.evaluate(records=>{clients=records.map(record=>({...record,owner:'u1',createdAt:Date.now()}));renderClients();},records);
  await setRows([{id:'a',company:'SOYUZPISHCHEPROM ASSOCIATION LLC'},{id:'b',company:'Soyuzpishcheprom Association LLC'},{id:'other',company:'Different Customer'}]);
  await page.locator('.cl-more summary').click();await page.locator('#clientDedup').click();
  assert.equal(await page.locator('[data-dedup-remove]').count(),2);assert.match(await page.locator('#modalForm').innerText(),/忽略大小写/);
  assert.equal(await page.locator('[data-dedup-remove]:checked').count(),0);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-dedup-merge]').click();assert.equal(await page.locator('[data-dedup-remove]').count(),2);
  assert.equal(await page.evaluate(()=>clients.length),3);await page.evaluate(()=>closeModal());await page.locator('#modal').waitFor({state:'hidden'});
  await setRows([{id:'a',company:'SOYUZPICHSHEPROM ASSOCIATION LLC',country:'俄罗斯',contactName:'Mikhail Eremenko'},{id:'b',company:'Soyuzpishcheprom Association LLC',country:'俄罗斯',contactName:'MIKHAIL EREMENKO'}]);
  await page.evaluate(()=>openClientDedup());await page.locator('#modal.open').waitFor();assert.equal(await page.locator('[data-dedup-remove]').count(),2);
  assert.match(await page.locator('#modalForm').innerText(),/名称相近/);assert.match(await page.locator('#modalForm').innerText(),/88%/);assert.match(await page.locator('#modalForm').innerText(),/国家一致/);assert.equal(await page.locator('[data-dedup-remove]:checked').count(),0);
  await page.screenshot({path:'/tmp/ftw-dedup-desktop.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'/tmp/ftw-dedup-mobile.png',animations:'disabled'});
  let payload;await page.route('**/api/clients/merge',async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{ok:true}});});
  await page.locator('[data-dedup-keep]').selectOption('b');page.once('dialog',dialog=>dialog.accept());await page.locator('[data-dedup-merge]').click();await page.locator('#modal.open').waitFor({state:'hidden'});assert.deepEqual(payload,{keepId:'b',removeIds:['a']});
  await setRows([{id:'a',company:'Alpha Association LLC'},{id:'b',company:'Omega Association LLC'}]);await page.evaluate(()=>openClientDedup());assert.equal(await page.locator('[data-dedup-remove]').count(),0);await page.evaluate(()=>closeModal());await page.locator('#modal').waitFor({state:'hidden'});
  await setRows([{id:'a',company:'SOYUZPISHCHEPROM ASSOCIATION LLC'},{id:'b',company:'Soyuzpishcheprom Association LLC'}]);await page.evaluate(()=>{currentUser.role='sales';openClientDedup();});assert.equal(await page.locator('[data-dedup-merge]').count(),0);assert.equal(await page.locator('[data-dedup-remove]').count(),2);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,caseInsensitive:true,similarSpelling:true,reasonsVisible:true,noAutomaticWrites:true,mergeConfirmation:true,selectedKeepRecord:true,roleBoundary:true,mobile:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
