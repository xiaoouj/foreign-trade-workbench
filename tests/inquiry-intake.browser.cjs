const {chromium}=require(process.env.FTW_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');await fs.mkdir(out,{recursive:true});
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'ftw-intake-ui-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_STORAGE:'json',FTW_DATA_DIR:data,FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='',browser;
 server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk);
 try{
  for(let i=0;i<200;i++){if(server.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({headless:true,executablePath:process.env.FTW_CHROME});const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();if(url.pathname==='/api/rates')return route.fulfill({json:{base:'USD',rates:{USD:1,CNY:7},updated:Date.now()}});return route.continue();});
  await page.goto(base+'/#/enquiry');await page.locator('#loginUser').fill('admin');await page.locator('#loginPwd').fill(password);await page.locator('#loginForm button[type=submit]').click();await page.locator('#view-enquiry.active').waitFor();
  if(await page.locator('#updateNotice').isVisible())await page.getByRole('button',{name:'知道了',exact:true}).click();
  await page.locator('#inqMcpSetup').click();await page.locator('#imcpCreate').click();await page.locator('#imcpConfig').waitFor();
  const config=JSON.parse(await page.locator('#imcpConfig').inputValue()),credential=config.mcpServers['ftw-inquiry-drafts'].env.FTW_CRM_TOKEN;assert.equal(config.mcpServers['ftw-inquiry-drafts'].env.FTW_CRM_URL,base);assert.equal(config.mcpServers['ftw-inquiry-drafts'].args[0],'C:\\FTW-MCP\\ftw-crm-mcp.cjs');assert(/^ftw_mcp_/.test(credential));
  await page.screenshot({path:path.join(out,'mcp-setup.png'),fullPage:true,mask:[page.locator('#imcpConfig')],animations:'disabled'});await page.evaluate(()=>closeModal());
  const create=async payload=>{const response=await fetch(base+'/api/inquiry-mcp/drafts',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(payload)});assert(response.ok,await response.clone().text());return (await response.json()).draft;};
  const original='[isolated UI fixture]\n需要两台皮带输送机，长6m、宽800mm，预算未知。';
  const trial=await create({source:'manual-test',accountId:'test',sourceRecordId:'browser-test',rawText:original,sourceSentAt:'2026-10-13',fields:{clientName:'MCP测试客户',product:'皮带输送机'}});
  await page.locator('[data-subtab=draft]').click();await page.locator(`[data-draft-id="${trial.id}"]`).click();assert(await page.locator('#idraftConfirm').isDisabled());assert.match(await page.locator('#modalForm').innerText(),/测试草稿/);assert.match(await page.locator('#modalForm').innerText(),/预算未知/);
  await page.locator('[data-draft-field=model]').fill('长度6m，宽度800mm');await page.locator('#idraftSave').click();await page.locator('#modal.open').waitFor({state:'hidden'});
  await page.locator(`[data-draft-id="${trial.id}"]`).click();assert.equal(await page.locator('[data-draft-field=model]').inputValue(),'长度6m，宽度800mm');
  await page.getByText('标记为非询盘',{exact:true}).click();await page.locator('#idraftReason').fill('测试完成');await page.locator('#idraftDismiss').click();await page.locator('#modal.open').waitFor({state:'hidden'});
  const real=await create({source:'alibaba-mc',accountId:'isolated-ui',sourceRecordId:'real-fixture',rawText:original,sourceSentAt:'2026-10-13',fields:{clientName:'示例公司',product:'皮带输送机',model:'长6m，宽800mm',expectedAmount:null,currency:''}});
  await page.goto(base+'/?inquiryDraft='+real.id+'#/enquiry');await page.locator('#idraftConfirm').waitFor();assert(await page.locator('#sub-draft').evaluate(node=>node.classList.contains('active')));
  assert.equal(await page.locator('#idraftReceivedAt').inputValue(),'2026-10-13');assert.equal(await page.locator('[data-draft-field=expectedAmount]').inputValue(),'');
  await page.screenshot({path:path.join(out,'draft-review-desktop.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'review modal overflows mobile viewport');await page.screenshot({path:path.join(out,'draft-review-mobile.png'),fullPage:true,animations:'disabled'});
  await page.locator('#idraftConfirm').click();await page.locator('#modal.open').waitFor({state:'hidden'});
  const formal=await page.evaluate(async()=>{const response=await api('/api/inquiries');return response.json();});assert.equal(formal.filter(item=>item.clientName==='示例公司').length,1);assert(!formal.some(item=>item.clientName==='MCP测试客户'));
  await page.setViewportSize({width:1280,height:860});await page.locator('#inqDraftStatus').selectOption('all');await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'draft-list-desktop.png'),fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,testDraftBlocked:true,formalInquiryCount:1,errors}));
 }finally{await browser?.close();server.kill('SIGTERM');if(server.exitCode===null)await once(server,'exit');await fs.rm(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
