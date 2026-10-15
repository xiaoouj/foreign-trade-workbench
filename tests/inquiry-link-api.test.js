import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
test('inquiry linkage respects projects, confirmed orders, stage history and access',{timeout:45000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'order-queue-')),password=crypto.randomUUID();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(new URL('..',import.meta.url).pathname),env:{...process.env,FTW_DATA_DIR:dir,FTW_STORAGE:'json',FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<250;i++){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 const request=async(p,method='GET',body,token)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
 const admin=await(await request('/api/login','POST',{username:'admin',password})).json();const tok=admin.token;


 const call=async(p,method,body,token=tok)=>{const r=await request(p,method,body,token);assert(r.ok,JSON.stringify(await r.clone().json()));return r.json();};
 const inq=await call('/api/inquiries','POST',{clientName:'ACME',product:'A',status:'新询盘',source:'阿里巴巴',receivedAt:'2026-10-01',notes:'原始需求备注',chatLog:'客户原始沟通',model:'原始型号',expectedAmount:50,currency:'EUR',attachments:[{name:'原始附件',url:'/uploads/original.pdf'}]}),other=await call('/api/inquiries','POST',{clientName:'ACME',product:'B',status:'新询盘'});
 const get=async id=>(await call('/api/inquiries','GET')).find(q=>q.id===id);
 const quote=await call('/api/quotations','POST',{quoteNo:'LINK-Q',clientName:'ACME',inquiryId:inq.id,status:'草稿'});
 assert.equal((await get(inq.id)).status,'已报价');assert.equal((await get(other.id)).status,'新询盘');
 const linked=await get(inq.id);for(const key of ['product','source','receivedAt','notes','chatLog','model','expectedAmount','currency','attachments'])assert.deepEqual(linked[key],inq[key]);assert.equal(linked.id,inq.id);
 await call('/api/quotations/'+quote.id,'PUT',{status:'已发送'});assert.equal((await get(inq.id)).status,'等回复');
 await call('/api/quotations/'+quote.id,'PUT',{status:'客户确认'});assert.equal((await get(inq.id)).status,'谈判中');
 const order=await call('/api/orders','POST',{orderNo:'LINK-O',clientName:'ACME',quoteId:quote.id,status:'待确认',orderDate:'2026-08-05'});assert.equal(order.inquiryId,inq.id);assert.equal((await get(inq.id)).status,'谈判中');
 await call('/api/orders/batch','PATCH',{ids:[order.id],patch:{status:'已确认'}});const won=await get(inq.id);assert.equal(won.status,'成交');assert.equal(won.wonAt,Date.parse('2026-08-05T00:00:00+08:00'));assert.equal(won.stageLog.length,4);
 assert.equal((await request('/api/quotations/'+quote.id,'PUT',{inquiryId:other.id},tok)).status,400);
 await call('/api/orders/'+order.id,'PUT',{status:'已取消'});assert.equal((await get(inq.id)).status,'成交');
 assert.equal((await request('/api/quotations','POST',{clientName:'WRONG',inquiryId:other.id},tok)).status,400);
 const u=await call('/api/users','POST',{username:'isolated',name:'隔离',password,role:'sales'});const login=await call('/api/login','POST',{username:'isolated',password});
 assert.equal((await request('/api/orders','POST',{clientName:'ACME',inquiryId:inq.id},login.token)).status,403);
 const legacy=await call('/api/quotations','POST',{clientName:'ACME',quoteNo:'OLD'});assert(legacy.inquiryId);assert.equal((await get(other.id)).status,'新询盘');await call('/api/quotations/'+legacy.id,'PUT',{inquiryId:other.id});assert.equal((await get(other.id)).status,'已报价');
 const otherClient=await call('/api/clients','POST',{company:'Different'});
 assert.equal((await request('/api/inquiries/'+inq.id,'PUT',{clientId:otherClient.id,clientName:'Different'},tok)).status,400);
 const sourceClient=await call('/api/clients','POST',{company:'Source',source:'报价建档'});assert.equal(sourceClient.source,'阿里巴巴');
 const sync=await call('/api/inquiries/reconcile','POST',{});assert.equal(sync.changed.length,0);
 const persisted=JSON.parse(await fs.readFile(path.join(dir,'inquiries.json'),'utf8'));assert.equal(persisted.find(q=>q.id===inq.id).stageLog.length,4);
 assert.equal((await request('/api/inquiries/'+inq.id,'PUT',{status:'暂缓'},tok)).status,400);
 const manual=await call('/api/inquiries/'+inq.id,'PUT',{status:'暂缓',lastStageReason:'客户推迟项目',stageLog:[]});assert.equal(manual.stageLog.length,5);assert.equal(manual.stageLog[4].from,'成交');assert.equal(manual.stageLog[4].reason,'客户推迟项目');assert.equal(manual.stageLog[4].automatic,false);
 const edited=await call('/api/inquiries/'+inq.id,'PUT',{notes:'补充备注',stageLog:[],lastStageReason:'伪造替换'});assert.equal(edited.stageLog.length,5);assert.equal(edited.lastStageReason,'客户推迟项目');assert.equal(edited.chatLog,'客户原始沟通');
 const follow=await call('/api/inquiries/'+inq.id+'/followups','POST',{content:'客户补充技术要求',nextFollowAt:'2026-10-20',userId:'forged',by:'forged'});assert.equal(follow.followLog.length,1);assert.equal(follow.followLog[0].userId,follow.owner);assert.notEqual(follow.followLog[0].by,'forged');assert.equal(follow.notes,'补充备注');assert.equal(follow.chatLog,'客户原始沟通');assert.equal(follow.product,'A');assert.equal(follow.status,'暂缓');assert.equal(follow.stageLog.length,5);
 await Promise.all([1,2].map(n=>call('/api/inquiries/'+inq.id+'/followups','POST',{content:'追加记录 '+n})));let current=await get(inq.id);assert.equal(current.followLog.length,3);assert.equal(current.nextFollowAt,'2026-10-20');
 await call('/api/inquiries/'+inq.id,'PUT',{notes:'再次补充',followLog:[]});assert.equal((await get(inq.id)).followLog.length,3);
 assert.equal((await request('/api/inquiries/'+inq.id+'/followups','POST',{content:''},tok)).status,400);assert.equal((await request('/api/inquiries/'+inq.id+'/followups','POST',{content:'Bad date',nextFollowAt:'2026-02-30'},tok)).status,400);assert.equal((await request('/api/inquiries/'+inq.id+'/followups','POST',{content:'No access'},login.token)).status,403);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'inquiries.json'),'utf8')).find(i=>i.id===inq.id).followLog.length,3);

});
