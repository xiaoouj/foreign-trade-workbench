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
  const fixture=await page.evaluate(async(password)=>{
    let r=await api('/api/users',{method:'POST',body:JSON.stringify({username:'target-sales',name:'业务员甲',password,role:'sales'})});const u=await r.json();
    await api('/api/orders',{method:'POST',body:JSON.stringify({orderNo:'TEST',clientName:'Company order',owner:u.id,amount:120000,currency:'CNY',orderDate:'2026-01-10',status:'已完成'})});
    await loadUsers();await loadAll();return u;
  },password);
  await page.evaluate(()=>(orders[0].items=[{name:'Machine',qty:3,unit:'SET',unitPrice:10}],openOrderModal(orders[0].id)));
  await page.locator('[data-oi=lineAmount]').fill('29.95');
  await page.locator('#oiUseTotal').click();assert.equal(await page.locator('#modalForm [name=amount]').inputValue(),'29.95');
  await page.locator('[data-oi=qty]').fill('4');assert.match(await page.locator('#oiTotal').textContent(),/29.95/);
  await page.locator('#modalFoot button[type=submit]').click();await page.waitForFunction(()=>orders[0].items?.[0]?.lineAmount===29.95);
  await page.evaluate(()=>openOrderModal(orders[0].id));assert.equal(await page.locator('[data-oi=lineAmount]').inputValue(),'29.95');
  await page.locator('[data-oi=lineAmount]').fill('');assert.match(await page.locator('#oiTotal').textContent(),/40.00/);
  await page.evaluate(()=>closeModal());
  await page.evaluate(async()=>{await api('/api/orders/'+orders[0].id,{method:'PUT',body:JSON.stringify({amount:120000})});await loadAll();});
  await page.evaluate(()=>switchView('performance'));await page.waitForFunction(()=>perfTargetReady&&salesConfig.scope==='company');
  assert.deepEqual(await page.locator('#perfOwner option').evaluateAll(xs=>xs.map(x=>x.value)),['company',fixture.id]);
  await page.locator('#perfDate').fill('2026-01');await page.locator('#perfDate').dispatchEvent('change');await page.locator('[data-period=year]').click();
  await page.locator('#perfEditTarget').click();await page.locator('#modalForm input[name=total]').fill('8000000');await page.locator('#modalFoot button[type=submit]').click();await page.waitForFunction(()=>salesConfig.yearMonthly['2026-01']>0);
  assert.equal(await page.evaluate(()=>Object.values(salesConfig.yearMonthly).reduce((n,v)=>n+Math.round(v*100),0)),800000000);
  assert.equal((await page.locator('#pfActual').textContent()).replace(/[^0-9]/g,''),'120000');
  assert.match(await page.locator('#pfDeals').textContent(),/Company order/);assert.match(await page.locator('#pfDeals').textContent(),/业务员甲/);assert.match(await page.locator('#pfAlertSummary').textContent(),/大单 1/);assert.match(await page.locator('#pfClientChart').textContent(),/Company order/);
  await page.locator('#perfOwner').selectOption(fixture.id);await page.waitForFunction(()=>perfTargetReady&&salesConfig.scope==='personal');assert.equal(await page.locator('#perfEditTarget').isVisible(),false);
  const ctx=await browser.newContext({viewport:{width:715,height:769}}),sales=await ctx.newPage();sales.on('pageerror',e=>errors.push(e.message));
  await sales.goto('http://127.0.0.1:4193/#/performance');await sales.locator('#loginUser').fill('target-sales');await sales.locator('#loginPwd').fill(password);await sales.locator('#loginForm button[type=submit]').click();await sales.waitForFunction(()=>typeof perfTargetReady!=='undefined'&&perfTargetReady);
  if(await sales.locator('#updateNotice').isVisible())await sales.getByRole('button',{name:'知道了',exact:true}).click();
  assert.equal(await sales.locator('#perfOwner').inputValue(),fixture.id);assert.equal(await sales.locator('#perfEditTarget').isVisible(),true);
  await sales.locator('#perfDate').fill('2026-01');await sales.locator('#perfDate').dispatchEvent('change');await sales.locator('[data-period=year]').click();
  await sales.locator('#perfEditTarget').click();await sales.locator('#modalForm input[name=total]').fill('1000000');await sales.locator('#modalFoot button[type=submit]').click();await sales.waitForFunction(()=>salesConfig.yearMonthly['2026-01']>0);
  assert.equal(await sales.evaluate(()=>Object.values(salesConfig.yearMonthly).reduce((n,v)=>n+Math.round(v*100),0)),100000000);
  await sales.waitForTimeout(350);await sales.locator('#perfOwner').selectOption('company');await sales.waitForFunction(()=>perfTargetReady&&salesConfig.scope==='company');assert.equal(await sales.locator('#perfEditTarget').isVisible(),false);assert.equal((await sales.locator('#pfTarget').textContent()).replace(/[^0-9]/g,''),'800000000');assert.equal((await sales.locator('#pfActual').textContent()).replace(/[^0-9]/g,''),'120000');
  await sales.screenshot({path:'/tmp/targets-company-mobile.png'});assert.equal(await sales.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await sales.locator('#perfOwner').selectOption(fixture.id);await sales.waitForFunction(()=>perfTargetReady&&salesConfig.scope==='personal');await sales.locator('#perfEditTarget').click();await sales.locator('#modalForm input[name=total]').fill('9000000');await sales.locator('#modalFoot button[type=submit]').click();await sales.waitForTimeout(300);assert.equal(await sales.locator('#modalForm input[name=total]').inputValue(),'9000000');assert.equal(await sales.evaluate(()=>Object.values(salesConfig.yearMonthly).reduce((n,v)=>n+Math.round(v*100),0)),100000000);
  await ctx.close();
  assert.deepEqual(errors,[]);console.log('PASS company vs self scopes, admin read-only members, annual split, company actual, cap rejection, mobile');
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
