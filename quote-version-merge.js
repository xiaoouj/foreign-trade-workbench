import {quoteNumberKey,quoteContentKey} from './sales-records.js';
import {sameCustomer,reconcileInquiries} from './inquiry-link.js';
const at=value=>{const n=Number(value);if(n>0)return n;const d=Date.parse(value);return Number.isFinite(d)?d:0;};
const version=q=>Math.max(1,Number(q.version)||1);
const contentAt=q=>Array.isArray(q.revisionHistory)&&q.revisionHistory.length?Math.max(...q.revisionHistory.map(n=>at(n.at))):at(q.updatedAt||q.createdAt);
const snapshot=q=>{const {id,owner,ownerName,revisionHistory,createdAt,updatedAt,inquiryId,orderId,version,originQuoteId,...body}=q;return body;};
export function mergeQuoteVersions(quotes,inquiries,orders,{now=Date.now(),related={}}={}){
 const workingQuotes=structuredClone(quotes),workingInqs=structuredClone(inquiries),workingOrders=structuredClone(orders),groups=new Map(),merged=[],skipped=[];
 for(const q of workingQuotes){const key=quoteNumberKey(q.quoteNo);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(q);}
 const removedQuotes=new Set(),removedInqs=new Set(),quoteMap=new Map(),inqMap=new Map();
 for(const [key,group] of groups){
  if(group.length<2)continue;
  if(!group.every(q=>sameCustomer(group[0],q)&&q.owner===group[0].owner)){skipped.push({quoteNo:key,reason:'客户或负责人不同'});continue;}
  group.sort((a,b)=>at(a.createdAt)-at(b.createdAt)||a.id.localeCompare(b.id));const keeper=group[0],quoteIds=new Set(group.map(q=>q.id));
  const sourceIds=[...new Set(group.map(q=>q.inquiryId).filter(Boolean))],sourceInqs=workingInqs.filter(i=>sourceIds.includes(i.id));
  if(sourceInqs.length>1&&sourceInqs.some(i=>['输单','暂缓','无效'].includes(i.status))){skipped.push({quoteNo:key,reason:'商机存在关闭状态，需核对'});continue;}
  if(sourceInqs.length>1&&sourceInqs.some(i=>!quoteIds.has(i.originQuoteId))){skipped.push({quoteNo:key,reason:'关联了多条手工询盘，需核对项目'});continue;}
  if(sourceInqs.length>1&&sourceInqs.some(i=>workingQuotes.some(q=>q.inquiryId===i.id&&!quoteIds.has(q.id))||workingOrders.some(o=>o.inquiryId===i.id&&!quoteIds.has(o.quoteId)))){skipped.push({quoteNo:key,reason:'商机已有其他业务关联'});continue;}
  const latest=group.slice().sort((a,b)=>contentAt(b)-contentAt(a)||b.id.localeCompare(a.id))[0];
  const nodes=group.flatMap(q=>{
   const h=Array.isArray(q.revisionHistory)&&q.revisionHistory.length?q.revisionHistory:[{version:version(q),kind:'baseline',at:q.updatedAt||q.createdAt,userName:q.ownerName||'历史记录',changes:['合并前报价快照；此前详细修改记录不可恢复'],snapshot:snapshot(q)}];
   return h.map(node=>({...node,sourceRecordId:q.id,sourceVersion:node.version}));
  }).sort((a,b)=>at(a.at)-at(b.at)||group.findIndex(q=>q.id===a.sourceRecordId)-group.findIndex(q=>q.id===b.sourceRecordId));
  const history=[];
  for(const node of nodes){if(history.length&&quoteContentKey(history[history.length-1].snapshot||{})===quoteContentKey(node.snapshot||{}))continue;history.push(node);}
  if(!history.length||quoteContentKey(history[history.length-1].snapshot||{})!==quoteContentKey(latest))history.push({kind:'modified',at:latest.updatedAt||now,userName:latest.ownerName||'历史记录',changes:['合并前最新报价内容'],snapshot:snapshot(latest),sourceRecordId:latest.id,sourceVersion:version(latest)});
  const base=Math.max(1,...group.map(q=>version(q)-Math.max(1,Array.isArray(q.revisionHistory)?q.revisionHistory.length:1)+1));
  history.forEach((node,index)=>{node.version=base+index;if(index&&node.kind==='created'){node.kind='modified';node.changes=['导入同编号报价'];}});
  const keeperInquiry=sourceInqs.find(i=>i.id===keeper.inquiryId)||sourceInqs[0];
  const mergedRecord={...latest,id:keeper.id,quoteNo:keeper.quoteNo,owner:keeper.owner,ownerName:keeper.ownerName,createdAt:keeper.createdAt,updatedAt:now,version:Math.max(...group.map(version),history.at(-1).version),revisionHistory:history,status:latest.status==='草稿'&&keeper.status&&keeper.status!=='草稿'?keeper.status:latest.status,inquiryId:keeperInquiry?.id||keeper.inquiryId||latest.inquiryId||null,orderId:keeper.orderId||latest.orderId||null};
  Object.assign(keeper,mergedRecord);
  for(const q of group.slice(1)){removedQuotes.add(q.id);quoteMap.set(q.id,keeper.id);}
  for(const o of workingOrders)if(quoteIds.has(o.quoteId)){o.quoteId=keeper.id;if(keeperInquiry&&sourceIds.includes(o.inquiryId))o.inquiryId=keeperInquiry.id;}
  if(keeperInquiry){
   if(quoteIds.has(keeperInquiry.originQuoteId)){keeperInquiry.originQuoteId=keeper.id;keeperInquiry.expectedAmount=(keeper.items||[]).reduce((n,it)=>n+(Number(it.qty)||0)*(Number(it.unitPrice)||0),0);keeperInquiry.currency=keeper.currency||'USD';}
   for(const i of sourceInqs){if(i.id===keeperInquiry.id)continue;keeperInquiry.notes=[keeperInquiry.notes,i.notes].filter(Boolean).join('\n');keeperInquiry.stageLog=[...(Array.isArray(keeperInquiry.stageLog)?keeperInquiry.stageLog:[]),...(Array.isArray(i.stageLog)?i.stageLog:[])].sort((a,b)=>at(a.at)-at(b.at));keeperInquiry.followLog=[...new Map([...(keeperInquiry.followLog||[]),...(i.followLog||[])].map(entry=>[entry.id||JSON.stringify(entry),entry])).values()].sort((a,b)=>at(a.at)-at(b.at));if(i.status==='成交')keeperInquiry.status='成交';if(i.wonAt)keeperInquiry.wonAt=keeperInquiry.wonAt||i.wonAt;removedInqs.add(i.id);inqMap.set(i.id,keeperInquiry.id);}
  }
  merged.push({quoteNo:key,keptId:keeper.id,removedIds:group.slice(1).map(q=>q.id),removedInquiryIds:sourceInqs.filter(i=>removedInqs.has(i.id)).map(i=>i.id)});
 }
 const finalQuotes=workingQuotes.filter(q=>!removedQuotes.has(q.id)),finalInqs=workingInqs.filter(i=>!removedInqs.has(i.id));
 const synced=reconcileInquiries(finalInqs,finalQuotes,workingOrders,{now,actor:'重复报价版本合并'});
 const migratedRelated=structuredClone(related);for(const rows of Object.values(migratedRelated))for(const row of rows){for(const key of ['quoteId','quotationId'])if(quoteMap.has(row[key]))row[key]=quoteMap.get(row[key]);if(inqMap.has(row.inquiryId))row.inquiryId=inqMap.get(row.inquiryId);if(row.relatedKind==='inquiry'&&inqMap.has(row.relatedId)){row.relatedId=inqMap.get(row.relatedId);if(row.related)row.related='inquiry:'+row.relatedId;}}
 return {quotations:finalQuotes,inquiries:synced.inquiries,orders:workingOrders,related:migratedRelated,merged,skipped};
}
