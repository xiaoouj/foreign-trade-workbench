// Explicit inquiry -> quotation -> order links. Never infer a project from customer name alone.
const normalizeName=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function sameCustomer(a,b){
 if(a.clientId&&b.clientId)return String(a.clientId)===String(b.clientId);
 const name=normalizeName(a.clientName);return !!name&&name===normalizeName(b.clientName);
}
export const confirmedOrder=o=>['已确认','生产中','已发货','已收款','已完成'].includes(o.status);
const ranks={'新询盘':0,'已报价':1,'等回复':2,'谈判中':3,'成交':4};
export function linkedBusiness(inquiry,quotes,orders){
 const linkedQuotes=quotes.filter(q=>q.inquiryId===inquiry.id&&sameCustomer(q,inquiry));
 const ids=new Set(linkedQuotes.map(q=>q.id));
 return {quotes:linkedQuotes,orders:orders.filter(o=>sameCustomer(o,inquiry)&&(o.inquiryId===inquiry.id||(!o.inquiryId&&ids.has(o.quoteId))))};
}
function orderWonAt(o,now){
 if(/^\d{4}-\d{2}-\d{2}$/.test(o.orderDate||'')){const ms=Date.parse(o.orderDate+'T00:00:00+08:00');if(Number.isFinite(ms)&&new Date(ms+8*3600000).toISOString().slice(0,10)===o.orderDate)return ms;}
 const n=Number(o.createdAt);return Number.isFinite(n)&&n>0?n:now;
}
export function reconcileInquiries(inquiries,quotes,orders,{now=Date.now(),actor='系统联动',canAccess=()=>true}={}){
 const changed=[];
 const result=inquiries.map(inquiry=>{
  if(!canAccess(inquiry))return inquiry;
  const status=inquiry.status||'新询盘';if(!(status in ranks)||status==='成交')return inquiry;
  const linked=linkedBusiness(inquiry,quotes.filter(canAccess),orders.filter(canAccess));
  let target='',source='',wonAt;
  const confirmed=linked.orders.filter(confirmedOrder).sort((a,b)=>orderWonAt(a,now)-orderWonAt(b,now))[0];
  if(confirmed){target='成交';source='订单 '+(confirmed.orderNo||confirmed.id)+' 已确认';wonAt=orderWonAt(confirmed,now);}
  else if(linked.quotes.some(q=>q.status==='客户确认')){target='谈判中';source='关联报价已获客户确认，等待订单确认';}
  else if(linked.quotes.some(q=>q.status==='已发送')){target='等回复';source='关联报价已发送';}
  else if(linked.quotes.some(q=>['草稿','已转订单'].includes(q.status||'草稿'))||linked.orders.some(o=>o.status==='待确认')){target='已报价';source='已建立关联报价或待确认订单';}
  if(!target||ranks[target]<=ranks[status])return inquiry;
  const next={...inquiry,status:target,updatedAt:now,lastStageReason:source,stageLog:[...(Array.isArray(inquiry.stageLog)?inquiry.stageLog:[]),{from:status,to:target,reason:source,at:now,by:actor,automatic:true}]};
  if(target==='成交')next.wonAt=inquiry.wonAt||wonAt;
  changed.push({id:inquiry.id,from:status,to:target});return next;
 });
 return {inquiries:result,changed};
}

// A quotation without an explicit source starts its own opportunity, even if this customer has other projects.
export function provisionQuoteInquiry(quote,inquiries,{now=Date.now(),id,actor='系统联动'}={}){
 if(quote.inquiryId){
  const owned=inquiries.find(i=>i.id===quote.inquiryId&&i.originQuoteId===quote.id&&sameCustomer(i,quote));
  if(owned){owned.expectedAmount=Math.round((quote.items||[]).reduce((sum,it)=>sum+(Number(it.qty)||0)*(Number(it.unitPrice)||0),0)*100)/100;owned.currency=quote.currency||'USD';owned.owner=quote.owner;owned.ownerName=quote.ownerName||'';owned.updatedAt=now;}
  return {created:null,reused:false};
 }
 if(!String(quote.clientName||'').trim())return {created:null,reused:false};
 const existing=inquiries.find(i=>i.originQuoteId===quote.id&&sameCustomer(i,quote));
 if(existing){quote.inquiryId=existing.id;return {created:null,reused:true};}
 const product=String(quote.projectName||'').trim()||[...new Set((quote.items||[]).map(it=>String(it.name||'').trim()).filter(Boolean))].join('、')||'报价项目';
 const amount=(quote.items||[]).reduce((sum,it)=>sum+(Number(it.qty)||0)*(Number(it.unitPrice)||0),0);
 const status=quote.status==='客户拒绝'?'输单':quote.status==='已过期'?'暂缓':'已报价';
 const createdAt=Number(quote.createdAt)>0?Number(quote.createdAt):now;
 const receivedAt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(createdAt));
 const reason='由报价 '+(quote.quoteNo||quote.id)+' 自动建立商机';
 const created={id,originQuoteId:quote.id,clientName:quote.clientName,clientId:quote.clientId||null,contactName:quote.contactName||'',country:quote.country||'',contactEmail:quote.contactEmail||'',contactPhone:quote.contactPhone||'',product,model:(quote.items||[]).map(it=>it.description||'').filter(Boolean).join('\n'),expectedAmount:Math.round(amount*100)/100,currency:quote.currency||'USD',owner:quote.owner,ownerName:quote.ownerName||'',source:quote.source&&quote.source!=='报价建档'?quote.source:'阿里巴巴',receivedAt,status,createdAt:now,updatedAt:now,notes:reason,stageLog:[{from:'',to:status,reason,at:now,by:actor,automatic:true}],lastStageReason:reason};
 quote.inquiryId=id;return {created,reused:false};
}
