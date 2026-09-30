import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAiAgent} from '../ai-agent.js';

test('AI summaries and customer detail filter every linked collection by owner',async t=>{
 const originalFetch=globalThis.fetch;t.after(()=>globalThis.fetch=originalFetch);
 for(const role of ['sales','manager']){
  const user={id:'mine',role};let calls=0,payload;
  globalThis.fetch=async(url,opts)=>{calls++;payload=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:calls===1?'<<<AI_ACTION>>>\n{"tool":"query_client_detail","params":{"clientId":"client"}}\n<<<END>>>':'Done'}}]})};};
  const files=Object.fromEntries(['CLIENTS_FILE','INQ_FILE','ORDERS_FILE','QUOTATIONS_FILE','COMM_FILE','TASKS_FILE','CONTACTS_FILE'].map(x=>[x,x]));
  const own={id:'client',owner:'mine',company:'Same',clientName:'Same',clientId:'client',content:'own'};
  const foreign={id:'foreign',owner:'other',company:'Same',clientName:'Same',clientId:'client',content:'private'};
  const legacy={id:'legacy',company:'Same',clientName:'Same',clientId:'client',content:'unassigned'};
  let response;
  await handleAiAgent({}, {messages:[{role:'user',content:'Customer details'}]}, {
   user,files,readJson:async()=>[own,foreign,legacy],
   buildVisibleOwners:u=>u.role==='manager'?null:new Set([u.id]),
   canAccessRecord:(u,owner)=>u.role==='manager'||u.id===owner,
   resolveAiCfg:async()=>({baseUrl:'http://fixture',model:'mock'}),joinUrl:(a,b)=>a+b,aiHeaders:()=>({}),abortAfter:()=>undefined,aiErrMsg:e=>e.message,
   sendJson:(res,status,body)=>{assert.equal(status,200);response=body;}
  });
  const count=role==='manager'?3:1;
  assert.match(payload.messages[0].content,new RegExp('客户 '+count+' 家'));
  assert.deepEqual(response.queryResults[0].result.counts,{inquiries:count,quotations:count,orders:count});
  if(role==='sales')assert(!JSON.stringify(response).includes('private'));
 }
});
