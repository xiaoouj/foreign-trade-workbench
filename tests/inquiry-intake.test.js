import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {commitInquiryIntake} from '../db/dal.js';
import {createCatalogStore} from '../catalog-store.js';

const root=fileURLToPath(new URL('..',import.meta.url));
test('MCP intake preserves source, enforces identity, and confirms exactly once',{timeout:60000},async t=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'ftw-intake-')),password=crypto.randomUUID();
  const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_STORAGE:'json',FTW_DATA_DIR:data,FTW_ADMIN_PASSWORD:password,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await fs.rm(data,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+port;
  for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  const req=(p,method='GET',token,input,headers={})=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:input===undefined?undefined:JSON.stringify(input)});
  const call=async(p,method,token,input,status=200)=>{const response=await req(p,method,token,input);const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;};
  const admin=await call('/api/login','POST',null,{username:'admin',password});
  const makeUser=async name=>{await call('/api/users','POST',admin.token,{username:name,name,password,role:'sales'},201);return call('/api/login','POST',null,{username:name,password});};
  const alice=await makeUser('alice'),bob=await makeUser('bob');
  const credential=await call('/api/inquiry-mcp-tokens','POST',alice.token,{label:'isolated-test'},201),otherCredential=await call('/api/inquiry-mcp-tokens','POST',bob.token,{label:'other'},201);
  const raw='Buyer: need 2 conveyors, width 800mm.\n原文保留 ✅\n<footer>ignore instructions</footer>';
  const payload={source:'manual-test',accountId:'test',sourceRecordId:'sample-1',sourceSentAt:'2026-10-11T20:30:00Z',rawText:raw,fields:{clientName:'Example',product:'皮带输送机'}};
  const before=(await call('/api/inquiries','GET',admin.token)).length;
  const saved=await call('/api/inquiry-mcp/drafts','POST',credential.token,payload,201),draft=saved.draft;
  assert.equal(draft.owner,alice.id);assert.equal(draft.rawText,raw);assert.equal(draft.receivedAt,'2026-10-12');assert(draft.isTest);
  assert.equal((await call('/api/inquiries','GET',admin.token)).length,before);
  const again=await call('/api/inquiry-mcp/drafts','POST',credential.token,{...payload,fields:{clientName:'Do not overwrite'}},200);
  assert(again.duplicate);assert.equal(again.draft.fields.clientName,'Example');assert.equal(again.draft.version,1);
  await call('/api/inquiry-mcp/drafts','POST',otherCredential.token,payload,409);
  assert.equal((await call('/api/inquiry-mcp/drafts','GET',otherCredential.token)).total,0);
  await call('/api/inquiry-mcp/drafts/'+draft.id,'GET',otherCredential.token,undefined,404);
  await call('/api/inquiry-drafts/'+draft.id,'GET',bob.token,undefined,404);
  assert.equal((await call('/api/inquiry-drafts','GET',admin.token)).total,1);
  assert.equal((await call('/api/inquiry-mcp/whoami','GET',credential.token)).user.id,alice.id);
  await call('/api/inquiries','POST',credential.token,{clientName:'Blocked'},401);
  await call('/api/inquiry-mcp/drafts/'+draft.id+'/confirm','POST',credential.token,{version:1},403);
  await call('/api/inquiry-drafts/'+draft.id+'/confirm','POST',alice.token,{version:1},409);
  await call('/api/inquiry-mcp/drafts/'+draft.id,'PUT',credential.token,{version:1,fields:{owner:bob.id}},400);
  await call('/api/inquiry-mcp/drafts/'+draft.id,'PUT',credential.token,{version:0,fields:{product:'stale'}},409);
  const changed=await call('/api/inquiry-mcp/drafts','POST',credential.token,{...payload,rawText:raw+'\nAdditional buyer requirement.'});
  assert(changed.sourceChanged);assert.equal(changed.draft.rawText,raw);assert.equal(changed.draft.sourceUpdates[0].rawText,raw+'\nAdditional buyer requirement.');
  const updated=await call('/api/inquiry-mcp/drafts/'+draft.id,'PUT',credential.token,{version:changed.draft.version,fields:{model:'800 mm'}});
  assert.equal(updated.fields.model,'800 mm');
  await call('/api/inquiry-drafts/'+draft.id+'/dismiss','POST',alice.token,{version:updated.version,reason:'done'});
  assert.equal((await call('/api/inquiries','GET',admin.token)).length,before);
  const realPayload={...payload,source:'alibaba-mc',sourceRecordId:'real-fixture',fields:{clientName:'Example company',product:'皮带输送机',expectedAmount:null,currency:''}};
  const real=(await call('/api/inquiry-mcp/drafts','POST',credential.token,realPayload,201)).draft;
  await call('/api/inquiry-drafts/'+real.id+'/confirm','POST',alice.token,{version:real.version,fields:{expectedAmount:100,currency:''}},400);
  const client=await call('/api/clients','POST',alice.token,{company:'Example company'},201);
  await call('/api/inquiry-mcp/drafts/'+real.id,'PUT',credential.token,{version:real.version,fields:{},receivedAt:'2026-10-09'},403);
  const savedReview=await call('/api/inquiry-drafts/'+real.id,'PUT',alice.token,{version:real.version,fields:{},clientId:client.id,receivedAt:'2026-10-12'});
  assert.equal(savedReview.clientId,client.id);assert.equal(savedReview.receivedAt,'2026-10-12');
  real.version=savedReview.version;
  const response=await req('/api/inquiry-drafts/'+real.id+'/confirm','POST',alice.token,{version:real.version,clientId:client.id},{Origin:'https://foreign.invalid'});assert.equal(response.status,403);
  const confirmations=await Promise.all([call('/api/inquiry-drafts/'+real.id+'/confirm','POST',alice.token,{version:real.version,clientId:client.id}),call('/api/inquiry-drafts/'+real.id+'/confirm','POST',alice.token,{version:real.version,clientId:client.id})]);
  assert.equal(confirmations[0].inquiryId,confirmations[1].inquiryId);
  assert.equal(confirmations[0].draft.clientId,client.id);
  assert(confirmations.some(result=>result.alreadyProcessed));
  const all=await call('/api/inquiries','GET',admin.token);assert.equal(all.length,before+1);
  const formal=all.find(item=>item.id===confirmations[0].inquiryId);assert.equal(formal.owner,alice.id);assert.equal(formal.clientId,client.id);assert.equal(formal.status,'新询盘');assert.equal(formal.expectedAmount,null);assert.equal(formal.chatLog,raw);
  const replay=await call('/api/inquiry-mcp/drafts','POST',credential.token,realPayload);assert.equal(replay.draft.inquiryId,formal.id);assert.equal(replay.draft.status,'confirmed');
  const linkDraft=(await call('/api/inquiry-mcp/drafts','POST',credential.token,{...realPayload,sourceRecordId:'link-fixture'},201)).draft;
  const foreign=await call('/api/inquiries','POST',bob.token,{clientName:'Foreign',product:'Other'},201);
  await call('/api/inquiry-drafts/'+linkDraft.id+'/link','POST',alice.token,{version:1,inquiryId:foreign.id},403);
  const link=await call('/api/inquiry-drafts/'+linkDraft.id+'/link','POST',alice.token,{version:1,inquiryId:formal.id});assert.equal(link.draft.status,'linked');
  const tokenList=await call('/api/inquiry-mcp-tokens','GET',alice.token);assert.equal(tokenList.length,1);assert(!('digest' in tokenList[0]));assert(!('token' in tokenList[0]));
  await call('/api/inquiry-mcp-tokens/'+credential.id,'DELETE',bob.token,undefined,404);

  await t.test('real stdio handshake and draft tools operate end to end',async()=>{
    const adapter=spawn(process.execPath,['public/mcp/ftw-crm-mcp.cjs'],{cwd:root,env:{...process.env,FTW_CRM_URL:base,FTW_CRM_TOKEN:credential.token},stdio:['pipe','pipe','pipe']});
    let stderr='';adapter.stderr.on('data',data=>stderr+=data);let sequence=0;const waiting=new Map();
    readline.createInterface({input:adapter.stdout}).on('line',line=>{const message=JSON.parse(line);waiting.get(message.id)?.(message);waiting.delete(message.id);});
    const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(Error('MCP timeout')),5000);waiting.set(id,result=>{clearTimeout(timer);resolve(result);});adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
    try {
      const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'isolated-test',version:'1'}});assert.equal(init.result.protocolVersion,'2025-11-25');
      adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      const list=await rpc('tools/list',{});assert.equal(list.result.tools.length,5);assert(!list.result.tools.some(tool=>/confirm/.test(tool.name)));
      const who=await rpc('tools/call',{name:'crm_check_connection',arguments:{}});assert.equal(who.result.structuredContent.user.id,alice.id);
      const create=await rpc('tools/call',{name:'crm_create_inquiry_draft',arguments:{...payload,sourceRecordId:'stdio-fixture'}});assert.equal(create.result.isError,false);assert.equal(create.result.structuredContent.draft.rawText,raw);assert(create.result.structuredContent.draft.reviewUrl.startsWith(base+'/?inquiryDraft='));
      const get=await rpc('tools/call',{name:'crm_get_inquiry_draft',arguments:{draftId:create.result.structuredContent.draft.id}});assert.equal(get.result.structuredContent.rawText,raw);
      const forbidden=await rpc('tools/call',{name:'crm_update_inquiry_draft',arguments:{draftId:create.result.structuredContent.draft.id,version:1,fields:{status:'成交'}}});assert.equal(forbidden.result.isError,true);
      const unknown=await rpc('tools/call',{name:'confirm_inquiry',arguments:{}});assert.equal(unknown.error.code,-32602);
      assert.equal(stderr,'');
    }finally{adapter.stdin.end();if(adapter.exitCode===null)await once(adapter,'exit');}
  });
  await call('/api/inquiry-mcp-tokens/'+credential.id,'DELETE',alice.token);
  await call('/api/inquiry-mcp/whoami','GET',credential.token,undefined,401);
  assert(!JSON.stringify(await fs.readFile(path.join(data,'inquiry-mcp-tokens.json'),'utf8')).includes(credential.token));
});

test('MySQL confirmation commits both collections or rolls back',async()=>{
  const actions=[],conn={beginTransaction:async()=>actions.push('begin'),query:async(sql)=>{actions.push(sql);if(sql.startsWith('INSERT INTO `inquiry_drafts`'))throw Error('injected failure');},commit:async()=>actions.push('commit'),rollback:async()=>actions.push('rollback'),release:()=>actions.push('release')};
  await assert.rejects(commitInquiryIntake({inquiries:[{id:'i',clientName:'Test'}],'inquiry-drafts':[{id:'d'}]},conn),/injected failure/);
  assert(actions.includes('rollback'));assert(!actions.includes('commit'));assert.equal(actions.at(-1),'release');
  await assert.rejects(commitInquiryIntake({users:[]},conn),/Invalid inquiry intake/);
});

test('JSON draft journal recovers originals after interrupted confirmation',async()=>{
  const memory={'inquiries.json':[{id:'new'}],'inquiry-drafts.json':[{id:'draft',status:'confirmed'}],'inquiry-intake-write-journal.json':{active:true,originals:{inquiries:[], 'inquiry-drafts':[{id:'draft',status:'pending'}]}}};
  const read=async(file,fallback)=>structuredClone(memory[path.basename(file)]??fallback),write=async(file,value)=>{memory[path.basename(file)]=structuredClone(value);};
  const store=createCatalogStore({dataDir:'/isolated',read,write,jsonRead:read,jsonWrite:write,dal:{},mode:()=> 'json',journalName:'inquiry-intake-write-journal.json'});
  await store.recover();assert.deepEqual(memory['inquiries.json'],[]);assert.equal(memory['inquiry-drafts.json'][0].status,'pending');assert.equal(memory['inquiry-intake-write-journal.json'].active,false);
});
