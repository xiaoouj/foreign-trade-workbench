import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

test('quotation conversion persists real orders and safely handles retries and legacy marks', {timeout:45000}, async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quote-order-')), password=crypto.randomUUID();
  const probe=http.createServer().listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  const root=path.resolve(new URL('..',import.meta.url).pathname), base=`http://127.0.0.1:${port}`;
  let child, log='';
  const stop=async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}};
  const start=async()=>{
    child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
    for(let i=0;i<250;i++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(log);
  };
  t.after(async()=>{await stop();await fs.rm(dir,{recursive:true,force:true});});await start();
  const request=(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  const admin=await(await request('/api/login','POST',{username:'admin',password})).json(),tok=admin.token;
  const call=async(p,m,b,status=200,token=tok)=>{const r=await request(p,m,b,token);assert.equal(r.status,status,await r.clone().text());return r.json();};
  const client=await call('/api/clients','POST',{company:'Conversion Test',country:'德国'},201);
  const make=(quoteNo,status='客户确认',extra={})=>call('/api/quotations','POST',{quoteNo,clientId:client.id,clientName:client.company,status,currency:'CNY',paymentTerms:'30% deposit',depositPercent:30,deliveryDays:20,items:[{name:'Machine',description:'Model A',qty:2,unitPrice:6500,unit:'SET',type:'equipment'}],...extra},201);
  const convert=(q,status=201,body={baseVersion:q.version})=>call(`/api/quotations/${q.id}/convert-to-order`,'POST',body,status);

  await t.test('copies the quote into one linked pending order without adding revision rounds',async()=>{
    const q=await make('ST02260127'), result=await convert(q);
    assert.equal(result.created,true);assert.equal(result.quotation.status,'已转订单');
    assert.equal(result.quotation.orderId,result.order.id);assert.equal(result.quotation.version,q.version);
    assert.equal(result.order.quoteId,q.id);assert.equal(result.order.orderNo,q.quoteNo);
    assert.equal(result.order.amount,13000);assert.equal(result.order.currency,'CNY');
    assert.equal(result.order.clientId,client.id);assert.equal(result.order.country,'德国');
    assert.equal(result.order.paymentTerms,q.paymentTerms);assert.equal(result.order.depositPercent,30);
    assert.equal(result.order.status,'待确认');assert.equal(result.order.inquiryId,q.inquiryId);
    assert.deepEqual(result.order.items,q.items);assert.match(result.order.deliveryDate,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await call('/api/inquiries')).find(i=>i.id===q.inquiryId).status,'谈判中');
    await stop();await start();
    const retry=await convert(q,200);assert.equal(retry.created,false);assert.equal(retry.order.id,result.order.id);
  });

  await t.test('concurrent conversion requests create exactly one order',async()=>{
    const q=await make('CONCURRENT','已发送');
    const responses=await Promise.all(Array.from({length:6},()=>request(`/api/quotations/${q.id}/convert-to-order`,'POST',{baseVersion:q.version},tok)));
    assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal(responses.filter(r=>r.status===200).length,5);
    const results=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(results.map(r=>r.order.id)).size,1);
    assert.equal((await call('/api/orders')).filter(o=>o.quoteId===q.id).length,1);
  });

  await t.test('legacy status without an order can be repaired explicitly',async()=>{
    const q=await make('LEGACY','已发送'),file=path.join(dir,'quotations.json');
    const list=JSON.parse(await fs.readFile(file));list.find(x=>x.id===q.id).status='已转订单';await fs.writeFile(file,JSON.stringify(list));
    const result=await convert(q);assert.equal(result.created,true);assert(result.quotation.orderId);
    assert.equal((await convert(q,200)).order.id,result.order.id);
  });

  await t.test('an order left by the old two-request flow is reused',async()=>{
    const q=await make('OLD-FLOW'),order=await call('/api/orders','POST',{quoteId:q.id,clientId:client.id,clientName:client.company,orderNo:q.quoteNo,amount:13000,status:'待确认'},201);
    const result=await convert(q,200);assert.equal(result.created,false);assert.equal(result.order.id,order.id);
    assert.equal(result.quotation.orderId,order.id);
  });

  await t.test('ordinary create, update and same-number import cannot mark converted',async()=>{
    const q=await make('GUARD');
    await call('/api/quotations/'+q.id,'PUT',{status:'已转订单'},409);
    await call('/api/quotations','POST',{quoteNo:'GUARD',clientId:client.id,clientName:client.company,status:'已转订单'},409);
    await call('/api/quotations','POST',{quoteNo:'FORGED',status:'已转订单'},409);
    assert.equal((await call('/api/quotations')).find(x=>x.id===q.id).status,'客户确认');
  });

  await t.test('stale content, invalid lines and duplicate numbers leave quotes and orders unchanged',async()=>{
    const q=await make('STALE');await call('/api/quotations/'+q.id,'PUT',{notes:'new content'});
    await convert(q,409);assert.equal((await call('/api/orders')).filter(o=>o.quoteId===q.id).length,0);
    const invalid=await make('INVALID','已发送',{items:[{name:'Machine',qty:0,unitPrice:20}]});await convert(invalid,400);
    const conflict=await make('NUMBER-CONFLICT');await call('/api/orders','POST',{orderNo:conflict.quoteNo,clientName:client.company},201);await convert(conflict,409);
    for(const id of [q.id,invalid.id,conflict.id])assert.notEqual((await call('/api/quotations')).find(x=>x.id===id).status,'已转订单');
  });

  await t.test('conversion preserves record visibility and requires authentication',async()=>{
    const q=await make('PRIVATE');
    assert.equal((await request(`/api/quotations/${q.id}/convert-to-order`,'POST',{})).status,401);
    await call('/api/users','POST',{username:'outsider',password,role:'sales'},201);
    const sales=await call('/api/login','POST',{username:'outsider',password});
    await call(`/api/quotations/${q.id}/convert-to-order`,'POST',{},403,sales.token);
    await call('/api/quotations/missing/convert-to-order','POST',{},404);
  });
});

test('conversion MySQL transaction rolls back if saving the quotation fails',async()=>{
  const {commitQuoteOrder}=await import('../db/dal.js');const events=[];
  const conn={beginTransaction:async()=>events.push('begin'),query:async sql=>{events.push(sql.startsWith('INSERT INTO `orders`')?'order':'quote');if(sql.startsWith('INSERT INTO `quotations`'))throw Error('storage failure');},commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')};
  await assert.rejects(commitQuoteOrder({orders:[{id:'o1'}],quotations:[{id:'q1'}],inquiries:[]},conn),/storage failure/);
  assert.deepEqual(events,['begin','order','quote','rollback','release']);
});

test('conversion JSON transaction rolls back orders as well as quote state on failure',async()=>{
  const {createCatalogStore}=await import('../catalog-store.js');let failed=false;
  const rows={'orders.json':[],'quotations.json':[{id:'q1',status:'客户确认'}],'inquiries.json':[]},journals={};
  const store=createCatalogStore({dataDir:'/test',mode:()=> 'json',dal:{},journalName:'quote-order-write-journal.json',mysqlCommit:'commitQuoteOrder',read:async f=>structuredClone(rows[path.basename(f)]||[]),write:async(f,r)=>{if(path.basename(f)==='quotations.json'&&!failed){failed=true;throw Error('storage failure');}rows[path.basename(f)]=r;},jsonRead:async f=>journals[f]||{},jsonWrite:async(f,r)=>journals[f]=r});
  await assert.rejects(store.commit({orders:[{id:'o1'}],quotations:[{id:'q1',status:'已转订单',orderId:'o1'}],inquiries:[]}),/storage failure/);
  assert.deepEqual(rows,{'orders.json':[],'quotations.json':[{id:'q1',status:'客户确认'}],'inquiries.json':[]});
  assert.equal(Object.values(journals)[0].active,false);
});
