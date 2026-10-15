import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareSource, planImport, visibleHistory, priceGroups, quoteProductLines, validateProduct } from '../product-catalog.js';
import { parseQuoteCsv, uploadedQuoteSource } from '../catalog-upload.js';
import { createCatalogStore } from '../catalog-store.js';
import { createCatalogRoutes } from '../catalog-routes.js';
import { commitCatalog } from '../db/dal.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Synthetic catalog exercises missing prices/dates, fee and review rows, internal
// records and multiple buyers without bundling any private quote history.
const full=['设备/物料名称','型号/规格','设备品类','客户','路径','单价','币种','报价单号','日期','数量','单位','资料类别','贸易条款'];
const dcols=['路径','报价单号','客户','日期','资料类别','币种','贸易条款','单据总额'];
const fixtureRows=[
 ['测试滚筒输送机','M1','输送机-滚筒','Example Buyer A','example-a',10,'USD','Q-A','2026-01-01',1,'SET','客户对外报价','EXW'],
 ['测试滚筒输送机','M1','输送机-滚筒','Example Buyer B','example-b',20,'USD','Q-B','2026-01-02',1,'SET','客户对外报价','FOB'],
 ['测试滚筒输送机','M1','输送机-滚筒','Example Buyer A','example-internal',30,'USD','Q-I','2026-01-03',1,'SET','内部资料(非对外)','EXW'],
 ['测试齿轮','G1','配件-轴承/齿轮/电机','Example Buyer A','example-gear',0,'USD','Q-G','',4,'PCS','客户对外报价','EXW'],
 ['测试电机','E1','配件-轴承/齿轮/电机','Example Buyer B','example-motor',null,'USD','Q-E','',1,'PCS','客户对外报价','EXW'],
 ['银行费用','','费用','Example Buyer A','example-fee',50,'USD','Q-F','',1,'','客户对外报价','EXW'],
 ['未知名称','','规格/续行片段','Example Buyer B','example-review',null,'USD','Q-R','',null,'','客户对外报价','']
];
const kb={full,rows:fixtureRows,dcols,docs:fixtureRows.map(r=>[r[4],r[7],r[3],r[8],r[11],r[6],r[12],r[5]==null?null:r[5]*(r[9]||1)])};
const source = prepareSource(kb);
const adminUser = {id:'admin',name:'Admin',role:'admin'};

test('all source lines have a destination; versions use paths, empty prices and dates remain unknown', () => {
  const p = planImport(source, [], [], adminUser);
  assert.equal(p.rows.length,fixtureRows.length); assert.equal(source.docs.length,kb.docs.length);
  assert.equal(p.rows.filter(r=>r.disposition==='linked').length+p.counts.fee+p.counts.review,fixtureRows.length);
  assert(p.rows.every(r=>r.documentIds.length));
  assert.equal(p.rows.filter(r=>r.unitPrice===null).length,2);
  assert(p.rows.filter(r=>!r.date).length>=4);
  assert(p.additions.every(p=>p.price===null&&p.status==='待完善'));
  assert(p.rows.filter(r=>/费用/.test(r.category)).every(r=>r.disposition==='fee'));
  const again = planImport(source,p.additions,p.rows,adminUser);
  assert.equal(again.additions.length,0); assert.equal(again.counts.alreadyImported,fixtureRows.length);
  assert.equal(new Set(p.rows.map(r=>r.id)).size,fixtureRows.length);
  assert.throws(()=>prepareSource({...kb,rows:[[1]]}));
});
test('conflicting products require review, price summaries separate terms and omit unknown latest dates', () => {
  const p=planImport(source,[],[],adminUser),first=p.additions[0];
  const ambiguous=planImport(source,[first,{...first,id:'other'}],[],adminUser);
  assert(ambiguous.rows.some(r=>r.reason==='多个同名同规格产品，需选择档案'));
  const base={disposition:'linked',kind:'客户对外报价',unitPrice:0,currency:'USD',unit:'SET',model:'M',tradeTerms:'FOB',date:''};
  const groups=priceGroups([base,{...base,unitPrice:100,tradeTerms:'EXW',date:'2026-01-01'},{...base,currency:'CNY',unitPrice:200},{...base,unitPrice:null}]);
  assert.equal(groups.length,3);const zeroGroup=groups.find(g=>g.currency==='USD'&&g.tradeTerms==='FOB');assert.equal(zeroGroup.min,0);assert.equal(zeroGroup.latest,null);
  assert.equal(visibleHistory([{kind:'内部资料(非对外)',owner:'s',clientName:'A'},{kind:'客户对外报价',owner:'a',clientName:'A'}],{id:'s',role:'sales'},[{company:'A',owner:'s'},{company:'A',owner:'other'}]).length,0);
  assert.throws(()=>validateProduct({name:'x',price:'no'}));
  assert.throws(()=>validateProduct({name:'x',price:'0'}));
});
test('history price summaries preserve missing units, zero and separate source types', () => {
  const row = {disposition:'linked',kind:'客户对外报价',unitPrice:0,currency:'USD',unit:'',model:'M',tradeTerms:'FOB',date:''};
  const prices = priceGroups([row,{...row,unitPrice:10,date:'2026-10-01'},{...row,kind:'客户报价/其他',unitPrice:100},{...row,kind:'内部资料(非对外)',unitPrice:500},{...row,currency:'',unitPrice:20},{...row,unit:'SET',unitPrice:30},{...row,unitPrice:null},{...row,unitPrice:-1},{...row,disposition:'review',unitPrice:999}]);
  assert.equal(prices.length,5);
  const external=prices.find(g=>g.kind==='客户对外报价'&&g.currency==='USD'&&!g.unit);
  assert.equal(external.min,0);assert.equal(external.max,10);assert.equal(external.count,2);assert.equal(external.latest.date,'2026-10-01');
  assert(prices.some(g=>g.currency===''&&g.min===20));assert(prices.some(g=>g.kind==='内部资料(非对外)'&&g.min===500));
});
test('product tags and industries are normalized and bounded', () => {
  const p=validateProduct({name:'产品',tags:[' 热销 ','热销',''],industries:['食品','食品',' 电子 '],parameters:'宽度：600 mm'});
  assert.deepEqual(p.tags,['热销']);assert.deepEqual(p.industries,['食品','电子']);
  for(const field of ['tags','industries']) for(const value of ['食品',[{}],Array(21).fill('食品'),['x'.repeat(41)]]) assert.throws(()=>validateProduct({name:'产品',[field]:value}));
});
test('uploaded quote CSV preserves quoted cells and links rows to the correct source document', () => {
  assert.deepEqual(parseQuoteCsv('\uFEFF名称,规格\r\n"输送机","尺寸,可调\n材质：\"\"不锈钢\"\""\r\n'), [['名称','规格'],['输送机','尺寸,可调\n材质："不锈钢"']]);
  assert.throws(() => parseQuoteCsv('名称\n"未闭合'));
  const columns = ['设备/物料名称','型号/规格','设备品类','客户','路径','单价','币种','报价单号'];
  const upload = { format:'csv', filename:'客户历史.csv', content:columns.join(',')+'\n测试输送机,M1,输送机,测试客户,同一文件,0,USD,Q1\n测试输送机,M1,输送机,测试客户,同一文件,10,USD,Q2' };
  const source = uploadedQuoteSource(upload, prepareSource(kb));
  assert.equal(source.rows.length,2); assert.equal(source.docs.length,2); assert.equal(source.rows[0].unitPrice,0);
  assert.equal(source.rows[0].documentIds.length,1); assert.equal(source.rows[1].documentIds.length,1);
  assert.notEqual(source.rows[0].documentIds[0],source.rows[1].documentIds[0]);
  for (const content of [upload.content.replace(',0,USD,',',bad,USD,'),upload.content.replace(',0,USD,',',0,,')]) assert.throws(()=>uploadedQuoteSource({...upload,content},prepareSource(kb)));
  assert.throws(()=>uploadedQuoteSource({format:'json',content:'{"rows":[{}]}'},prepareSource(kb)));
});
test('JSON catalog rollback journal restores all collections after partial failure',async()=>{
  const memory={'products.json':[{id:'old'}],'product-history.json':[]};let writes=0,fail=true;
  const read=async(file,fallback)=>structuredClone(memory[path.basename(file)]??fallback);
  const write=async(file,data)=>{if(path.basename(file)==='product-history.json'&&fail){fail=false;throw Error('disk failure');}memory[path.basename(file)]=structuredClone(data);writes++;};
  const store=createCatalogStore({dataDir:'/unused',read,write,jsonRead:read,jsonWrite:async(file,data)=>{memory[path.basename(file)]=structuredClone(data);},dal:{},mode:()=> 'json'});
  await assert.rejects(store.commit({products:[{id:'new'}],'product-history':[{id:'history'}]}));
  assert.deepEqual(memory['products.json'],[{id:'old'}]);assert.deepEqual(memory['product-history.json'],[]);assert.equal(memory['catalog-write-journal.json'].active,false);assert(writes>=3);
  memory['catalog-write-journal.json']={active:true,originals:{products:[{id:'recovered'}]}};
  await store.recover();assert.deepEqual(memory['products.json'],[{id:'recovered'}]);
});

test('category artwork uses generated defaults and managers can replace or restore it',async()=>{
  const data={products:[
    {id:'roller',name:'滚筒产品',category:'输送机-滚筒',attachments:[{type:'image',url:'/uploads/product-photo.png'}]},
    {id:'parts',name:'配件产品',category:'配件-轴承/齿轮/电机',attachments:[]},
  ],'product-history':[],'product-category-settings':[],clients:[]};
  const read=async base=>structuredClone(data[base]||[]),commit=async collections=>{for(const [base,rows]of Object.entries(collections))data[base]=structuredClone(rows);};
  const route=createCatalogRoutes({root,read,write:async(base,rows)=>{data[base]=structuredClone(rows);},commit,body:async()=>input,send:(res,status,value)=>{res.status=status;res.value=value;},audit:()=>{}});
  let input=null;
  const call=async(path,method,user,body)=>{input=body;const res={setHeader(){}};try{await route({},res,new URL('http://local'+path),path,method,user);return {status:res.status,value:res.value};}catch(error){return {status:error.status||500,value:{error:error.message}};}};
  const admin={id:'admin',name:'Admin',role:'admin'},sales={id:'sales',name:'Sales',role:'sales'};
  const catalog=await call('/api/products/catalog','GET',sales);
  assert.equal(catalog.value.categories.find(row=>row.name==='输送机-滚筒').image,'/category-images/roller-conveyor.png');
  assert.equal(catalog.value.categories.find(row=>row.name==='输送机-滚筒').customImage,false);
  assert.notEqual(catalog.value.categories.find(row=>row.name==='输送机-滚筒').image,'/uploads/product-photo.png');
  assert.equal(catalog.value.categories.find(row=>row.name==='配件-轴承/齿轮/电机').image,'/category-images/mechanical-parts.png');
  assert.equal((await call('/api/products/category-images','PUT',sales,{category:'输送机-滚筒',image:'/uploads/custom.png'})).status,403);
  assert.equal((await call('/api/products/category-images','PUT',admin,{category:'输送机-滚筒',image:'javascript:alert(1)'})).status,400);
  assert.equal((await call('/api/products/category-images','PUT',admin,{category:'输送机-滚筒',image:'/uploads/custom.png'})).status,200);
  const replaced=await call('/api/products/catalog','GET',sales);
  assert.equal(replaced.value.categories.find(row=>row.name==='输送机-滚筒').image,'/uploads/custom.png');
  await call('/api/products/category-images','PUT',admin,{category:'输送机-滚筒',image:''});
  const restored=await call('/api/products/catalog','GET',admin);
  assert.equal(restored.value.categories.find(row=>row.name==='输送机-滚筒').image,'/category-images/roller-conveyor.png');
  assert.equal(data['product-category-settings'].length,1);
});

test('catalog API: import idempotence, permissions, review, merge and immutable quotation snapshots',{timeout:120000},async t=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'ftw-catalog-'));
  const importDir=path.join(data,'isolated-import');await fs.mkdir(importDir);await fs.writeFile(path.join(importDir,'quote-knowledge.json'),JSON.stringify(kb));
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const password=crypto.randomUUID();const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,FTW_DATA_DIR:data,FTW_IMPORT_SOURCE_DIR:importDir,FTW_STORAGE:'json',PORT:String(port),FTW_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}await fs.rm(data,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+port;
  for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const request=async(p,user,method='GET',body)=>fetch(base+p,{method,headers:{...(user?{Authorization:'Bearer '+user.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const json=async(p,user,method,body)=>{const response=await request(p,user,method,body);const result=await response.json();assert(response.ok,JSON.stringify(result));return result;};
  const admin=await json('/api/login',null,'POST',{username:'admin',password});
  await json('/api/users',admin,'POST',{username:'sales',password,role:'sales'});
  const sales=await json('/api/login',null,'POST',{username:'sales',password});
  assert.equal((await request('/api/products/history')).status,401);
  assert.equal((await request('/api/products/import-preview',sales)).status,403);
  const preview=await json('/api/products/import-preview',admin);
  assert.equal((await request('/api/products/import-history',admin,'POST',{batchId:'stale'})).status,409);
  const imported=await json('/api/products/import-history',admin,'POST',{batchId:preview.batchId});assert(imported.imported);
  const again=await json('/api/products/import-history',admin,'POST',{batchId:preview.batchId});assert.equal(again.imported,false);
  assert.equal((await json('/api/products/catalog',admin)).total,preview.counts.created);
  const allHistory=JSON.parse(await fs.readFile(path.join(data,'product-history.json'),'utf8'));assert.equal(allHistory.length,fixtureRows.length);
  assert.equal((await json('/api/products/history',sales)).total,0);
  const initialSalesCatalog = await json('/api/products/catalog',sales);assert(initialSalesCatalog.items.every(p=>p.prices.length===0));
  const saleLine=allHistory.find(r=>r.kind==='客户对外报价'&&r.disposition==='linked'&&r.clientName&&r.unitPrice!=null&&r.unitPrice>=0&&r.currency);
  await json('/api/clients',sales,'POST',{company:saleLine.clientName});
  const ownHistory=await json('/api/products/history?pageSize=100',sales);assert(ownHistory.total>0);assert(ownHistory.items.every(r=>r.clientName===saleLine.clientName&&r.kind!=='内部资料(非对外)'&&!('sourceValues'in r)));
  assert.equal((await request('/api/products/bulk',sales,'POST',{ids:[saleLine.productId],patch:{status:'在用'}})).status,403);
  const p=await json('/api/products/'+saleLine.productId+'/detail',admin);
  const priceQuery='/api/products/catalog?q='+encodeURIComponent(p.product.code);
  const managerPriceProduct=(await json(priceQuery,admin)).items.find(p=>p.id===saleLine.productId);assert.deepEqual(managerPriceProduct.prices,p.prices);
  const salesPriceProduct=(await json(priceQuery,sales)).items.find(p=>p.id===saleLine.productId);
  const expectedPrices=priceGroups(allHistory.filter(r=>r.productId===saleLine.productId&&r.clientName===saleLine.clientName&&r.kind!=='内部资料(非对外)'));
  assert.deepEqual(salesPriceProduct.prices,expectedPrices);assert(salesPriceProduct.prices.length>0);assert(!salesPriceProduct.prices.some(g=>g.kind==='内部资料(非对外)'));
  const visibleProductRows=allHistory.filter(r=>r.productId===saleLine.productId&&r.clientName===saleLine.clientName&&r.kind!=='内部资料(非对外)');
  assert.equal(salesPriceProduct.historyCount,visibleProductRows.length);
  const salesDetail=await json('/api/products/'+saleLine.productId+'/detail',sales);
  assert(salesDetail.relatedClients.length);assert(salesDetail.relatedClients.every(c=>c.name===saleLine.clientName));
  assert.equal(salesDetail.relatedClients.reduce((n,c)=>n+c.count,0),visibleProductRows.length);
  assert.equal((await json('/api/products/catalog?priceMode=history',sales)).total>0,true);
  const catalogAll=await json('/api/products/catalog',admin),productData=await json('/api/products',admin);
  assert.equal(catalogAll.categories.length,catalogAll.stats.categories);
  for(const category of catalogAll.categories) assert.equal(category.count,productData.filter(p=>p.category===category.name&&!p.mergedInto).length);
  const rollerCategory=catalogAll.categories.find(category=>/滚筒/.test(category.name));
  const partsCategory=catalogAll.categories.find(category=>/配件.*(?:轴承|齿轮|电机)/.test(category.name));
  if(rollerCategory) assert.equal(rollerCategory.image,'/category-images/roller-conveyor.png');
  if(partsCategory) assert.equal(partsCategory.image,'/category-images/mechanical-parts.png');
  assert.equal((await request('/api/products/category-images',sales,'PUT',{category:'测试分类',image:'/category-images/roller-conveyor.png'})).status,403);
  const fixture=await json('/api/products',admin,'POST',{name:'过滤参数专用',category:'测试分类',unit:'SET',price:'42',currency:'USD',parameters:'输送宽度：321 mm',industries:['食品'],tags:['推荐']});
  const categoryUpload=await json('/api/upload',admin,'POST',{filename:'category-test.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/mRkAAAAASUVORK5CYII='});
  await json('/api/products/category-images',admin,'PUT',{category:'测试分类',image:categoryUpload.url});
  const categoryImageForSales=(await json('/api/products/catalog?q='+encodeURIComponent(fixture.name),sales)).categories.find(category=>category.name==='测试分类');
  assert.equal(categoryImageForSales.image,categoryUpload.url);assert.equal(categoryImageForSales.customImage,true);
  assert.equal((await request(categoryUpload.url,sales)).status,200);
  assert.equal((await request('/api/products/category-images',admin,'PUT',{category:'测试分类',image:'javascript:alert(1)'})).status,400);
  await json('/api/products/category-images',admin,'PUT',{category:'测试分类',image:''});
  const restoredCategory=(await json('/api/products/catalog?q='+encodeURIComponent(fixture.name),admin)).categories.find(category=>category.name==='测试分类');
  assert.equal(restoredCategory.image,'');assert.equal(restoredCategory.customImage,false);
  assert.equal(JSON.parse(await fs.readFile(path.join(data,'product-category-settings.json'),'utf8')).filter(item=>item.category==='测试分类').length,1);
  for(const query of ['industry=食品','unit=SET&industry=食品','priceMode=manual&industry=食品','q=321%20mm','q=推荐']) {
    const found=await json('/api/products/catalog?'+query,admin);assert(found.items.some(p=>p.id===fixture.id),query);
  }
  assert(!(await json('/api/products/catalog?priceMode=missing&industry=食品',admin)).items.some(p=>p.id===fixture.id));
  assert(!(await json('/api/products/catalog?priceMode=history&industry=食品',admin)).items.some(p=>p.id===fixture.id));
  await json('/api/products/'+fixture.id,admin,'PUT',{price:''});
  assert((await json('/api/products/catalog?priceMode=missing&industry=食品',admin)).items.some(p=>p.id===fixture.id));
  const quote=await json('/api/quotations',sales,'POST',{clientName:saleLine.clientName,currency:saleLine.currency,items:[{name:p.product.name,description:saleLine.model,qty:1,unit:saleLine.unit,unitPrice:saleLine.unitPrice,productId:saleLine.productId,sourceHistoryId:saleLine.id}]});
  assert.equal(quote.items[0].productSnapshot.name,p.product.name);
  const before=structuredClone(quote.items[0].productSnapshot);
  await json('/api/products/'+saleLine.productId,admin,'PUT',{name:'Changed after quoting',expectedUpdatedAt:p.product.updatedAt});
  const saved=await json('/api/quotations/'+quote.id,sales,'PUT',{items:quote.items,currency:quote.currency,status:'已发送',baseVersion:quote.version});
  assert.deepEqual(saved.items[0].productSnapshot,before);assert.equal(saved.version,quote.version);
  assert.equal((await request('/api/quotations',sales,'POST',{clientName:saleLine.clientName,currency:'WRONG',items:quote.items})).status,400);
  const foreign=allHistory.find(r=>r.productId&&r.clientName!==saleLine.clientName&&r.unitPrice!=null&&r.currency);
  assert.equal((await request('/api/quotations',sales,'POST',{currency:foreign.currency,items:[{productId:foreign.productId,sourceHistoryId:foreign.id,name:'x',unitPrice:foreign.unitPrice}]})).status,403);
  const review=allHistory.find(r=>r.disposition==='review');
  await json('/api/products/review/'+review.id,admin,'POST',{action:'link',productId:saleLine.productId});
  const duplicate=await json('/api/products',admin,'POST',{name:'Duplicate',unit:'SET'});
  await json('/api/products/merge',admin,'POST',{keepId:duplicate.id,removeIds:[saleLine.productId]});
  const afterMerge=await json('/api/quotations',sales);assert.deepEqual(afterMerge.find(q=>q.id===quote.id).items[0].productSnapshot,before);
  const original=await json('/api/products/'+saleLine.productId+'/detail',admin);assert.equal(original.product.mergedInto,duplicate.id);
  assert.equal((await request('/api/products/'+saleLine.productId,admin,'PUT',{name:'Cannot edit merged'})).status,409);
  const retire=await json('/api/products/'+duplicate.id,admin,'DELETE');assert.equal(retire.status,'停用');
  const endPreview=await json('/api/products/import-preview',admin);assert.equal(endPreview.counts.alreadyImported,fixtureRows.length);
  const beforeUploadCount = (await json('/api/products/catalog',admin)).total;
  const upload = {format:'csv',filename:'上传验证.csv',content:'设备/物料名称,型号/规格,设备品类,客户,路径,单价,币种,报价单号\n上传验证输送机,M1,输送机,上传客户,上传来源.csv,0,USD,Q1'};
  assert.equal((await request('/api/products/import-preview',sales,'POST',upload)).status,403);
  assert.equal((await request('/api/products/imports',sales)).status,403);
  assert.equal((await request('/api/products/import-preview',admin,'POST',{...upload,content:'错误表头\nx'})).status,400);
  const uploadedPreview = await json('/api/products/import-preview',admin,'POST',upload);
  assert.equal(uploadedPreview.counts.created,1); assert.equal(uploadedPreview.documents,1);
  assert.equal((await json('/api/products/catalog',admin)).total,beforeUploadCount);
  assert.equal((await request('/api/products/import-history',admin,'POST',{batchId:uploadedPreview.batchId,upload:{...upload,content:upload.content.replace('M1','M2')}})).status,409);
  assert.equal((await json('/api/products/catalog',admin)).total,beforeUploadCount);
  await json('/api/products/import-history',admin,'POST',{batchId:uploadedPreview.batchId,upload});
  assert.equal((await json('/api/products/catalog',admin)).total,beforeUploadCount+1);
  assert.equal((await json('/api/products/import-history',admin,'POST',{batchId:uploadedPreview.batchId,upload})).imported,false);
  const uploadedLine = (await json('/api/products/history?q=上传验证输送机',admin)).items[0]; assert.equal(uploadedLine.unitPrice,0); assert(uploadedLine.productId);
  const uploadedProduct=(await json('/api/products/catalog?q=上传验证输送机',admin)).items[0];assert.equal(uploadedProduct.prices[0].min,0);assert.equal(uploadedProduct.prices[0].unit,'');assert.equal(uploadedProduct.price,null);
  const batches = await json('/api/products/imports',admin); assert.equal(batches.length,2); assert.equal(batches[0].filename,upload.filename); assert(!('sourceColumns' in batches[0]));
  const sameJson = await json('/api/products/import-preview',admin,'POST',{format:'json',filename:'知识库.json',content:JSON.stringify(kb)}); assert.equal(sameJson.counts.alreadyImported,fixtureRows.length);

});


test('MySQL catalog commits grouped writes together and rolls back partial imports',async()=>{
 const calls=[];const connection={beginTransaction:async()=>calls.push('begin'),query:async(sql,args)=>{calls.push([sql,args]);},commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')};
 await commitCatalog({products:Array.from({length:205},(_,i)=>({id:String(i),name:'x'}))},connection);
 assert.equal(calls.filter(x=>Array.isArray(x)&&x[0].startsWith('INSERT')).length,3);assert.deepEqual(calls.slice(-2),['commit','release']);
 calls.length=0;await commitCatalog({'product-category-settings':[{id:'category',category:'输送机-滚筒',image:'/category-images/roller-conveyor.png'}]},connection);
 assert(calls.some(x=>Array.isArray(x)&&x[0].includes('`product_category_settings`')));assert.deepEqual(calls.slice(-2),['commit','release']);
 calls.length=0;connection.query=async(sql)=>{calls.push(sql);if(sql.includes('product_history'))throw Error('connection failure');};
 await assert.rejects(commitCatalog({products:[{id:'x'}],'product-history':[{id:'y'}]},connection));
 assert(!calls.includes('commit'));assert.deepEqual(calls.slice(-2),['rollback','release']);
});
