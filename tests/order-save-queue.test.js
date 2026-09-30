import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
test('order owner saves survive slow AI and aborted uploads',{timeout:45000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'order-queue-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(new URL('..',import.meta.url).pathname),env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 const request=async(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
 const admin=await(await request('/api/login','POST',{username:'admin',password})).json();const tok=admin.token;
 const user=await(await request('/api/users','POST',{username:'sales',password,name:'业务员',role:'sales'},tok)).json();
 const orders=[];for(const orderNo of ['ST06260090','ST06260082']){const r=await request('/api/orders','POST',{orderNo,owner:admin.id,amount:7900,currency:'USD',status:'已收款'},tok);assert.equal(r.status,201);orders.push(await r.json());}
 // A request still uploading must not hold the mutation lock.
 const slow=http.request(base+'/api/orders/'+orders[0].id,{method:'PUT',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json','Content-Length':'10000'}});slow.on('error',()=>{});slow.write('{"owner":');
 await new Promise(r=>setTimeout(r,100));
 const first=await request('/api/orders/'+orders[0].id,'PUT',{owner:user.id},tok);assert.equal(first.status,200);assert.equal((await first.json()).owner,user.id);slow.destroy();
 const batch=await request('/api/orders/batch','PATCH',{ids:orders.map(o=>o.id),patch:{owner:user.id}},tok);assert.equal(batch.status,200);assert.equal((await batch.json()).succeeded.length,2);
 // AI test is intentionally held open; business saves finish before it is released.
 let seen;const started=new Promise(r=>seen=r);let finish;
 const model=http.createServer((req,res)=>{seen();finish=()=>{res.setHeader('Content-Type','application/json');res.end('{"data":[]}');};});model.listen(0,'127.0.0.1');await once(model,'listening');t.after(()=>model.close());
 const ai=request('/api/ai/test','POST',{baseUrl:`http://127.0.0.1:${model.address().port}`},tok);
 await started;
 try{const r=await request('/api/orders/'+orders[1].id,'PUT',{owner:admin.id},tok);assert.equal(r.status,200);assert.equal((await r.json()).owner,admin.id);}finally{finish();await ai;}
 // Sales cannot take an administrator's order, nor assign records to other users.
 const sales=await(await request('/api/login','POST',{username:'sales',password})).json();assert.equal((await request('/api/orders/'+orders[1].id,'PUT',{owner:user.id},sales.token)).status,403);
 assert.equal((await request('/api/orders/'+orders[0].id,'PUT',{owner:admin.id},sales.token)).status,403);
 const data=await(await request('/api/orders','GET',null,tok)).json();assert.equal(data.find(o=>o.id===orders[0].id).amount,7900);assert.equal(data.find(o=>o.id===orders[1].id).owner,admin.id);
});
