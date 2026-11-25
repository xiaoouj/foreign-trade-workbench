const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');await fs.mkdir(out,{recursive:true});
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'ftw-redesign-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let log='',browser;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
 try{
  for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:process.env.FTW_CHROME,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  const errors=[],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/rates**',r=>r.fulfill({json:{base:'USD',rates:{USD:1,CNY:7.1,EUR:.9,GBP:.75,AED:3.67},source:'测试汇率',updated:Date.now()}}));
  await page.goto(base);await page.locator('#loginUser').fill('admin');await page.locator('#loginPwd').fill(password);await page.locator('#loginForm button[type=submit]').click();
  await page.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser);
  await page.waitForTimeout(700);if(await page.locator('#updateNotice').isVisible())await page.getByRole('button',{name:'知道了',exact:true}).click();
  const fixture=await page.evaluate(async(password)=>{
    const call=async(p,body)=>{const r=await api(p,{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
    const user=await call('/api/users',{username:'sales-test',name:'业务员甲',password,role:'sales'});
    await api('/api/sales?scope=company',{method:'PUT',body:JSON.stringify({year:2026,total:6000000})});
    const today=todayStr(),company=['Atlas Industrial','NOVA Packaging','盛泰自动化','Aurora Materials','Pacific Conveying','Northstar Engineering'];
    const ids=[];
    for(let i=0;i<6;i++){
      const client=await call('/api/clients',{company:company[i],country:['德国','美国','中国','澳大利亚','韩国','阿联酋'][i],owner:user.id,contactName:'Contact '+i});
      ids.push(client.id);
      await call('/api/inquiries',{clientId:client.id,clientName:client.company,country:client.country,owner:user.id,product:'输送线采购方案',status:['新询盘','已报价','等回复','谈判中','等回复','成交'][i],receivedAt:today,expectedAmount:8000+i*1200,currency:'USD',nextFollowAt:i<4?'2026-01-01':''});
      await call('/api/orders',{clientId:client.id,clientName:client.company,owner:user.id,orderNo:'TEST-260'+i,amount:18000+i*6500,currency:'CNY',status:'生产中',orderDate:today,paidPercent:30});
    }
    await call('/api/tasks',{title:'核对包装机技术参数',clientName:company[0],owner:user.id,dueDate:today,status:'待办'});
    await loadUsers();await loadAll();await loadRates();await refreshInquiries();await loadTasks();
    return {client:ids[0],user:user.id};
  },password);
  await page.waitForTimeout(800);assert.deepEqual(errors,[]);
  for(const view of ['dashboard','clients','quotations','orders','performance','inqstats']){
    await page.evaluate(view=>switchView(view),view);await page.waitForTimeout(500);
    await fs.writeFile(path.join(out,view+'-layout.json'),JSON.stringify(await page.locator('#view-'+view).evaluate(host=>[...host.children].map(e=>({tag:e.tagName,class:e.className,id:e.id,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height},display:getComputedStyle(e).display,opacity:getComputedStyle(e).opacity}))),null,2));
    await page.screenshot({path:path.join(out,view+'-1440.png'),fullPage:true});
  }
  await page.evaluate(()=>switchView('dashboard'));
  await page.keyboard.press('Control+k');await page.locator('.flow-search-dialog[open]').waitFor();await page.locator('#globalSearch').fill('Atlas');await page.keyboard.press('Enter');
  await page.waitForSelector('#view-client-detail.active');assert.match(await page.locator('#view-client-detail').textContent(),/Atlas/);
  await page.screenshot({path:path.join(out,'client-detail-1440.png'),fullPage:true});
  await page.evaluate(()=>switchView('dashboard'));await page.locator('#flowAIToggle').click();assert.equal(await page.locator('#flowAssistant').isVisible(),true);await page.locator('#aiChatInput').fill('待发送草稿');await page.evaluate(()=>renderDashboard());assert.equal(await page.locator('#aiChatInput').inputValue(),'待发送草稿');await page.locator('.flow-assistant-close').click();
  await page.locator('[data-todo-scope=task]').click();assert.match(await page.locator('#todoList').textContent(),/核对包装机/);
  await page.locator('[data-flow-task-done]').check();await page.waitForFunction(()=>getAllTasks().every(t=>t.status==='已完成'));
  await page.locator('[data-todo-scope=all]').click();
  await page.evaluate(()=>switchView('performance'));await page.waitForFunction(()=>perfTargetReady);assert.equal(await page.locator('#pfMonthlyChart .perf-bar-value').count(),12);
  await page.locator('[data-perf-mode=cumulative]').click();assert.equal(await page.locator('#pfCumulative').isVisible(),true);
  await page.locator('[data-perf-mode=table]').click();assert.equal(await page.locator('#pfMonthlyChart table').count(),1);
  await page.locator('[data-perf-mode=chart]').click();
  await page.evaluate(()=>switchView('inqstats'));await page.locator('#flowStageRiver [data-flow-stage="等回复"]').click();assert.equal(await page.locator('#isbStatusFilter').inputValue(),'等回复');await page.locator('#isbReset').click();
  await page.locator('#isbTrend [data-isb-month]').first().click();assert.match(await page.locator('#isbYearFilter').inputValue(),/^\d{4}$/);await page.locator('#isbReset').click();
  await page.evaluate(()=>{
    const rows=getAllInquiries(),original=rows.find(row=>row.country==='韩国');
    rows.push({...original,id:'alias-a',country:'Korea'},{...original,id:'alias-b',country:'Republic of Korea'});
    renderInqStatsBoard();
  });
  await page.locator('#isbCountryFilter').selectOption('韩国');assert.equal(await page.locator('#isbMonth').textContent(),'3');
  assert.match(await page.locator('#isbCountryChart').textContent(),/中英文写法已合并/);
  assert.equal(await page.evaluate(()=>getAllInquiries().find(row=>row.id==='alias-a').country),'Korea');
  await page.evaluate(()=>{getAllInquiries().splice(-2);});await page.locator('#isbReset').click();
  for(const width of [390,689,1100]){
    await page.setViewportSize({width,height:844});
    for(const view of ['dashboard','clients','orders','performance','inqstats']){
      await page.evaluate(view=>switchView(view),view);await page.waitForTimeout(200);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,view+' overflow '+width);
      await page.screenshot({path:path.join(out,view+'-'+width+'.png'),fullPage:true});
    }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,views:7,widths:[1440,1100,689,390],search:true,assistantDraft:true,filters:true,charts:true,errors}));
 }catch(error){if(browser){const pages=browser.contexts()[0]?.pages();if(pages?.[0]){await pages[0].screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error(await pages[0].evaluate(()=>({body:document.body.innerText.slice(-2000),theme:document.documentElement.dataset.themeStyle})));}}throw error;}
 finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
