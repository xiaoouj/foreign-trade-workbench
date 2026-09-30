import test from 'node:test';
import assert from 'node:assert/strict';
import {positionedPdfText} from '../doc-parser.js';
const viewport={convertToViewportPoint:(x,y)=>[x,y]};
const item=(str,x,y,width=10)=>({str,transform:[1,0,0,1,x,y],width});
test('PDF text uses visual position rather than drawing order and preserves Chinese lines',()=>{
 const text=positionedPdfText([item('卖方',0,30),item('买方',0,10),item('名称',20,10),item('中文',0,20)],viewport);
 assert.equal(text,'买方\t名称\n中文\n卖方');
});
test('PDF merged descriptions retain one amount row, including zero price and fees',()=>{
 const items=[item('Qty',100,10),item('Unit price',150,10),item('Rack',0,22),item('beam',0,30),item('panel',0,38),item('5',100,30),item('US$55.00',150,30),item('US$275.00',220,30),item('Previous order left',0,55),item('4',100,55),item('US$0.00',150,55),item('US$0.00',220,55),item('Bank fee',0,80),item('1',100,80),item('US$50.00',150,80),item('US$50.00',220,80),item('Total amount US$325.00',0,95)];
 const text=positionedPdfText(items.reverse(),viewport);
 assert.equal((text.match(/【报价明细行/g)||[]).length,3);
 assert.match(text,/数量：5；单价：US\$55.00；行金额：US\$275.00/);
 assert.match(text,/数量：4；单价：US\$0.00；行金额：US\$0.00/);
 assert.match(text,/panel/);assert.match(text,/Bank fee/);assert.match(text,/Total amount US\$325.00/);
});
test('PDF ambiguous amounts remain original text instead of fabricating rows',()=>{
 const text=positionedPdfText([item('Qty',100,10),item('Unit price',150,10),item('5',100,30),item('US$55.00',150,30),item('US$200.00',220,30),item('Total amount',0,50)],viewport);
 assert(!text.includes('【报价明细行'));assert(text.includes('US$200.00'));
});
