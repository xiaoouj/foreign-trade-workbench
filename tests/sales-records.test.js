import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSalesFields,createQuote,reviseQuote} from '../sales-records.js';
const user={id:'u1',name:'张三'},input={quoteNo:'QT1',items:[{name:'包装机',qty:2,unitPrice:12000}],depositPercent:30};
test('percentages distinguish unset, zero, agreed and actual; reject invalid values',()=>{
 assert.deepEqual(normalizeSalesFields({depositPercent:'30',paidPercent:0,productionProgress:''}),{depositPercent:30,paidPercent:0,productionProgress:null});
 for(const value of [-1,101,true,' ',NaN,'30%',33.333])assert.throws(()=>normalizeSalesFields({paidPercent:value}));
 assert.equal(normalizeSalesFields({paidPercent:'33.33'}).paidPercent,33.33);
});
test('server owns revision history; no-op/status updates do not create rounds',()=>{
 const q=createQuote({...input,version:99,revisionHistory:[{fake:true}]},user,1,'q1');
 assert.equal(q.version,1);assert.equal(q.revisionHistory.length,1);
 const same=reviseQuote(q,{...input,items:[{unitPrice:'12000',qty:'2',name:'包装机'}],version:50,revisionHistory:[],status:'已发送'},user,2);
 assert.equal(same.version,1);assert.deepEqual(same.revisionHistory,q.revisionHistory);
 const changed=reviseQuote(same,{depositPercent:50,notes:'变更',baseVersion:1},user,3);
 assert.equal(changed.version,2);assert.deepEqual(changed.revisionHistory[1].changes,['定金比例','备注']);assert.equal(changed.revisionHistory[0].snapshot.depositPercent,30);
 assert.throws(()=>reviseQuote(changed,{baseVersion:1,notes:'stale'},user,4),{status:409});
});
test('legacy quotes retain their version and explicitly establish a history baseline',()=>{
 const q=reviseQuote({...input,id:'old',version:5},{notes:'新修改'},user,2);
 assert.equal(q.version,6);assert.equal(q.revisionHistory[0].kind,'baseline');assert.equal(q.revisionHistory[0].version,5);assert.equal(q.revisionHistory[1].version,6);
});
