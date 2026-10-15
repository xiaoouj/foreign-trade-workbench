import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
test('direct quotations provision opportunities, reuse them, and survive restart',{timeout:45000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quote-opportunity-')),password=crypto.randomUUID();
 const probe=http.createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const root=path.resolve(new URL('..',import.meta.url).pathname);let child,log='';
 const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);for(let i=0;i<250;i++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(log);};
 const base=`http://127.0.0.1:${port}`;t.after(async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await fs.rm(dir,{recursive:true,force:true});});await start();
 const request=async(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const admin=await(await request('/api/login','POST',{username:'admin',password})).json(),tok=admin.token;
 const call=async(p,m,b,token=tok)=>{const r=await request(p,m,b,token);assert(r.ok,await r.clone().text());return r.json();};
 const u=await call('/api/users','POST',{username:'sales',password,name:'业务员',role:'sales'}),client=await call('/api/clients','POST',{company:'Direct Company',owner:u.id,country:'德国',contactEmail:'test@example.com'});
 const user=await call('/api/login','POST',{username:'sales',password});
 const make=async status=>call('/api/quotations','POST',{clientName:client.company,clientId:client.id,quoteNo:'D-'+status,projectName:'项目 '+status,status,currency:'USD',items:[{name:'Machine',qty:3,unitPrice:100}]},user.token);
 const q=await make('草稿');assert(q.inquiryId);
 let inquiries=await call('/api/inquiries','GET',null,user.token);assert.equal(inquiries.length,1);const i=inquiries[0];assert.equal(i.status,'已报价');assert.equal(i.owner,u.id);assert.equal(i.expectedAmount,300);assert.equal(i.originQuoteId,q.id);assert.equal(i.contactEmail,'test@example.com');
 await call('/api/quotations/'+q.id,'PUT',{notes:'变更',items:[{name:'Machine',qty:4,unitPrice:100}]},user.token);assert.equal((await call('/api/inquiries','GET',null,user.token))[0].expectedAmount,400);await call('/api/quotations/'+q.id,'PUT',{inquiryId:''},user.token);inquiries=await call('/api/inquiries','GET',null,user.token);assert.equal(inquiries.length,1);
 await call('/api/quotations/'+q.id,'PUT',{status:'已发送'},user.token);assert.equal((await call('/api/inquiries','GET',null,user.token))[0].status,'等回复');
 const second=await make('客户确认');assert.notEqual(second.inquiryId,q.inquiryId);assert.equal((await call('/api/inquiries','GET',null,user.token)).find(i=>i.id===second.inquiryId).status,'谈判中');
 const explicit=await call('/api/quotations','POST',{clientName:client.company,clientId:client.id,inquiryId:q.inquiryId,status:'草稿'},user.token);assert.equal(explicit.inquiryId,q.inquiryId);assert.equal((await call('/api/inquiries','GET',null,user.token)).length,2);
 const order=await call('/api/orders','POST',{clientName:client.company,clientId:client.id,quoteId:second.id,status:'待确认'},user.token);assert.equal((await call('/api/inquiries','GET',null,user.token)).find(i=>i.id===second.inquiryId).status,'谈判中');await call('/api/orders/'+order.id,'PUT',{status:'已确认'},user.token);assert.equal((await call('/api/inquiries','GET',null,user.token)).find(i=>i.id===second.inquiryId).status,'成交');
 // A legacy quote with no link is upgraded when saved, rather than mass-created at startup.
 const file=path.join(dir,'quotations.json'),legacy={id:'legacy',clientName:client.company,owner:u.id,createdAt:Date.now(),status:'已发送',items:[]};const qs=JSON.parse(await fs.readFile(file,'utf8'));qs.push(legacy);await fs.writeFile(file,JSON.stringify(qs));const upgraded=await call('/api/quotations/legacy','PUT',{notes:'旧报价保存'},user.token);assert(upgraded.inquiryId);
 child.kill('SIGTERM');await once(child,'exit');await start();inquiries=await call('/api/inquiries','GET',null,user.token);assert.equal(inquiries.length,3);assert.equal(inquiries.find(i=>i.id===q.inquiryId).originQuoteId,q.id);
});

test('quote/opportunity MySQL commit rolls back if the second record fails',async()=>{
 const {commitQuoteInquiry}=await import('../db/dal.js');const events=[];
 const conn={beginTransaction:async()=>events.push('begin'),query:async(sql)=>{events.push(sql.startsWith('INSERT INTO `quotations`')?'quote':'inquiry');if(sql.startsWith('INSERT INTO `inquiries`'))throw Error('storage failure');},commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')};
 await assert.rejects(commitQuoteInquiry({quotations:[{id:'q1'}],inquiries:[{id:'i1'}]},conn),/storage failure/);assert.deepEqual(events,['begin','quote','inquiry','rollback','release']);
});

test('quote/opportunity JSON commit restores both collections after a partial failure',async()=>{
 const {createCatalogStore}=await import('../catalog-store.js');let failed=false;const rows={'quotations.json':[{id:'old'}],'inquiries.json':[]},journals={};
 const fileKey=s=>path.basename(s);const store=createCatalogStore({dataDir:'/test',mode:()=> 'json',dal:{},journalName:'quote-inquiry-write-journal.json',read:async f=>rows[fileKey(f)]||[],write:async(f,r)=>{if(fileKey(f)==='inquiries.json'&&!failed){failed=true;throw Error('storage failure');}rows[fileKey(f)]=r;},jsonRead:async f=>journals[f]||{},jsonWrite:async(f,r)=>journals[f]=r});
 await assert.rejects(store.commit({quotations:[{id:'new',inquiryId:'i1'}],inquiries:[{id:'i1'}]}),/storage failure/);assert.deepEqual(rows,{'quotations.json':[{id:'old'}],'inquiries.json':[]});assert.equal(Object.values(journals)[0].active,false);
});
