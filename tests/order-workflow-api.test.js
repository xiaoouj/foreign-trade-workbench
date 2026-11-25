import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('workflow APIs preserve actual payments and cancelled history, and company totals include production', {timeout:45000}, async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'order-workflow-')),password=randomUUID();
  const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(new URL('..',import.meta.url).pathname),env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await fs.rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
  let token;
  const request=(p,method='GET',body,auth=token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  const call=async(p,method,body,status=200,auth=token)=>{const r=await request(p,method,body,auth);assert.equal(r.status,status,await r.clone().text());return r.json();};
  token=(await call('/api/login','POST',{username:'admin',password})).token;
  const order=await call('/api/orders','POST',{orderNo:'FLOW',amount:10000,currency:'CNY',orderDate:'2026-01-02',status:'待收预付款',depositPercent:30},201);
  for(const status of ['生产中','待收尾款','待发货','已发货','已完成','已取消']){
    const saved=await call('/api/orders/'+order.id,'PUT',{status});
    assert.equal(saved.status,status);assert.equal(saved.depositPercent,30);assert.equal(saved.paidPercent,undefined,'a stage change must not create a receipt');
  }
  let rows=await call('/api/orders');assert.equal(rows.length,1);assert.equal(rows[0].status,'已取消');
  assert.equal((await request('/api/orders/'+order.id,'PUT',{status:'bad'})).status,400);
  assert.equal((await request('/api/orders','POST',{status:'bad'})).status,400);
  assert.equal((await request('/api/orders/batch','PATCH',{ids:[order.id],patch:{status:'bad'}})).status,400);
  for(const status of ['待收预付款','待收尾款','待发货']){
    const result=await call('/api/orders/batch','PATCH',{ids:[order.id],patch:{status}});assert.deepEqual(result.succeeded,[order.id]);
    assert.equal((await call('/api/orders')).find(o=>o.id===order.id).status,status);
  }
  await call('/api/orders/'+order.id,'PUT',{status:'已取消',paidPercent:30});
  const records=[['待确认',1000],['待收预付款',2000],['已确认',3000],['生产中',4000],['待收尾款',5000],['待发货',6000],['已发货',7000],['已完成',8000],['已收款',9000],['已取消',10000]];
  for(const [status,amount] of records)await call('/api/orders','POST',{orderNo:status,clientName:'PRIVATE',status,amount,currency:'CNY',orderDate:'2026-01-02'},201);
  const sales=await call('/api/users','POST',{username:'workflow-sales',name:'Sales',password,role:'sales'},201);
  const salesToken=(await call('/api/login','POST',{username:'workflow-sales',password})).token;
  const summary=await call('/api/sales?scope=company','GET',undefined,200,salesToken);
  assert.equal(summary.actual.monthly['2026-01'].amounts.CNY,39000);
  assert.equal(summary.actual.monthly['2026-01'].count,6);
  assert(!JSON.stringify(summary).includes('PRIVATE'));
  assert.equal((await request('/api/orders/'+order.id,'PUT',{status:'生产中'},salesToken)).status,403);
  const batch=await call('/api/orders/batch','PATCH',{ids:[order.id],patch:{status:'生产中'}},200,salesToken);
  assert.deepEqual(batch.succeeded,[]);assert.equal(batch.failed.length,1);
  assert.equal((await request('/api/orders','GET',undefined,null)).status,401);
  rows=JSON.parse(await fs.readFile(path.join(dir,'orders.json'),'utf8'));
  const cancelled=rows.find(o=>o.id===order.id);assert.equal(cancelled.status,'已取消');assert.equal(cancelled.paidPercent,30);assert.equal(cancelled.depositPercent,30);
  assert(sales.id);
});
