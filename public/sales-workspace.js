// Live views built from the approved quotation/order prototype. All writes use owned CRM APIs.
(function(){
'use strict';
const boards={},feedback={quotes:'pending',orders:'pending'};
window.crmSalesRender=key=>{if(boards[key])boards[key].render()};
window.crmSalesFeedback=(key,status)=>{feedback[key]=status;boards[key]?.render()};
window.crmSalesOpen=(kind,id)=>boards[kind]?.open(id);
document.addEventListener('DOMContentLoaded',()=>{
 for(const kind of ['quotes','orders'])mount(kind);
});
function mount(kind){
 const quotePage=kind==='quotes',root=document.getElementById('live-sales-'+kind),prefix=quotePage?'qsw-':'osw-',CP=window.CRMPrototype;if(!root)return;
 const esc=CP.h,ic=CP.ic,$=selector=>root.querySelector(selector.replace(/#([\w-]+)/g,(_,id)=>'#'+(id.startsWith(prefix)||['qtBody','orderBody'].includes(id)?id:prefix+id)));
 const ftwToast=toast,ftwPlace=CP.place;
 let data={quotes:[],orders:[]},today=CP.today(),actor='',currentId=null,returnFocus=null;
 const state={query:'',owner:'',cur:'',filter:'',stage:'',extra:'',country:'',sort:'date:desc',view:'table',per:20,page:1,selected:new Set(),mode:'ok'};
 const mq=matchMedia('(max-width:820px)'),qStages=['草稿','已发送','客户确认','已转订单','客户拒绝','已过期'],oStages=[...FTWOrderWorkflow.statuses],get=id=>rows().find(r=>r.id===id),rows=()=>quotePage?data.quotes:data.orders;
 const money=(n,cur='CNY',dec=2)=>n==null?'待核对':String(cur)+' '+Number(n).toLocaleString('zh-CN',{minimumFractionDigits:dec,maximumFractionDigits:dec}),w=n=>Math.abs(n)>=1e4?(n/1e4).toFixed(1)+'万':Math.round(n||0).toLocaleString('zh-CN');
 const days=date=>date?CP.dd(today,date):null,cny=r=>CP.cny(quotePage?r.total:r.amount,r.cur),deal=o=>FTWOrderWorkflow.isDeal(o.raw),done=o=>['已发货','已完成','已取消'].includes(o.status),pay=o=>FTWOrderWorkflow.payment(o.raw).received,due=o=>!done(o)&&o.deliveryDate&&days(o.deliveryDate)<0,exp=q=>!['客户确认','已转订单','客户拒绝'].includes(q.status)&&q.validUntil&&days(q.validUntil)<0;
 const columns=quotePage?[['doc','报价号 / 客户'],['status','状态 / 版本'],['project','项目'],['amount','报价金额'],['valid','有效期'],['owner','负责人'],['date','创建日期']]:[['doc','订单号 / 客户'],['status','履约阶段'],['amount','订单金额'],['payment','收款情况'],['progress','生产进度'],['due','交期'],['owner','负责人'],['date','下单日期']];
 const visible={has:()=>true};let stages=quotePage?qStages:oStages;
 function colKey(key){return (quotePage?{doc:'quoteNo',status:'status',project:'projectName',amount:'amount',valid:'validUntil',owner:'owner',date:'createdAt'}:{doc:'c1',status:'c6',amount:'c4',payment:'payment',progress:'progress',due:'c8',owner:'owner',date:'c7'})[key]||key;}
 function ownerId(r){return r.owner?String(r.owner):r.ownerName?'legacy:'+CP.key(r.ownerName):'__unassigned__'}
 let countryNames;
 function countryLabel(value){
  const text=String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');if(!text)return '';
  if(!countryNames){
   countryNames=new Map();const formats=['zh-CN','en'].map(locale=>new Intl.DisplayNames([locale],{type:'region'})),zh=formats[0];
   for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),label=zh.of(code);if(label===code)continue;formats.forEach(format=>{const name=format.of(code);if(name!==code)countryNames.set(name.toLowerCase(),label)});countryNames.set(code.toLowerCase(),label)}
   const alias={'阿联酋':['AE','阿拉伯联合酋长国','united arab emirates','uae','u.a.e.','dubai'],'美国':['usa','u.s.a.','us','united states of america','america'],'英国':['uk','u.k.','great britain','england','united kingdom'],'韩国':['korea','south korea','republic of korea','korea, republic of'],'俄罗斯':['russia','russian federation'],'土耳其':['turkey','türkiye','turkiye'],'捷克':['czech republic','czechia'],'越南':['vietnam','viet nam'],'缅甸':['burma'],'科特迪瓦':['ivory coast'],'荷兰':['holland','the netherlands'],'中国香港':['hong kong','香港'],'中国台湾':['taiwan','台湾'],'中国澳门':['macau','macao','澳门']};
   for(const [label,names] of Object.entries(alias))for(const name of names)countryNames.set(name.toLowerCase(),label);
   countryNames.set('阿联酋','阿联酋');
  }
  return countryNames.get(text.toLowerCase())||text;
 }
 let clientCountries={byId:new Map(),byName:new Map()};
 function indexClientCountries(){const byId=new Map(),byName=new Map();for(const c of CP.allClients()){const country=String(c.country||'').trim();if(!country)continue;if(c.id)byId.set(String(c.id),country);const name=CP.key(c.company);if(name&&!byName.has(name))byName.set(name,country)}clientCountries={byId,byName}}
 function countryOf(r,clientFirst){const own=String(r.country||'').trim(),linked=clientCountries.byId.get(String(r.clientId||''))||clientCountries.byName.get(CP.key(r.clientName))||'';return countryLabel(clientFirst?linked||own:own||linked)}
 function canonicalCountries(list){const counts=new Map();for(const r of list){const key=CP.key(r.country);if(!key)continue;const labels=counts.get(key)||new Map();labels.set(r.country,(labels.get(r.country)||0)+1);counts.set(key,labels)}const names=new Map([...counts].map(([key,labels])=>[key,[...labels].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1))[0][0]]));for(const r of list)if(r.country)r.country=names.get(CP.key(r.country))||r.country}
 function qDTO(q){const history=CP.logs(q.revisionHistory).map(h=>({version:h.version,date:CP.day(h.at),actor:h.userName||'',text:(h.changes||[]).join('、'),total:qtTotal(h.snapshot?.items),raw:h}));let linked=CP.allOrders().find(o=>o.id===q.orderId||o.quoteId===q.id);
  return {raw:q,id:q.id,no:q.quoteNo||'未填写',client:q.clientName||'未填写客户',country:countryOf(q,true),countryRaw:String(q.country||'')+' '+(clientCountries.byId.get(String(q.clientId||''))||clientCountries.byName.get(CP.key(q.clientName))||''),project:q.projectName||'',contact:q.contactName||'',owner:CP.ownerLabel(q),oid:ownerId(q),status:q.status||'草稿',cur:q.currency||'USD',total:qtTotal(q.items),createdStamp:typeof q.createdAt==='number'||/^\d+$/.test(String(q.createdAt))?Number(q.createdAt):Date.parse(q.createdAt)||0,created:CP.day(q.createdAt),validUntil:CP.day(q.validUntil),delivery:q.deliveryDays,deposit:q.depositPercent,payment:q.paymentTerms||'',tradeTerms:q.tradeTerms||'',notes:q.notes||'',items:Array.isArray(q.items)?q.items:[],version:Math.max(1,Number(q.version)||1),history,orderId:linked?.id||q.orderId||null};}
 function oDTO(o){const payment=FTWOrderWorkflow.payment(o);return {raw:o,id:o.id,no:o.orderNo||'未填写',client:o.clientName||'未填写客户',country:countryOf(o),countryRaw:String(o.country||'')+' '+(clientCountries.byId.get(String(o.clientId||''))||clientCountries.byName.get(CP.key(o.clientName))||''),project:o.projectName||normalizedOrderItems(o)[0]?.name||'',owner:CP.ownerLabel(o),oid:ownerId(o),status:FTWOrderWorkflow.collection(o).operational,cur:o.currency||'USD',amount:CP.number(o.amount),orderDate:orderSortDate(o),deliveryDate:CP.day(o.deliveryDate),paidPercent:payment.paidPercent,deposit:CP.number(o.depositPercent),progress:CP.number(o.productionProgress),quoteId:o.quoteId||null,items:normalizedOrderItems(o),notes:o.notes||'',history:[],receipts:[]};}
 function refresh(){
  today=CP.today();const id=window.__ftwNoticeUser?.id||'';
  if(actor!==id){actor=id;state.selected.clear();state.query=state.owner=state.cur=state.filter=state.stage=state.extra=state.country='';state.page=1;closeDrawer();$('#drawer').replaceChildren();$('#q').value='';}
  indexClientCountries();
  data={quotes:(window.__ftwNoticeUser?.id===currentUser?.id?(window.getAllQuotations?.()||[]):[]).map(qDTO),orders:CP.allOrders().map(oDTO)};canonicalCountries(data.quotes);canonicalCountries(data.orders);
  const owned=(quotePage?window.__crmQuoteDataOwner:window.__crmCoreDataOwner)===actor;
  state.mode=!rows().length?(feedback[kind]==='error'?'error':owned?'ok':'loading'):'ok';
  for(const id of state.selected)if(!get(id))state.selected.delete(id);
  const oldOwner=state.owner,oldCur=state.cur;const opts=[...new Map(rows().map(r=>[r.oid,r.owner])).entries()];$('#fOwner').innerHTML='<option value="">全部负责人</option>'+opts.map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');$('#fOwner').value=oldOwner;
  $('#fCur').innerHTML='<option value="">全部币种</option>'+[...new Set(rows().map(r=>r.cur))].sort().map(cur=>'<option>'+esc(cur)+'</option>').join('');$('#fCur').value=oldCur;
  const country=state.country;$('#fCountry').innerHTML='<option value="">全部国家</option>'+[...new Set(rows().map(r=>r.country).filter(Boolean))].sort().map(c=>'<option>'+esc(c)+'</option>').join('');$('#fCountry').value=country;
 }
function ownerTag(name){return '<span class="own"><i class="o'+(Math.abs([...String(name||'')].reduce((n,c)=>n+c.charCodeAt(0),0))%4+1)+'">'+esc(name?.[0]||'?')+'</i>'+esc(name||'未分配')+'</span>'}
function tag(status){const m={'草稿':'draft','已发送':'sent','客户确认':'confirmed','已转订单':'ordered','客户拒绝':'rejected','已过期':'expired','待确认':'pend','待收预付款':'confirm','生产中':'progress','待收尾款':'balance','待发货':'ready','已发货':'shipped','已完成':'finish','已取消':'cancel'};return '<span class="qs qs-'+(m[status]||'pend')+'">'+esc(status)+'</span>'}
function filterMatch(r,key){
 if(!key)return true;if(quotePage)return ({draft:r.status==='草稿',sent:r.status==='已发送',exp:exp(r),soon:r.status==='已发送'&&days(r.validUntil)>=0&&days(r.validUntil)<=7,convert:r.status==='客户确认'&&!r.orderId,won:['客户确认','已转订单'].includes(r.status),unlinked:!r.orderId})[key]||false;
 return ({installation:r.status==='已发货'&&r.raw.installationRequired,retention:r.status!=='已取消'&&FTWOrderWorkflow.collection(r.raw).retained>0,deal:deal(r)&&(dateRange().from||dateRange().to?true:r.orderDate.startsWith(today.slice(0,4))),paid:r.status!=='已取消'&&pay(r)>0,balance:r.status!=='已取消'&&pay(r)!=null&&pay(r)<r.amount,late:due(r),active:!['已取消','已完成'].includes(r.status),unknown:r.status!=='已取消'&&pay(r)==null})[key]||false;
}
function sameDayNo(a,b){const key=typeof docNoKey==='function'?docNoKey:()=>null,x=key(a.no),y=key(b.no);return x!==null&&y!==null&&x!==y?x-y:a.no.localeCompare(b.no)}
function dateRange(){return {from:$('#from')?.value||'',to:$('#to')?.value||''}}
function scoped(){const q=state.query.trim().toLowerCase(),{from,to}=dateRange();return rows().filter(r=>{const day=quotePage?r.created:r.orderDate;return (!q||[r.no,r.client,r.project,r.country,r.countryRaw,r.contact].join(' ').toLowerCase().includes(q))&&(!state.owner||r.oid===state.owner)&&(!state.cur||r.cur===state.cur)&&(!state.country||r.country===state.country)&&(!from||day&&day>=from)&&(!to||day&&day<=to)})}
function matchesStage(row, selected) {
  if (!selected) return true;
  if (!quotePage && selected === '待收尾款') return FTWOrderWorkflow.collection(row.raw).pendingBalance;
  return row.status === selected;
}
function filtered(){const list=scoped().filter(r=>matchesStage(r,state.stage)&&filterMatch(r,state.filter)&&filterMatch(r,state.extra));
 const [key,direction]=state.sort.split(':'),dir=direction==='asc'?1:-1;return list.sort((a,b)=>{let x,y;if(key==='amount'){x=cny(a);y=cny(b)}else if(key==='due'){x=quotePage?a.validUntil:a.deliveryDate;y=quotePage?b.validUntil:b.deliveryDate;if(!x&&!y)return 0;if(!x)return 1;if(!y)return -1}else if(key==='no'){x=a.no;y=b.no}else{x=quotePage?a.createdStamp:a.orderDate;y=quotePage?b.createdStamp:b.orderDate}return (x<y?-1:x>y?1:0)*dir||sameDayNo(a,b)*dir})}
function resetFilters(){Object.assign(state,{query:'',owner:'',cur:'',filter:'',stage:'',extra:'',country:'',page:1});$('#q').value='';render()}
function summary(){
 refresh();const A=rows(),R=scoped(),O=quotePage?[]:R,{from:dateFrom,to:dateTo}=dateRange(),dateOn=!!(dateFrom||dateTo),scopeOn=!!(state.query.trim()||state.owner||state.cur||state.country||dateOn),inYear=o=>dateOn||o.orderDate.slice(0,4)===today.slice(0,4);
 const outstanding=O.filter(o=>o.status!=='已取消'&&pay(o)!=null).reduce((n,o)=>n+(CP.cny(o.amount-pay(o),o.cur)||0),0);
 const received=O.filter(o=>o.status!=='已取消'&&pay(o)!=null).reduce((n,o)=>n+(CP.cny(pay(o),o.cur)||0),0);
 const receivedMissing=O.some(o=>o.status!=='已取消'&&pay(o)!=null&&CP.cny(pay(o),o.cur)==null),balanceMissing=O.some(o=>o.status!=='已取消'&&pay(o)!=null&&CP.cny(o.amount-pay(o),o.cur)==null),dealMissing=O.some(o=>deal(o)&&inYear(o)&&CP.cny(o.amount,o.cur)==null);
 const turnover=O.filter(o=>deal(o)&&inYear(o)).reduce((n,o)=>n+(CP.cny(o.amount,o.cur)||0),0);
 const KP=quotePage?[
  ['', '全部报价',R.length,'份',scopeOn?'已按筛选统计 · 全部共 '+A.length+' 份':'本月新建 '+R.filter(q=>q.created.slice(0,7)===today.slice(0,7)).length+' 份'],
  ['draft','待发出草稿',R.filter(q=>q.status==='草稿').length,'份','还没发给客户，需要补齐',true],
  ['sent','已发出待回复',R.filter(q=>q.status==='已发送').length,'份','金额合计 <b>'+w(R.filter(q=>q.status==='已发送').reduce((n,q)=>n+(q.total||0),0))+'</b>'],
  ['exp','已过有效期',R.filter(exp).length,'份','需重报价或延长有效期',true],
  ['won','已确认 / 已转单',R.filter(q=>filterMatch(q,'won')).length,'份','占全部 <b>'+Math.round(R.filter(q=>filterMatch(q,'won')).length/Math.max(1,R.length)*100)+'%</b>']
 ]:[
  ['', '全部订单',R.length,'笔',scopeOn?'已按筛选统计 · 全部共 '+A.length+' 笔':'含取消订单，记录持续保留'],
  ['deal',dateOn?'区间成交额':'本年成交额',dealMissing?'待核对':'¥'+w(turnover),'',dateOn?'所选日期内生产中及后续全额计入':'生产中及后续全额计入成交'],
  ['paid','实际已收款',receivedMissing?'待折算':'¥'+w(received),'','按已登记的收款记录统计'],
  ['balance','有款待收',balanceMissing?'待折算':'¥'+w(outstanding),'',R.filter(r=>filterMatch(r,'balance')).length+' 笔 · 各阶段未收金额',true],
  ['late','交期预警',R.filter(due).length,'笔','尚未发货且交期已逾期',true]
 ];
 $('#kpis').innerHTML=KP.map(([key,label,value,unit,desc,alert])=>'<button class="kpi'+(alert?' alert':'')+'" data-kpi="'+key+'" aria-pressed="'+(state.filter===key)+'"><span class="k">'+label+'</span><span class="v'+(alert&&Number(value)>0?' warn':'')+'">'+value+(unit?'<small>'+unit+'</small>':'')+'</span><span class="d">'+desc+'</span></button>').join('');
 $('#headSub').innerHTML=quotePage?(scopeOn?'符合筛选 <b>'+R.length+'</b> / '+A.length:'共 <b>'+R.length+'</b>')+' 份报价 · 记录金额合计 <b>'+w(R.reduce((n,q)=>n+(q.total||0),0))+'</b>（含多币种，未折算）· 已发出待回复 <b>'+R.filter(q=>q.status==='已发送').length+'</b> 份':(scopeOn?'符合筛选 <b>'+R.length+'</b> / '+A.length:'共 <b>'+R.length+'</b>')+' 笔订单 · 收到首笔款即统计待收尾款，可与履约阶段重叠';
 const colors=['#9aa0b2','#2f5bd3','#1b7a4b','#0b7480','#6a4bb8','#9aa0b2','#c9cdd8','#c0352b'];
 if(quotePage){
  const qColors=['#9AA0B2','#293C80','#1B7A4B','#0B7480','#C0352B','#E0A400'];
  $('#funnel').innerHTML=stages.map((status,i)=>{const group=R.filter(q=>q.status===status),sentExpired=group.filter(exp).length,extra=status==='草稿'?'尚未发给客户':status==='已发送'&&sentExpired?'其中 '+sentExpired+' 份已过期':'';
   return '<button class="fs'+(status==='已过期'&&group.length?' alert':'')+'" data-stage="'+status+'" aria-pressed="'+(state.stage===status)+'"><span class="k"><i style="background:'+qColors[i]+'"></i>'+status+'</span><span class="fs-detail"><span class="v">'+group.length+'<small>份</small></span><span class="m" title="'+esc(extra)+'">'+(group.length?w(group.reduce((n,q)=>n+(q.total||0),0))+(extra?' · '+extra:''):'—')+'</span></span></button>';
  }).join('');
 }else{
 $('#funnel').innerHTML=stages.map((status,i)=>{const rs=R.filter(r=>matchesStage(r,status));const value=r=>CP.cny(status==='待收尾款'?FTWOrderWorkflow.collection(r.raw).beforeShipment:r.amount,r.cur);return '<button class="fs" data-stage="'+status+'" aria-pressed="'+(state.stage===status)+'"><span class="k"><i style="background:'+colors[i]+'"></i>'+status+'</span><span class="v">'+rs.length+'<small>'+(quotePage?'份':'笔')+'</small></span><span class="m">'+(rs.some(r=>value(r)==null)?'金额待核对':rs.length?(status==='待收尾款'?'待收 ¥':'¥')+w(rs.reduce((n,r)=>n+value(r),0))+' CNY':'—')+'</span></button>'}).join('');
 }
 const alerts=quotePage?[['exp','有效期已过',R.filter(exp).length],['unlinked','未转订单',R.filter(r=>!r.orderId).length]]:[['installation','待安装',R.filter(r=>filterMatch(r,'installation')).length],['retention','待收质保金',R.filter(r=>filterMatch(r,'retention')).length],['active','执行中',R.filter(r=>filterMatch(r,'active')).length],['late','交期已逾期',R.filter(due).length],['unknown','收款待核对',R.filter(r=>filterMatch(r,'unknown')).length]];
 $('#attention').hidden=quotePage;
 $('#attention').innerHTML=alerts.map(([key,label,n])=>'<button data-extra="'+key+'" aria-pressed="'+(state.extra===key)+'">'+(['exp','late','unknown'].includes(key)?'<i class="dot"></i>':'')+label+'<b>'+n+'</b></button>').join('');
 $('#footnote').textContent=quotePage?'顶部金额为原币种数值合计（含多币种，未折算）；列表保留原币种，金额排序使用当前汇率折算。':'成交额包含生产中及后续订单；约定预付款比例不等于实际收款。未登记收款的订单保留待核对，取消订单保留。';
 const missing=O.filter(o=>!FTWOrderWorkflow.isCancelled(o.raw)&&CP.cny(o.amount,o.cur)==null).length;if(!quotePage&&missing)$('#footnote').textContent+=' '+missing+' 笔金额或汇率待核对，汇总暂不含这些金额。';
}
function paymentCell(o){const p=pay(o);if(p==null)return '<span class="unknown">'+ic('info','width:12px;height:12px')+'收款待核对</span>';return '<div class="payment-cell"><div class="mini-progress"><i><b style="width:'+o.paidPercent+'%"></b></i><span>'+o.paidPercent+'%</span></div><div class="amounts">已收 <b>'+money(p,o.cur,0)+'</b><br>待收 '+money(o.amount-p,o.cur,0)+'</div></div>'}
function dateCell(date,kind,r){if(!date)return '<span class="dim">未安排</span>';const n=days(date),late=kind==='valid'?exp(r):due(r);return '<span class="dt'+(late?' late':n>=0&&n<=7?' soon':'')+'">'+date.slice(5)+'<small>'+(late?'逾期 '+(-n)+' 天':n>=0&&n<=7?(n===0?'今天到期':n+' 天后到期'):kind==='due'&&done(r)?r.status==='已取消'?'已取消':'已发货 / 完成':date.slice(0,4))+'</small></span>'}
function cell(r,key){switch(key){
 case 'doc':return '<div class="who"><b>'+esc(r.no)+'</b><span>'+esc(r.client)+'</span></div>';
 case 'status':return tag(r.status)+(quotePage?'<br><span class="revision">V'+r.version+' · '+(r.version-1)+' 次修订</span>':'');
 case 'project':return '<div class="project" title="'+esc(r.project)+'">'+esc(r.project)+'</div><span class="subnum">'+r.items.length+' 项明细</span>';
 case 'amount':return '<span class="amt">'+money(quotePage?r.total:r.amount,r.cur)+'</span><span class="subnum">'+r.cur+(r.cur!=='CNY'?' · '+(cny(r)==null?'汇率待更新':'≈ ¥'+w(cny(r))):'')+'</span>';
 case 'valid':return dateCell(r.validUntil,'valid',r);
 case 'payment':return r.status==='已取消'?'<span class="dim">已取消</span>':paymentCell(r);
 case 'progress':if(r.progress==null)return '<span class="dim">未登记</span>';return '<div class="mini-progress"><i><b style="width:'+r.progress+'%"></b></i><span>'+r.progress+'%</span></div>';
 case 'due':return dateCell(r.deliveryDate,'due',r);
 case 'owner':return ownerTag(r.owner);
 case 'date':return '<span class="dt">'+esc(quotePage?r.created:r.orderDate)+'</span>';
}}
function render(){summary();const L=filtered(),total=rows().length;state.page=Math.max(1,Math.min(state.page,Math.ceil(L.length/state.per)||1));const slice=L.slice((state.page-1)*state.per,state.page*state.per);const dirty=state.query||state.owner||state.cur||state.filter||state.stage||state.extra||state.country||$('#from').value||$('#to').value;
 $('#fbar').classList.toggle('dirty',!!dirty);$('#qWrap').classList.toggle('has',!!state.query);$('#fOwner').value=state.owner;$('#fCur').value=state.cur;$('#fState').value=state.stage;$('#fCountry').value=state.country;$('#fQuick').value=state.extra;
 $('#fmoreBtn').innerHTML='更多筛选'+(state.stage||state.country||state.extra?'<span class="n">'+[state.stage,state.country,state.extra].filter(Boolean).length+'</span>':'');
 $('#count').innerHTML=quotePage?'筛选结果 <b>'+L.length+'</b> / '+total:'共 <b>'+L.length+'</b> 笔';$('#lstTitle').textContent=state.stage||state.filter?state.stage||$('#kpis [data-kpi="'+state.filter+'"] .k').textContent:quotePage?'报价列表':'订单列表';$('#lstSub').textContent=L.length+' / '+total;
 const view=mq.matches?'card':state.view;document.querySelectorAll('#viewSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===view));
 if(state.mode!=='ok'){$('#body').innerHTML=state.mode==='loading'?'<div class="sales-loading">'+Array.from({length:6},()=>'<div><i class="sk" style="width:30%;height:14px"></i><i class="sk" style="width:20%;height:14px"></i><i class="sk" style="width:16%;height:14px"></i></div>').join('')+'</div>':state.mode==='error'?'<div class="err">'+ic('alert')+'<h3>数据暂时无法加载</h3><p>暂时无法读取数据，请重试。</p><button class="btn" data-action="retry">重新加载</button></div>':'<div class="empty">'+ic(quotePage?'file':'box')+'<h3>还没有'+(quotePage?'报价':'订单')+'</h3><p>从新建一份'+(quotePage?'报价':'订单')+'开始。</p><button class="btn btn-pri" data-action="new">新建'+(quotePage?'报价':'订单')+'</button><button class="btn" data-action="retry">重新加载</button></div>';$('#pager').innerHTML='';finish();renderBatch();return}
 if(!L.length){$('#body').innerHTML='<div class="empty">'+ic('search')+'<h3>没有符合条件的记录</h3><p>试试调整关键词或筛选范围。</p><button class="btn" data-action="clear-filters">清空筛选</button></div>';$('#pager').innerHTML='';finish();renderBatch();return}
 if(view==='table'){
 const sortKeys={doc:'no',amount:'amount',valid:'due',due:'due',date:'date'};
 $('#body').innerHTML='<div class="tbl-wrap"><table class="tbl data-table" ><thead><tr><th class="ck" data-col="check"><input type="checkbox" id="ckAll" aria-label="选择本页" '+(slice.every(r=>state.selected.has(r.id))?'checked':'')+'></th>'+columns.filter(([key])=>visible.has(key)).map(([key,label])=>'<th data-col="'+colKey(key)+'"'+(sortKeys[key]?' data-sort="'+sortKeys[key]+'"':'')+(key==='amount'?' class="r"':'')+(sortKeys[key]===state.sort.split(':')[0]?' aria-sort="'+(state.sort.endsWith('desc')?'descending':'ascending')+'"':'')+'>'+(sortKeys[key]?'<button data-sort="'+sortKeys[key]+'">'+label+ic('sort')+'</button>':label)+'</th>').join('')+'<th data-col="ops"><span class="sr">查看详情</span></th></tr></thead><tbody id="'+(quotePage?'qtBody':'orderBody')+'">'+slice.map(r=>'<tr data-open="'+r.id+'" class="'+(state.selected.has(r.id)?'sel':'')+'"><td class="ck" data-col="check"><input type="checkbox" data-select="'+r.id+'" aria-label="选择 '+esc(r.no)+'" '+(state.selected.has(r.id)?'checked':'')+'></td>'+columns.filter(([key])=>visible.has(key)).map(([key])=>'<td data-col="'+colKey(key)+'"'+(key==='amount'?' class="r"':'')+'>'+cell(r,key)+'</td>').join('')+'<td data-col="ops"><button class="rowact" data-open="'+r.id+'" aria-label="查看 '+esc(r.no)+'">'+ic('arrow')+'</button></td></tr>').join('')+'</tbody></table></div>';
 }else $('#body').innerHTML='<div class="cards">'+slice.map(r=>'<div class="ccard'+(state.selected.has(r.id)?' sel':'')+'" role="button" tabindex="0" data-open="'+r.id+'"><div class="t"><input type="checkbox" data-select="'+r.id+'" aria-label="选择 '+esc(r.no)+'" '+(state.selected.has(r.id)?'checked':'')+'><div class="who"><b>'+esc(r.no)+'</b><span>'+esc(r.client)+'</span></div>'+tag(r.status)+'</div><div class="m"><p>'+esc(r.project)+'</p>'+ownerTag(r.owner)+(quotePage?'<span class="revision">V'+r.version+' · '+r.items.length+' 项</span>':'<span class="chip">'+(r.progress==null?'生产未登记':'生产 '+r.progress+'%')+'</span>')+'</div>'+(!quotePage&&r.status!=='已取消'?paymentCell(r):'')+'<div class="f"><span class="amt">'+money(quotePage?r.total:r.amount,r.cur)+'</span>'+dateCell(quotePage?r.validUntil:r.deliveryDate,quotePage?'valid':'due',r)+'</div></div>').join('')+'</div>';
 const pages=Math.ceil(L.length/state.per);$('#pager').innerHTML='<span>第 <b class="num">'+((state.page-1)*state.per+1)+'–'+Math.min(state.page*state.per,L.length)+'</b> 条，共 '+L.length+' 条</span><span class="sp"></span><div class="sel"><select id="per" aria-label="每页条数">'+[20,50,100].map(n=>'<option '+(n===state.per?'selected':'')+'>'+n+'</option>').join('')+'</select></div><div class="pg"><button data-page="'+(state.page-1)+'" '+(state.page<=1?'disabled':'')+' aria-label="上一页">‹</button><button aria-current="page">'+state.page+'</button><button data-page="'+(state.page+1)+'" '+(state.page>=pages?'disabled':'')+' aria-label="下一页">›</button></div>';
 finish();renderBatch();
}
function renderBatch(){const b=$('#batch'),n=state.selected.size;if(!quotePage){orderSelected.clear();for(const id of state.selected)orderSelected.add(id);}b.classList.toggle('show',n>0);b.innerHTML='已选 <b>'+n+'</b> '+(quotePage?'份报价':'笔订单')+'<button class="btn" data-action="batch-owner">分配负责人</button>'+(!quotePage?'<button class="btn" data-action="batch-edit">批量编辑</button>':'')+'<button class="btn" data-action="batch-export">导出</button><button class="btn icon-btn" data-action="batch-clear" aria-label="取消选择">'+ic('x')+'</button>';const box=root.getBoundingClientRect();b.style.left=Math.max(b.offsetWidth/2+14,Math.min(innerWidth-b.offsetWidth/2-14,box.left+box.width/2))+'px'}
 function itemTable(r){if(!r.items.length)return '<p class="quiet">尚未登记产品明细，可在编辑中补充。订单金额按已保存的总额展示。</p>';return '<div class="line-scroll"><table class="linedt"><thead><tr><th>产品 / 规格</th><th class="r">数量</th><th class="r">单价</th><th class="r">小计</th></tr></thead><tbody>'+r.items.map(it=>'<tr><td><div class="ln-name">'+esc(it.name||'未填写')+'</div><div class="ln-desc">'+esc(it.description||'')+'</div></td><td class="r amt">'+esc(it.qty??'')+' '+esc(it.unit||'SET')+'</td><td class="r amt">'+money(CP.number(it.unitPrice),r.cur)+'</td><td class="r amt">'+(CP.number(it.qty)!=null&&CP.number(it.unitPrice)!=null?money(Number(it.qty)*Number(it.unitPrice),r.cur):'待核对')+'</td></tr>').join('')+'</tbody></table></div><div class="linetotal">合计 <b>'+money(quotePage?r.total:r.amount,r.cur)+'</b></div>';}
 function kv(label,value,full=false){return '<div'+(full?' class="full"':'')+'><dt>'+label+'</dt><dd>'+(value||'<span class="dim">未填写</span>')+'</dd></div>';}
 function drawer(id,keep=false){refresh();const r=get(id);if(!r)return;currentId=id;if(!keep)returnFocus=document.activeElement;const host=$('#drawer'),scroll=keep?host.querySelector('.dr-b')?.scrollTop||0:0;let actions,metrics,body;
  if(quotePage){
   actions='<button class="btn btn-pri" data-action="edit">'+ic('pen')+'编辑报价</button><button class="btn" data-action="document">'+ic('doc')+'预览单据</button><button class="btn" data-action="stage">更新状态</button><button class="btn" data-action="convert" '+(qtConverting.has(id)||!r.orderId&&!['客户确认','已转订单'].includes(r.status)?'disabled':'')+'>'+(r.orderId?'查看订单':r.status==='已转订单'?'补建订单':'转为订单')+'</button>';
   metrics='<div><span>本次报价 · '+esc(r.cur)+'</span><b>'+money(r.total,r.cur)+'</b><small>'+(cny(r)==null?'汇率待更新':'≈ ¥'+w(cny(r))+' CNY')+'</small></div><div><span>有效期至</span><b class="'+(exp(r)?'warn':'')+'">'+(r.validUntil?.slice(5)||'未设置')+'</b><small>'+(r.validUntil?days(r.validUntil)<0?'已过期 '+(-days(r.validUntil))+' 天':days(r.validUntil)+' 天后到期':'未设有效期')+'</small></div><div><span>当前版本</span><b>V'+r.version+'</b><small>'+(r.version-1)+' 次内容修订</small></div>';
   const order=data.orders.find(o=>o.id===r.orderId);
   body='<section class="dr-sec"><h3>报价概要 <button class="link section-r" data-action="copy">复制为草稿</button></h3><dl class="kv">'+kv('客户',esc(r.client))+kv('联系人',esc(r.contact))+kv('负责人',ownerTag(r.owner))+kv('贸易条款',esc(r.tradeTerms))+kv('交货期',r.delivery?esc(r.delivery)+' 天':'')+kv('创建日期',r.created)+kv('付款约定',esc(r.payment),true)+kv('项目备注',esc(r.notes),true)+'</dl></section><section class="dr-sec"><h3>报价明细 <span class="n">'+r.items.length+' 项</span></h3>'+itemTable(r)+'</section><section class="dr-sec"><h3>关联订单</h3>'+(order?'<button class="link-box" data-action="view-order">'+ic('box')+esc(order.no)+' '+tag(order.status)+ic('arrow')+'</button>':'<p class="quiet">'+(r.orderId?'关联订单尚未加载或无权查看。':'客户确认后可转为订单，报价与订单双向关联。')+'</p>')+'</section><section class="dr-sec"><h3>版本记录 <span class="n">V'+r.version+'</span></h3><ul class="tl">'+(r.history.length?r.history.slice().reverse().map((h,i)=>'<li><time>V'+h.version+' · '+h.date+(h.actor?' · '+esc(h.actor):'')+'</time>'+esc(h.text)+'<div class="subnum">'+money(h.total,r.cur)+'</div><button class="link" data-revision="'+(r.history.length-i-1)+'">查看此版内容</button></li>').join(''):'<li>已保留原版本号；此前未记录的修改不补造历史。</li>')+'</ul><button class="link danger" data-action="delete">删除此报价</button></section>';
  }else{
   const payment=FTWOrderWorkflow.payment(r.raw),q=data.quotes.find(q=>q.id===r.quoteId);const paid=payment.received,balance=payment.outstanding;
   actions='<button class="btn btn-pri" data-action="receipt" '+(r.status==='已取消'?'disabled':'')+'>'+ic('coin')+(paid==null?'核对收款':'登记收款')+'</button><button class="btn" data-action="progress" '+(r.status==='已取消'?'disabled':'')+'>'+ic('target')+'更新生产</button><button class="btn" data-action="stage">变更阶段</button><button class="btn" data-action="edit">'+ic('pen')+'编辑</button><button class="btn" data-action="full">完整详情</button>';
   metrics='<div><span>订单金额 · '+esc(r.cur)+'</span><b>'+money(r.amount,r.cur)+'</b><small>'+(deal(r)?'已计入成交额':'尚未计入成交额')+'</small></div><div><span>实际已收</span><b>'+money(paid,r.cur)+'</b><small>'+(r.deposit==null?'未约定预付款比例':'约定预付款 '+r.deposit+'%')+'</small></div><div><span>待收余额</span><b class="'+(balance>0?'warn':'')+'">'+money(balance,r.cur)+'</b><small>'+(balance===0?'款项已结清':paid==null?'请补登记实际收款':'预付款尚欠 '+money(FTWOrderWorkflow.collection(r.raw).depositDue,r.cur)+' · 其中质保金 '+money(FTWOrderWorkflow.collection(r.raw).retained,r.cur)+(r.raw.retentionDue?' · '+esc(r.raw.retentionDue):''))+'</small></div>';
   body='<section class="dr-sec"><h3>收款情况 <button class="link section-r" data-action="receipt">核对实际收款</button></h3><div class="pay-overview">'+paymentCell(r)+'<p class="hint">按订单金额与已登记付款比例计算。实际收款与履约阶段分别记录，约定预付款比例不作为已收款。'+(payment.source==='historical'?'此历史订单沿用原全额收款口径，可登记实际比例更正。':'')+'</p></div></section><section class="dr-sec"><h3>生产与交付 <button class="link section-r" data-action="progress">更新进度</button></h3><dl class="kv">'+kv('生产进度',r.progress==null?'未登记':'<div class="mini-progress"><i><b style="width:'+r.progress+'%"></b></i><span>'+r.progress+'%</span></div>')+kv('约定交期',dateCell(r.deliveryDate,'due',r))+kv('下单日期',r.orderDate)+kv('负责人',ownerTag(r.owner))+kv('交付国家',esc(r.country))+kv('最近阶段说明',esc(r.raw.lastStageReason),true)+kv('订单备注',esc(r.notes),true)+'</dl></section><section class="dr-sec"><h3>产品明细 <span class="n">'+r.items.length+' 项</span></h3>'+itemTable(r)+'</section><section class="dr-sec"><h3>关联报价</h3>'+(q?'<button class="link-box" data-action="view-quote">'+ic('file')+esc(q.no)+' <span class="revision">V'+q.version+'</span>'+ic('arrow')+'</button>':'<p class="quiet">'+(r.quoteId?'关联报价尚未加载或无权查看。':'未关联报价。')+'</p>')+'</section><section class="dr-sec"><h3>单证与出货</h3><div class="dr-acts"><button class="btn" data-action="pi">生成 PI</button><button class="btn" data-action="ci">商业发票</button><button class="btn" data-action="packing-list">装箱单</button><button class="btn" data-action="shipment">登记出货</button></div></section>';
  }
  host.innerHTML='<div class="dr-h"><button class="btn btn-ghost icon-btn x" data-action="close-drawer" aria-label="关闭详情">'+ic('x')+'</button><div class="eb">'+tag(r.status)+(r.raw.status!==r.status?'<span class="chip">登记：'+esc(r.raw.status)+'</span>':'')+'</div><h2 id="'+prefix+'drTitle">'+esc(r.no)+'</h2><div class="sub">'+esc(r.client)+(r.project?' · '+esc(r.project):'')+'</div>'+(!quotePage?'<div class="stepper" aria-label="履约流程">'+oStages.slice(0,7).map((s,i)=>'<span class="'+(s===r.status?'current':i<oStages.indexOf(r.status)&&r.status!=='已取消'?'done':'')+'">'+s+'</span>').join('')+'</div>':'')+'<div class="mini-metrics">'+metrics+'</div><div class="dr-acts">'+actions+'</div></div><div class="dr-b">'+body+'</div>';
  host.classList.add('open');host.inert=!!document.querySelector('#modal.open');host.setAttribute('aria-hidden','false');$('#drBg').classList.add('open');document.body.dataset.crmDrawerOpen='true';host.querySelector('.dr-b').scrollTop=scroll;if(!keep)host.querySelector('[data-action=close-drawer]')?.focus({preventScroll:true});
 }
 function closeDrawer(){const host=$('#drawer');if(!host)return;host.classList.remove('open');host.inert=true;host.setAttribute('aria-hidden','true');$('#drBg').classList.remove('open');delete document.body.dataset.crmDrawerOpen;currentId=null;returnFocus?.focus?.({preventScroll:true});}
 function finish(){
  const table=$('#body table.data-table');if(table)window.applyTableColumnSettings?.(table);
  const all=root.querySelector('#ckAll');if(all)all.id=prefix+'ckAll';const per=root.querySelector('#per');if(per){per.id=prefix+'per';per.dataset.noCombo='';}
  root.querySelectorAll('[data-select]').forEach(input=>{if(!quotePage){input.classList.add('cb-order');input.dataset.oid=input.dataset.select;}});
  let notice=$('#loadNotice');if(!notice){notice=document.createElement('div');notice.id=prefix+'loadNotice';notice.className='crm-notice';$('#body').before(notice);}notice.hidden=feedback[kind]!=='error'||!rows().length;notice.innerHTML='更新失败，当前保留上次加载的数据。<button type="button" data-action="retry">重新加载</button>';
  if(currentId){if(get(currentId))drawer(currentId,true);else closeDrawer();}
 }
 async function reload(){if(quotePage)await loadQuotations();else await loadAll();}
 function modalError(error){const form=document.getElementById('modalForm');let el=document.getElementById('salesSaveError');if(!el){el=document.createElement('p');el.id='salesSaveError';el.className='field full';el.style.color='var(--danger)';el.setAttribute('role','alert');form.append(el);}el.textContent=error.message||String(error);}
 function statusModal(r){const captured=actor;openModal(quotePage?'更新报价状态':'变更订单阶段','<label class="field"><span>新状态</span><select name="salesStage" data-no-combo>'+stages.map(s=>'<option '+(s===(quotePage?r.status:FTWOrderWorkflow.stage(r.raw))?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label>'+(!quotePage?'<label class="field"><span>合同质保金（订单币种）</span><input type="number" name="retention" min="0" max="'+esc(r.amount)+'" step="0.01" value="'+esc(r.raw.retentionAmount||0)+'"></label><label class="field"><span>质保金应收日期</span><input type="date" name="retentionDue" value="'+esc(r.raw.retentionDue||'')+'"></label><label class="field"><span><input type="checkbox" name="installation" '+(r.raw.installationRequired?'checked':'')+'> 发货后需要安装</span></label><label class="field full"><span>变更说明</span><textarea name="salesReason" required maxlength="4000" placeholder="记录本次推进的依据，保存为当前阶段说明"></textarea></label>':'')+'<p class="muted field full">'+(quotePage?'选择已转订单会执行真实转单并关联订单。':'变更阶段不会自动登记收款；生产中及后续按全额计入成交。')+'</p>');const form=document.getElementById('modalForm');let busy=false;
  form.onsubmit=async e=>{e.preventDefault();if(busy||captured!==currentUser?.id)return;const fd=new FormData(form),target=fd.get('salesStage'),reason=String(fd.get('salesReason')||'').trim();if(!quotePage&&!reason)return modalError(Error('请填写变更说明'));busy=true;CP.modalBusy(form,true);try{
   if(quotePage&&target==='已转订单'){const result=await convertQuoteToOrder(r.id);if(!result)return;}
   else{const payload=quotePage?{status:target,baseVersion:r.version}:{status:target,lastStageReason:reason,retentionAmount:Number(fd.get('retention')),retentionDue:fd.get('retentionDue'),installationRequired:fd.has('installation')};await CP.request('/api/'+(quotePage?'quotations':'orders')+'/'+encodeURIComponent(r.id),payload,'PUT');}
   if(captured!==currentUser?.id)return;closeModal();await reload();render();toast('状态已更新');
  }catch(error){modalError(error)}finally{busy=false;if(form.isConnected)CP.modalBusy(form,false)}};
 }
 function exportCSV(selected=false){const L=selected?rows().filter(r=>state.selected.has(r.id)):filtered();CP.csv((quotePage?'报价管理':'订单数据')+'-'+today+'.csv',quotePage?['报价号','客户','项目','状态','币种','金额','版本','有效期','负责人']:['订单号','客户','阶段','币种','金额','实际已收','待收余额','生产进度','下单日期','交期','负责人'],L.map(r=>quotePage?[r.no,r.client,r.project,r.status,r.cur,r.total,r.version,r.validUntil,r.owner]:[r.no,r.client,r.status,r.cur,r.amount,pay(r)??'待核对',pay(r)==null?'待核对':FTWOrderWorkflow.payment(r.raw).outstanding,r.progress??'未登记',r.orderDate,r.deliveryDate,r.owner]));toast('已导出 '+L.length+' 条记录');}
 function assign(){const L=rows().filter(r=>state.selected.has(r.id));if(!L.length)return toast('请先选择记录');const captured=actor,users=window.assignableUsers();openModal('批量分配负责人','<p>已选择 '+L.length+' 条记录</p><label class="field"><span>负责人</span><select data-no-combo name="salesOwner">'+users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name||u.username)+'</option>').join('')+'</select></label>');const form=document.getElementById('modalForm');let busy=false;
  form.onsubmit=async e=>{e.preventDefault();if(busy||captured!==currentUser?.id)return;busy=true;CP.modalBusy(form,true);try{const uid=new FormData(form).get('salesOwner'),owner=users.find(u=>u.id===uid);if(!owner)throw Error('请选择负责人');const failures=[];for(const row of L.filter(r=>state.selected.has(r.id))){if(captured!==currentUser?.id)return;try{await CP.request('/api/'+(quotePage?'quotations':'orders')+'/'+encodeURIComponent(row.id),{owner:uid,ownerName:owner.name||owner.username,...(quotePage?{baseVersion:get(row.id)?.version||row.version}:{})},'PUT');state.selected.delete(row.id);}catch(error){failures.push(row.no+'：'+error.message)}}if(captured!==currentUser?.id)return;await reload();if(failures.length)modalError(Error('失败记录已保留，可重试。\n'+failures.join('\n')));else{closeModal();toast('负责人已更新')}}catch(error){modalError(error)}finally{busy=false;if(form.isConnected)CP.modalBusy(form,false)}};
 }
 async function action(name){const r=currentId?get(currentId):null;switch(name){
  case 'close-drawer':closeDrawer();break;case 'new':if(quotePage)openQuoteModal();else openOrderModal();break;case 'edit':if(r){if(quotePage)openQuoteModal(r.id);else openOrderModal(r.id);}break;
  case 'import':case 'ai':openAiOrderRegister(quotePage?'quote':undefined);break;
  case 'columns':if($('#body table.data-table'))window.openColumnCfg(quotePage?'qtBody':'orderBody');else toast('有记录后可设置列');break;
  case 'export':exportCSV();break;case 'batch-export':exportCSV(true);break;case 'batch-owner':assign();break;case 'batch-clear':state.selected.clear();render();break;
  case 'batch-edit':if(state.selected.size)openOrderBatchEdit();else toast('请先选择记录');break;case 'batch-delete':if(state.selected.size)openOrderBatchDelete();else toast('请先选择记录');break;
  case 'clear-filters':resetFilters();break;case 'retry':await reload();break;
  case 'receipt':if(r)openSalesProgress(r.raw,'payment');break;case 'progress':if(r)openSalesProgress(r.raw,'production');break;case 'stage':if(r)statusModal(r);break;
  case 'document':if(r&&quotePage){closeDrawer();openQuoteDoc(r.id);}break;
  case 'copy':if(r)openQuoteModal(null,{...r.raw,id:undefined,quoteNo:suggestQuoteNo(),status:'草稿',orderId:null});break;
  case 'convert':if(r){if(r.orderId){const id=r.orderId;closeDrawer();switchView('orders');await loadAll();boards.orders?.open(id);}else await convertQuoteToOrder(r.id);}break;
  case 'view-order':if(r?.orderId){const id=r.orderId;closeDrawer();switchView('orders');boards.orders?.open(id);}break;
  case 'view-quote':if(r?.quoteId){const id=r.quoteId;closeDrawer();switchView('quotations');await loadQuotations();boards.quotes?.open(id);}break;
  case 'full':if(r){const id=r.id;closeDrawer();openOrderDetail(id);}break;
  case 'pi':case 'ci':case 'packing-list':if(r){closeDrawer();loadOrderSalesDoc(r.raw,name==='packing-list'?'packing':name);}break;
  case 'shipment':if(r){closeDrawer();openShipmentModal(null,{orderId:r.id,orderNo:r.no,clientName:r.client});}break;
  case 'delete':if(r&&confirm('确认删除报价 '+r.no+'？')){await CP.request('/api/quotations/'+encodeURIComponent(r.id),{},'DELETE');closeDrawer();await reload();}break;
 }}
 const opts=(list,label)=>'<option value="">'+label+'</option>'+list.map(x=>'<option>'+esc(x)+'</option>').join('');
 const quick=quotePage?[['exp','有效期已过'],['soon','7 天内到期'],['convert','确认后待转单']]:[['late','交期逾期'],['unknown','收款待核对'],['balance','仍有待收余额']];
 $('#fpanel').innerHTML='<div class="frow"><label for="'+prefix+'fState">业务状态</label><div class="sel"><select data-no-combo id="'+prefix+'fState">'+opts(stages,'全部状态')+'</select>'+ic('chev')+'</div></div><div class="frow"><label for="'+prefix+'fCountry">客户国家</label><div class="sel"><select data-no-combo id="'+prefix+'fCountry"></select>'+ic('chev')+'</div></div><div class="frow"><label for="'+prefix+'fQuick">预警 / 待办</label><div class="sel"><select data-no-combo id="'+prefix+'fQuick"><option value="">全部</option>'+quick.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select>'+ic('chev')+'</div></div><div class="frow"><label>日期起<input type="date" id="'+prefix+'from"></label></div><div class="frow"><label>至<input type="date" id="'+prefix+'to"></label></div><div class="ph"><span>可叠加筛选</span><button data-action="clear-filters">清空筛选</button></div>';
 $('#sortSel').innerHTML='<option value="date:desc">'+(quotePage?'最新创建':'下单日期 · 最新')+'</option><option value="date:asc">'+(quotePage?'最早创建':'下单日期 · 最早')+'</option><option value="amount:desc">金额 · 高到低（CNY）</option><option value="due:asc">'+(quotePage?'有效期':'交期')+' · 最近</option><option value="no:asc">单号 A–Z</option>';
 $('#exportBtn').innerHTML=ic('download')+'<span class="lbl2">'+(quotePage?'导入':'导出')+'</span>';$('#exportBtn').onclick=()=>quotePage?action('import'):exportCSV();$('#moreBtn').innerHTML=ic('more')+'<span class="lbl2">更多操作</span>';$('#addBtn').innerHTML=ic('plus')+'新建'+(quotePage?'报价':'订单');$('#addBtn').onclick=()=>action('new');
 $('#viewSeg [data-view=table]').innerHTML=ic('rows');$('#viewSeg [data-view=card]').innerHTML=ic('grid');
 $('#q').placeholder=quotePage?'报价号、客户、项目、联系人…':'订单号、客户、项目、国家…';
 $('#moreBtn').onclick=()=>{const open=$('#moreMenu').classList.toggle('open');$('#moreBtn').setAttribute('aria-expanded',open)};
 $('#fmoreBtn').onclick=()=>{const open=$('#fpanel').classList.toggle('open');$('#fmore').classList.toggle('open',open);$('#fmoreBtn').setAttribute('aria-expanded',open);if(open)ftwPlace($('#fpanel'),$('#fmoreBtn'))};
 $('#reset').onclick=resetFilters;$('#drBg').onclick=closeDrawer;
 let timer;$('#q').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{state.query=e.target.value;state.page=1;render()},140)};$('#qWrap .clr').onclick=()=>{state.query='';$('#q').value='';render()};
 for(const [id,key] of [['fOwner','owner'],['fCur','cur'],['fState','stage'],['fCountry','country'],['fQuick','extra']])$('#'+id).onchange=e=>{state[key]=e.target.value;state.page=1;render()};$('#sortSel').onchange=e=>{state.sort=e.target.value;render()};
 for(const id of ['from','to'])$('#'+id).onchange=()=>{state.page=1;render()};
 root.addEventListener('change',e=>{if(e.target.id===prefix+'per'){state.per=Number(e.target.value);state.page=1;render()}});
 root.addEventListener('click',e=>{const t=e.target,ac=t.closest('[data-action]');
  if(ac){$('#moreMenu').classList.remove('open');$('#moreBtn').setAttribute('aria-expanded','false');Promise.resolve(action(ac.dataset.action)).catch(error=>toast(error.message));return}
  if(t.closest('#'+prefix+'fmoreBtn')||t.closest('#'+prefix+'moreBtn'))return;
  if(!t.closest('#'+prefix+'fpanel')){$('#fpanel').classList.remove('open');$('#fmore').classList.remove('open');$('#fmoreBtn').setAttribute('aria-expanded','false')}
  if(!t.closest('.menu-w'))$('#moreMenu').classList.remove('open');
  const k=t.closest('[data-kpi]');if(k){state.filter=state.filter===k.dataset.kpi?'':k.dataset.kpi;state.page=1;render();return}
  const st=t.closest('[data-stage]');if(st){state.stage=state.stage===st.dataset.stage?'':st.dataset.stage;state.page=1;render();return}
  const extra=t.closest('[data-extra]');if(extra){state.extra=state.extra===extra.dataset.extra?'':extra.dataset.extra;state.page=1;render();return}
  const view=t.closest('[data-view]');if(view){state.view=view.dataset.view;render();return}
  const select=t.closest('[data-select]');if(select){if(select.checked)state.selected.add(select.dataset.select);else state.selected.delete(select.dataset.select);select.closest('tr,.ccard')?.classList.toggle('sel',select.checked);renderBatch();return}
  if(t.id===prefix+'ckAll'){for(const row of filtered().slice((state.page-1)*state.per,state.page*state.per)){if(t.checked)state.selected.add(row.id);else state.selected.delete(row.id)}render();return}
  const so=t.closest('[data-sort]');if(so){const [key,dir]=state.sort.split(':');state.sort=so.dataset.sort+':'+(key===so.dataset.sort&&dir==='desc'?'asc':'desc');$('#sortSel').value=state.sort;render();return}
  const pg=t.closest('button[data-page]');if(pg&&!pg.disabled){state.page=Number(pg.dataset.page);render();return}
  const rev=t.closest('[data-revision]');if(rev){const q=get(currentId),node=q?.history[Number(rev.dataset.revision)]?.raw;if(node)openModal('报价历史版本 V'+node.version,'<p>'+esc(node.snapshot?.quoteNo||q.no)+' · '+esc(node.snapshot?.clientName||q.client)+'</p>'+quoteItemsTable(node.snapshot||{})+'<p>'+esc((node.changes||[]).join('、'))+'</p>',{plain:true,wide:true,noFooter:true});return}
  if(t.closest('.drawer'))return;const row=t.closest('[data-open]');if(row)drawer(row.dataset.open);
 });
 document.addEventListener('keydown',e=>{if(!root.closest('.view').classList.contains('active')||document.querySelector('#modal.open'))return;
  if(e.key==='Escape'){if($('#fpanel').classList.contains('open')){$('#fpanel').classList.remove('open');$('#fmoreBtn').setAttribute('aria-expanded','false');$('#fmoreBtn').focus()}else if($('#drawer').classList.contains('open')){e.preventDefault();e.stopImmediatePropagation();closeDrawer();}}
  if(['Enter',' '].includes(e.key)&&root.contains(e.target)&&e.target.matches('.ccard')){e.preventDefault();drawer(e.target.dataset.open)}
  if(e.key==='Tab'&&$('#drawer').classList.contains('open')){const f=[...$('#drawer').querySelectorAll('button:not(:disabled),a[href]')].filter(x=>x.offsetParent);if(!e.shiftKey&&document.activeElement===f.at(-1)){e.preventDefault();f[0].focus()}else if(e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f.at(-1).focus()}}
 },true);
  const originalReset=resetFilters;resetFilters=function(){$('#from').value=$('#to').value='';originalReset()};$('#reset').onclick=resetFilters;
 CP.wireShell(root,closeDrawer);boards[kind]={render,open:drawer};
 if(!quotePage){window.crmSalesOrderBatch=()=>{state.selected=new Set(orderSelected);renderBatch();};}
 ['ftw:dataReady','ftw:ratesReady','ftw:quotationsChanged'].forEach(name=>window.addEventListener(name,render));
 document.addEventListener('ftw:session-change',()=>{if(!window.__ftwNoticeUser){state.selected.clear();closeDrawer();$('#drawer').replaceChildren();}render()});
 window.addEventListener('resize',()=>{render();if($('#fpanel').classList.contains('open'))ftwPlace($('#fpanel'),$('#fmoreBtn'))});
 window.onViewActivated=(previous=>function(view){if(view===(quotePage?'quotations':'orders'))render();previous?.(view)})(window.onViewActivated);
 render();
}
})();
