import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/order-workflow.js';
const rules = globalThis.FTWOrderWorkflow;

test('production and every later stage count the full order; confirmation and cancellation do not', () => {
  for (const status of ['生产中','待收尾款','待发货','已发货','已完成','已收款']) {
    assert.equal(rules.isDeal({status, amount:10000, paidPercent:30}), true, status);
  }
  for (const status of ['待确认','待收预付款','已确认','已取消','Cancelled','未知状态']) {
    assert.equal(rules.isDeal({status}), false, status);
  }
  assert.equal(rules.stage({status:'已确认'}), '待收预付款');
  assert.equal(rules.stage({status:'已收款'}), '待发货');
  assert.equal(rules.isConfirmed({status:'待收尾款'}), true);
  assert.equal(rules.isConfirmed({status:'待收预付款'}), true);
  assert.equal(rules.isConfirmed({status:'已取消'}), false);
});

test('split actual deposits and balances in the order currency without inventing receipts', () => {
  const order = {status:'生产中',amount:10000,depositPercent:30,paidPercent:20};
  assert.deepEqual(rules.payment(order), {amount:10000,paidPercent:20,received:2000,outstanding:8000,known:true,source:'recorded'});
  assert.equal(rules.payment({...order,paidPercent:0}).received, 0);
  assert.equal(rules.payment({...order,paidPercent:'12.5'}).received, 1250);
  assert.equal(rules.payment({...order,amount:'100.01',paidPercent:33.33}).outstanding, 66.68);
  for (const status of ['生产中','待收尾款','待发货','已发货']) {
    const p=rules.payment({status,amount:10000,depositPercent:30});
    assert.equal(p.known, false, status);
    assert.equal(p.received, null);
    assert.equal(p.outstanding, null);
  }
  assert.equal(rules.payment({status:'生产中',amount:100,paidPercent:101}).known,false);
  assert.equal(rules.payment({status:'生产中',amount:'bad',paidPercent:30}).known,false);
  assert.equal(rules.payment({status:'生产中',amount:null,paidPercent:30}).known,false);
  assert.equal(order.paidPercent,20);
});

test('retain historical full-payment totals, while explicit actual percentages take precedence', () => {
  for (const status of ['已收款','已完成']) {
    assert.equal(rules.payment({status,amount:500,paidPercent:null}).received,500);
    assert.equal(rules.payment({status,amount:500,paidPercent:0}).received,0);
    assert.equal(rules.payment({status,amount:500,paidPercent:30}).outstanding,350);
  }
  for (const status of ['待确认','待收预付款','已确认']) {
    assert.equal(rules.payment({status,amount:500}).received,0);
    assert.equal(rules.payment({status,amount:500}).outstanding,500);
  }
});
