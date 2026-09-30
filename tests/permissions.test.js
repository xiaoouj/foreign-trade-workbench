import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('business permissions: roles, modules, aggregation, attachments and direct requests', {timeout:90000}, async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'ftw-rbac-')), password=crypto.randomUUID();
 const probe=net.createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_STORAGE:'json',PORT:String(port),FTW_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 t.after(async()=>{if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await fs.rm(data,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;
 for(let n=0;n<200;n++){if(server.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const req=(method,p,user,body)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(method,p,user,body,status=200)=>{const r=await req(method,p,user,body);const out=await r.json();assert.equal(r.status,status,`${method} ${p}: ${JSON.stringify(out)}`);return out;};
 const admin=await json('POST','/api/login',null,{username:'admin',password});
 const createUser=async(username,role,managerId)=>{await json('POST','/api/users',admin,{username,name:username,password,role,managerId},201);return json('POST','/api/login',null,{username,password});};
 const manager=await createUser('manager','manager'), otherManager=await createUser('otherManager','manager');
 const sales=await createUser('sales','sales',manager.id), outsider=await createUser('outsider','sales',otherManager.id);
 const own={},other={};
 const modules=['clients','orders','inquiries','quotations','shipments','emails','comms','exceptions','finance','tasks','contacts','chats','knowledge'];
 await t.test('all 13 owned modules: manager all, sales self, unowned hidden',async()=>{
  for(const mod of modules){
   own[mod]=await json('POST','/api/'+mod,sales,{company:'same-company',name:'same',title:'Own',content:'Own',status:'草稿'},201);
   other[mod]=await json('POST','/api/'+mod,outsider,{company:'same-company',name:'same',title:'Private',content:'Private',status:'草稿'},201);
   const filename=path.join(data,mod+'.json');const rows=JSON.parse(await fs.readFile(filename,'utf8'));rows.push({id:'legacy-'+mod,title:'Unassigned'});await fs.writeFile(filename,JSON.stringify(rows));
   assert.deepEqual((await json('GET','/api/'+mod,sales)).map(x=>x.id),[own[mod].id],mod);
   assert.equal((await json('GET','/api/'+mod,manager)).length,3,mod);
   await json('PUT','/api/'+mod+'/'+other[mod].id,sales,{title:'attack'},403);
   await json('DELETE','/api/'+mod+'/'+other[mod].id,sales,undefined,403);
   await json('PUT','/api/'+mod+'/legacy-'+mod,sales,{owner:sales.id},403);
   await json('PUT','/api/'+mod+'/'+other[mod].id,manager,{title:'Manager edited'});
   await json('PUT','/api/'+mod+'/'+own[mod].id,sales,{owner:outsider.id},403);
   await json('POST','/api/'+mod,sales,{owner:outsider.id},403);
   await json('PUT','/api/'+mod+'/'+own[mod].id,sales,{title:'Self edited'});
   await json('DELETE','/api/'+mod+'/legacy-'+mod,manager);
  }
 });
 await t.test('batch, imports, linked records and canonical owner names',async()=>{
  await json('PATCH','/api/orders/batch',sales,{ids:[own.orders.id],patch:{owner:outsider.id}},403);
  const batch=await json('PATCH','/api/orders/batch',sales,{ids:[own.orders.id,other.orders.id],patch:{status:'已确认'}});assert.equal(batch.succeeded.length,1);assert.equal(batch.failed.length,1);
  await json('POST','/api/clients/import',sales,{records:[{company:'spoof',owner:outsider.id}]},403);
  await json('POST','/api/comms/import',sales,{records:[{content:'spoof',clientId:other.clients.id}]},403);
  await json('POST','/api/contacts',sales,{name:'Attack',clientId:other.clients.id,isPrimary:true},403);
  await json('PUT','/api/contacts/'+own.contacts.id,sales,{name:'Fixed contact update',isPrimary:true});
  const transfer=await json('PUT','/api/clients/'+other.clients.id,manager,{owner:sales.id,ownerName:'fake'});assert.equal(transfer.ownerName,'sales');
  await json('PUT','/api/clients/'+other.clients.id,manager,{owner:outsider.id});
 });
 await t.test('dashboard isolation and removed dedup endpoint',async()=>{
  await json('PUT','/api/inquiries/'+own.inquiries.id,sales,{status:'已报价',expectedAmount:10});
  await json('PUT','/api/inquiries/'+other.inquiries.id,manager,{status:'已报价',expectedAmount:900});
  assert.equal((await json('GET','/api/dashboard/summary',sales)).cards.canQuote.amount,10);
  assert.equal((await json('GET','/api/dashboard/summary',manager)).cards.canQuote.amount,910);
  assert.equal((await req('GET','/api/dedup/preview',sales)).status,404);
  assert.equal((await req('GET','/api/dedup/preview',manager)).status,404);
 });
 await t.test('company reference data remains shared',async()=>{
  for(const mod of ['products','suppliers','comm-templates']){const item=await json('POST','/api/'+mod,outsider,{name:'Shared',content:'Shared'},201);assert((await json('GET','/api/'+mod,sales)).some(x=>x.id===item.id));await json('PUT','/api/'+mod+'/'+item.id,manager,{name:'Updated'});}
 });
 await t.test('attachments: anonymous/foreign denied, reference laundering denied, ownership transfer',async()=>{
  await json('POST','/api/upload',null,{filename:'test.txt',data:'dGVzdA=='},401);
  await json('POST','/api/parse-doc',null,{filename:'test.txt',data:'dGVzdA=='},401);
  const upload=await json('POST','/api/upload',sales,{filename:'test.txt',data:'dGVzdA=='},201);
  assert.equal((await req('GET',upload.url,sales)).status,200);assert.equal((await req('GET',upload.url,outsider)).status,403);assert.equal((await req('GET',upload.url,null)).status,401);
  await json('POST','/api/clients',outsider,{company:'steal',attachmentUrl:upload.url},403);
  await json('POST','/api/products',outsider,{name:'launder',attachmentUrl:upload.url},403);
  await json('PUT','/api/clients/'+own.clients.id,sales,{attachmentUrl:upload.url});
  await json('PUT','/api/clients/'+own.clients.id,manager,{owner:outsider.id});
  assert.equal((await req('GET',upload.url,sales)).status,403);assert.equal((await req('GET',upload.url,outsider)).status,200);assert.equal((await req('GET',upload.url,manager)).status,200);
 });
 await t.test('personal preferences and business targets remain accessible within their scope',async()=>{
  await json('PUT','/api/settings',sales,{uiPrefs:{[sales.id]:{clientColOrder:['name','owner']}}});
  await json('PUT','/api/settings',outsider,{uiPrefs:{[outsider.id]:{clientColOrder:['name']}}});
  assert.deepEqual(Object.keys((await json('GET','/api/settings',sales)).uiPrefs),[sales.id]);
  await json('PUT','/api/settings',sales,{uiPrefs:{[outsider.id]:{}}},403);
  await json('PUT','/api/orders/'+own.orders.id,sales,{records:[],owner:outsider.id},403);
  await json('PUT','/api/sales?userId='+outsider.id,sales,{yearMonthly:{}},403);
  await json('PUT','/api/sales?userId='+outsider.id,manager,{yearMonthly:{'2026-09':100}},403);
  await json('PUT','/api/sales?scope=company',admin,{year:2026,total:1000});
  await json('PUT','/api/sales',outsider,{yearMonthly:{'2026-09':100}});
  assert.equal((await json('GET','/api/sales',outsider)).yearMonthly['2026-09'],100);
 });
 await t.test('admin boundary, cyclic hierarchy and live role changes',async()=>{
  await json('POST','/api/users',manager,{username:'unauthorized',password},403);
  await json('PUT','/api/users/'+outsider.id,manager,{role:'admin'},403);
  await json('GET','/api/audit',manager,undefined,403);
  await json('PUT','/api/ai/config',sales,{baseUrl:'http://untrusted'},403);
  await json('GET','/api/mail/imap',sales,undefined,403);
  await json('PUT','/api/users/'+sales.id,sales,{role:'admin'});
  assert.equal((await json('GET','/api/me',sales)).role,'sales');
  const third=await createUser('thirdManager','manager',otherManager.id);
  await json('PUT','/api/users/'+manager.id,admin,{managerId:third.id});
  await json('PUT','/api/users/'+otherManager.id,admin,{managerId:manager.id},400);
  await json('PUT','/api/users/'+manager.id,admin,{role:'sales'});
  assert.equal((await json('GET','/api/orders',manager)).length,0);
 });
});
