import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
test('company and personal targets enforce roles, yearly cap and concurrent writes',{timeout:45000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'order-queue-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(new URL('..',import.meta.url).pathname),env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 const request=async(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
 const admin=await(await request('/api/login','POST',{username:'admin',password})).json();const tok=admin.token;
 const make=async(username,role='sales')=>{await request('/api/users','POST',{username,password,role},tok);return (await request('/api/login','POST',{username,password})).json();};
 const a=await make('a'),b=await make('b'),manager=await make('manager','manager');
 const put=(token,body,path='/api/sales')=>request(path,'PUT',body,token);
 const get=(token,path='/api/sales')=>request(path,'GET',null,token).then(r=>r.json());
 assert.equal((await put(a.token,{yearMonthly:{'2026-01':1}})).status,409);
 assert.equal((await put(tok,{year:2026,total:100},'/api/sales?scope=company')).status,200);
 assert.equal((await put(a.token,{year:2026,total:200},'/api/sales?scope=company')).status,403);
 assert.equal((await put(tok,{yearMonthly:{'2026-01':1}},'/api/sales?userId='+a.id)).status,403);
 assert.equal((await put(manager.token,{yearMonthly:{'2026-01':1}},'/api/sales?userId='+a.id)).status,403);
 assert.equal((await request('/api/sales?userId='+b.id,'GET',null,a.token)).status,403);
 assert.equal((await request('/api/sales?userId='+admin.id,'GET',null,tok)).status,400);
 const concurrent=await Promise.all([put(a.token,{yearMonthly:{'2026-01':60}}),put(b.token,{yearMonthly:{'2026-02':60}})]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const company=await get(a.token,'/api/sales?scope=company');assert.equal(company.scope,'company');assert.equal(company.budget['2026'].allocated,60);assert.equal(company.canEdit,false);assert.equal(Object.values(company.yearMonthly).reduce((n,v)=>n+Math.round(v*100),0),10000);
 assert.equal((await put(tok,{year:2026,total:59},'/api/sales?scope=company')).status,409);
 const winner=concurrent[0].status===200?a:b;
 assert.equal((await put(winner.token,{yearMonthly:{'2026-03':-1}})).status,400);
 assert.equal((await put(winner.token,{yearMonthly:{'2026-13':1}})).status,400);
 const person=await get(tok,'/api/sales?userId='+winner.id);assert.equal(person.canEdit,false);assert.equal(person.scope,'personal');
 // Company actual includes other owners, but only aggregates leave the endpoint.
 await request('/api/orders','POST',{clientName:'PRIVATE-A',owner:a.id,orderDate:'2026-01-01',amount:20,currency:'CNY',status:'已完成'},tok);
 await request('/api/orders','POST',{clientName:'PRIVATE-B',owner:b.id,orderDate:'2026-01-02',amount:30,currency:'CNY',status:'已完成'},tok);
 const summary=await get(a.token,'/api/sales?scope=company');assert.equal(summary.actual.monthly['2026-01'].amounts.CNY,50);assert.equal(summary.actual.monthly['2026-01'].count,2);assert(!JSON.stringify(summary).includes('PRIVATE'));
 const personal=await get(winner.token);assert.equal(personal.canEdit,true);assert.equal(personal.scope,'personal');

});
