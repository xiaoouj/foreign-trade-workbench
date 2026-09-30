import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
test('client merge preserves data and moves associations',{timeout:45000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'order-queue-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(new URL('..',import.meta.url).pathname),env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 const request=async(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
 const admin=await(await request('/api/login','POST',{username:'admin',password})).json();const tok=admin.token;
 const make=async(username,role='sales')=>{await request('/api/users','POST',{username,password,role},tok);return (await request('/api/login','POST',{username,password})).json();};

 const a=await make('sales');
 const create=async(type,body)=>{const r=await request('/api/'+type,'POST',body,tok);assert.equal(r.status,201);return r.json();};
 const keep=await create('clients',{company:'Keep',contactEmail:'keep@example.com'}),old=await create('clients',{company:'Old',contactPhone:'123',contactEmail:'old@example.com',notes:'Original notes'});
 await create('orders',{clientId:old.id,clientName:'Old',amount:100,currency:'CNY'});
 await create('inquiries',{clientId:old.id,clientName:'Old'});
 await create('quotations',{clientId:old.id,clientName:'Old'});
 await create('tasks',{title:'follow',relatedKind:'client',relatedId:old.id,relatedName:'Old'});
 await create('comms',{clientName:'Old',content:'History'});
 const body={keepId:keep.id,removeIds:[old.id]};
 assert.equal((await request('/api/clients/merge','POST',body,a.token)).status,403);
 const r=await request('/api/clients/merge','POST',body,tok);assert.equal(r.status,200,await r.clone().text());
 const get=async(type)=>(await request('/api/'+type,'GET',null,tok)).json();
 const clients=await get('clients');assert.equal(clients.length,1);assert.equal(clients[0].contactPhone,'123');assert.equal(clients[0].contactEmail,'keep@example.com');assert.match(clients[0].notes,/old@example.com/);assert.match(clients[0].notes,/Original notes/);
 for(const type of ['orders','inquiries','quotations','comms']){const rows=await get(type);assert.equal(rows[0].clientName,'Keep');assert.equal(rows[0].clientId,keep.id);}
 const tasks=await get('tasks');assert.equal(tasks[0].relatedId,keep.id);assert.equal(tasks[0].relatedName,'Keep');
 assert.equal((await request('/api/clients/merge','POST',body,tok)).status,409);
});
