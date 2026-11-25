import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function orderSortDate('),source.indexOf('function renderOrders()')),context);
const date=record=>context.orderDateValue(record);

test('order date sorting uses explicit order date ahead of creation time',()=>{
  assert.equal(date({orderDate:'2026-10-12',createdAt:Date.parse('2026-10-20T12:00:00+08:00')}),'2026-10-12');
  assert.equal(context.orderSortDate({orderDate:'2026-10-12'}),'2026-10-12');
});

test('missing order dates use the displayed creation day in every business status',()=>{
  for(const status of ['待确认','已确认','生产中','已发货','已收款','已完成','已取消']) {
    const record={status,orderDate:null,createdAt:Date.parse('2026-10-20T04:00:00+08:00')};
    assert.equal(date(record),'2026-10-20',status);
    assert.equal(context.orderSortDate(record),date(record));
  }
});

test('invalid or impossible order dates fall back to creation date',()=>{
  for(const orderDate of ['', 'invalid', '2026-02-30','2025-02-29'])assert.equal(date({orderDate,createdAt:'2026-10-19T18:00:00Z'}),'2026-10-20');
  assert.equal(date({orderDate:'2024-02-29'}),'2024-02-29');
});

test('numeric string timestamps and timezone boundaries use Shanghai calendar days',()=>{
  const stamp=Date.parse('2026-10-19T16:01:00Z');
  assert.equal(date({createdAt:String(stamp)}),'2026-10-20');
  assert.equal(date({createdAt:'2026-10-19T15:59:00Z'}),'2026-10-19');
});

test('unknown dates remain empty and do not borrow delivery or modification dates',()=>{
  for(const createdAt of [undefined,null,'',0,'invalid'])assert.equal(date({createdAt,deliveryDate:'2026-10-20',updatedAt:Date.now()}),'');
});

test('mixed status orders sort by their displayed date rather than payment state',()=>{
  const records=[
    {id:'paid',status:'已收款',orderDate:'2026-10-19'},
    {id:'pending',status:'待确认',orderDate:null,createdAt:Date.parse('2026-10-20T10:00:00+08:00')},
    {id:'confirmed',status:'已确认',orderDate:'2026-10-12',createdAt:Date.parse('2026-10-21T10:00:00+08:00')},
    {id:'unknown',status:'生产中'},
  ];
  const sorted=records.slice().sort((a,b)=>context.orderSortDate(b).localeCompare(context.orderSortDate(a)));
  assert.deepEqual(sorted.map(r=>r.id),['pending','paid','confirmed','unknown']);
  assert.equal(records[1].orderDate,null);
});
