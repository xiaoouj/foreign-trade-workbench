import test from 'node:test';import assert from 'node:assert/strict';
import {mergeQuoteVersions} from '../quote-version-merge.js';import {createQuote,reviseQuote} from '../sales-records.js';
const user={id:'u1',name:'User'},body={clientName:'ACME',clientId:'c1',quoteNo:'QT-1',owner:'u1',currency:'USD',items:[{name:'Machine',qty:1,unitPrice:100}]};
test('same-number duplicate records preserve historical contents and retarget orders',()=>{
 const first=createQuote(body,user,100,'q1'),second=createQuote({...body,items:[{name:'Machine',qty:1,unitPrice:200}]},user,200,'q2');
 first.inquiryId='i1';second.inquiryId='i2';
 const inqs=[{id:'i1',originQuoteId:'q1',clientId:'c1',clientName:'ACME',status:'已报价',notes:'first',stageLog:[{from:'等回复',to:'已报价',reason:'手动调整',at:120,by:'User'}]},{id:'i2',originQuoteId:'q2',clientId:'c1',clientName:'ACME',status:'已报价',notes:'second',stageLog:[]}];
 const result=mergeQuoteVersions([first,second],inqs,[{id:'o1',quoteId:'q2',inquiryId:'i2',clientId:'c1',clientName:'ACME',status:'待确认'}],{related:{exceptions:[{id:'e1',inquiryId:'i2'}],tasks:[{id:'t1',relatedKind:'inquiry',relatedId:'i2',related:'inquiry:i2'}]}});
 assert.equal(result.merged.length,1);assert.equal(result.quotations.length,1);assert.equal(result.quotations[0].id,'q1');assert.equal(result.quotations[0].version,2);assert.equal(result.quotations[0].items[0].unitPrice,200);assert.equal(result.quotations[0].revisionHistory[0].snapshot.items[0].unitPrice,100);assert.equal(result.quotations[0].revisionHistory[1].snapshot.items[0].unitPrice,200);assert.equal(result.orders[0].quoteId,'q1');assert.equal(result.orders[0].inquiryId,'i1');assert.equal(result.inquiries.length,1);assert.equal(result.related.exceptions[0].inquiryId,'i1');assert.equal(result.related.tasks[0].relatedId,'i1');assert.match(result.inquiries[0].notes,/second/);assert(result.inquiries[0].stageLog.some(l=>l.reason==='手动调整'));assert.equal(mergeQuoteVersions(result.quotations,result.inquiries,result.orders).merged.length,0);
});
test('identical imports do not create fake modification rounds; different customers or owners stay separate',()=>{
 const a=createQuote(body,user,100,'q1'),b=createQuote({...body,quoteNo:' qt-1 '},user,200,'q2');assert.equal(mergeQuoteVersions([a,b],[],[]).quotations[0].version,1);
 for(const patch of [{clientId:'c2',clientName:'Other'},{owner:'u2'}]){const r=mergeQuoteVersions([a,{...b,...patch}],[],[]);assert.equal(r.quotations.length,2);assert.equal(r.skipped.length,1);}
});
test('existing versions and manual inquiry state are preserved',()=>{
 const a=reviseQuote(createQuote(body,user,100,'q1'),{notes:'version two'},user,150),b=createQuote({...body,notes:'version three'},user,200,'q2');
 assert.equal(mergeQuoteVersions([a,b],[],[]).quotations[0].version,3);
 a.inquiryId='i1';b.inquiryId='i2';assert.equal(mergeQuoteVersions([a,b],[{id:'i1',clientName:'ACME',status:'谈判中'},{id:'i2',clientName:'ACME',status:'新询盘'}],[]).merged.length,0);
});
