import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
test('sales fields and quotation revisions persist through authenticated APIs',{timeout:45000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'order-queue-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(new URL('..',import.meta.url).pathname),env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 const request=async(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
 const admin=await(await request('/api/login','POST',{username:'admin',password})).json();const tok=admin.token;

 assert.equal((await request('/api/mail/accounts','PUT',{host:'unused'},tok)).status,410);
 assert.equal((await request('/api/mail/imap','PUT',{host:'unused'},tok)).status,410);
 const order=await(await request('/api/orders','POST',{orderNo:'SALE-1',productionProgress:70,depositPercent:30,paidPercent:12.5},tok)).json();
 assert.equal(order.paidPercent,12.5);
 assert.equal((await request('/api/orders/'+order.id,'PUT',{productionProgress:101},tok)).status,400);
 const quote=await(await request('/api/quotations','POST',{quoteNo:'Q1',items:[{name:'Machine',qty:2,unitPrice:100}],depositPercent:30,version:90,revisionHistory:[]},tok)).json();
 assert.equal(quote.version,1);assert.equal(quote.revisionHistory.length,1);
 const first=await request('/api/quotations/'+quote.id,'PUT',{notes:'调整配置',baseVersion:1},tok);assert.equal(first.status,200);assert.equal((await first.json()).version,2);
 const duplicate=await request('/api/quotations/'+quote.id,'PUT',{notes:'调整配置',baseVersion:2},tok);assert.equal((await duplicate.json()).version,2);
 const concurrent=await Promise.all(['a','b'].map(notes=>request('/api/quotations/'+quote.id,'PUT',{notes,baseVersion:2},tok)));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const quotes=await(await request('/api/quotations','GET',null,tok)).json();const saved=quotes.find(q=>q.id===quote.id);assert.equal(saved.version,3);assert.equal(saved.revisionHistory.length,3);assert.equal(saved.revisionHistory[1].snapshot.notes,'调整配置');
 const persisted=JSON.parse(await fs.readFile(path.join(dir,'quotations.json'),'utf8'));assert.equal(persisted.find(q=>q.id===quote.id).revisionHistory.length,3);
 const persistedOrders=JSON.parse(await fs.readFile(path.join(dir,'orders.json'),'utf8'));assert.equal(persistedOrders.find(o=>o.id===order.id).productionProgress,70);
 assert.equal((await request('/api/quotations','GET')).status,401);
});
