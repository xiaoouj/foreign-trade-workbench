import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileInquiries} from '../inquiry-link.js';
const inq={id:'i1',clientName:'ACME',status:'新询盘',owner:'u1'},quote={id:'q1',clientName:'acme',inquiryId:'i1',status:'草稿',owner:'u1'};
const run=(inqs=[inq],quotes=[quote],orders=[])=>reconcileInquiries(inqs,quotes,orders,{now:1234,actor:'test'});
test('explicit links advance once, no same-client bulk matching',()=>{
 const r=run([inq,{...inq,id:'i2'}]);assert.equal(r.inquiries[0].status,'已报价');assert.equal(r.inquiries[1].status,'新询盘');assert.equal(r.changed.length,1);assert.equal(run(r.inquiries).changed.length,0);assert.equal(r.inquiries[0].stageLog.length,1);
 assert.equal(run([inq],[{...quote,clientName:'OTHER'}]).changed.length,0);
});
test('confirmed order, not customer confirmation or pending order, means won',()=>{
 const pending={id:'o1',clientName:'ACME',quoteId:'q1',status:'待确认',createdAt:500};
 assert.equal(run([inq],[{...quote,status:'客户确认'}],[pending]).inquiries[0].status,'谈判中');
 const won=run([inq],[quote],[{...pending,status:'已确认',orderDate:'2026-08-05'}]).inquiries[0];assert.equal(won.status,'成交');assert.equal(won.wonAt,Date.parse('2026-08-05T00:00:00+08:00'));
 assert.equal(run([inq],[],[{...pending,quoteId:null,inquiryId:'i1',status:'已收款'}]).inquiries[0].status,'成交');
});
test('no regressions, no reopening closed inquiries, no unauthorized synchronization',()=>{
 for(const status of ['谈判中','成交','输单','暂缓','无效'])assert.equal(run([{...inq,status}]).changed.length,0);
 assert.equal(run([inq],[{...quote,status:'客户拒绝'}],[]).changed.length,0);
 const r=reconcileInquiries([inq],[quote],[],{canAccess:r=>r.owner==='u2'});assert.equal(r.changed.length,0);
 assert.equal(run([{...inq,clientId:'c1'}],[{...quote,clientId:'c2'}]).changed.length,0);
});

test('unlinked quotation creates a separate opportunity with business data and stable retry identity',async()=>{
 const {provisionQuoteInquiry}=await import('../inquiry-link.js');
 const q={id:'q-new',clientName:'ACME',owner:'u1',ownerName:'张三',currency:'USD',projectName:'项目 A',quoteNo:'Q-NEW',status:'已发送',items:[{name:'Machine',qty:2,unitPrice:100}]};
 const r=provisionQuoteInquiry(q,[{...inq,id:'unrelated'}],{now:1791849600000,id:'generated',actor:'test'});
 assert.equal(q.inquiryId,'generated');assert.equal(r.created.originQuoteId,q.id);assert.equal(r.created.product,'项目 A');assert.equal(r.created.expectedAmount,200);assert.equal(r.created.owner,'u1');assert.equal(r.created.currency,'USD');assert.equal(r.created.source,'阿里巴巴');
 q.inquiryId=null;const retry=provisionQuoteInquiry(q,[r.created],{now:1791849600001,id:'different'});assert.equal(retry.created,null);assert.equal(q.inquiryId,'generated');
 const explicit={...q,inquiryId:'chosen'};assert.equal(provisionQuoteInquiry(explicit,[],{id:'other'}).created,null);assert.equal(explicit.inquiryId,'chosen');
});
