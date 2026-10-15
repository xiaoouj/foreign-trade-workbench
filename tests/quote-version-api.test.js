import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
test('quotation imports upsert by number, preserve rounds and opportunities, and keep authorization',{timeout:45000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'order-queue-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(new URL('..',import.meta.url).pathname),env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 const request=async(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
 const admin=await(await request('/api/login','POST',{username:'admin',password})).json();const tok=admin.token;

 const call=async(p,m,b,token=tok,status=200)=>{const r=await request(p,m,b,token);assert.equal(r.status,status,await r.clone().text());return r.json();};
 const original=await call('/api/quotations','POST',{quoteNo:'QT-1',clientName:'Company',currency:'USD',items:[{name:'Machine',qty:2,unitPrice:100}]},tok,201);
 const repeated=await call('/api/quotations','POST',{quoteNo:' qt-1 ',clientName:'Company',currency:'USD',items:[{name:'Machine',qty:2,unitPrice:120}]});
 assert.equal(repeated.id,original.id);assert.equal(repeated.inquiryId,original.inquiryId);assert.equal(repeated.version,2);assert.equal(repeated.createdAt,original.createdAt);
 let qs=await call('/api/quotations','GET');assert.equal(qs.length,1);assert.equal((await call('/api/inquiries','GET')).length,1);assert.equal(qs[0].revisionHistory[0].snapshot.items[0].unitPrice,100);
 const noChange=await call('/api/quotations','POST',{quoteNo:'QT-1',clientName:'Company',currency:'USD',items:[{name:'Machine',qty:2,unitPrice:120}]});assert.equal(noChange.version,2);
 const concurrent=await Promise.all([1,2,3].map(()=>request('/api/quotations','POST',{quoteNo:'QT-2',clientName:'Company',items:[]},tok)));assert.equal(concurrent.filter(r=>r.status===201).length,1);assert.equal(concurrent.filter(r=>r.status===200).length,2);qs=await call('/api/quotations','GET');assert.equal(qs.length,2);assert.equal((await call('/api/inquiries','GET')).length,2);
 assert.equal((await request('/api/quotations','POST',{quoteNo:'QT-1',clientName:'Wrong Company'},tok)).status,409);
 const u=await call('/api/users','POST',{username:'sales',password,role:'sales'},tok,201),sales=await call('/api/login','POST',{username:'sales',password});
 const own=await call('/api/quotations','POST',{quoteNo:'QT-1',clientName:'Company'},sales.token,201);assert.notEqual(own.id,original.id);assert.equal((await call('/api/quotations','GET',null,sales.token)).length,1);
});
