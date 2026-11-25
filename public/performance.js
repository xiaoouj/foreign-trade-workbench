// 业绩口径：生产中及后续阶段订单全额；成交询盘不重复计入。
const perfTargetMoney=n=>'¥'+Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
let perfPeriod='month';
let salesConfig={yearMonthly:{}};
let perfLoadSeq=0,perfTargetReady=false;
function perfCompany(){return $('#perfOwner')?.value==='company';}
function perfCompanySummaryOnly(){return perfCompany()&&currentUser?.role!=='admin';}
function perfOwner(){return perfCompany()?'':($('#perfOwner')?.value||currentUser?.id||'');}
function perfSalesUrl(){return '/api/sales'+(perfCompany()?'?scope=company':'?userId='+encodeURIComponent(perfOwner()));}
function perfRows(){return userOrders().filter(o=>!perfOwner() || String(o.owner)===perfOwner());}
function perfInquiries(){return (window.getAllInquiries?.()||[]).filter(o=>!perfOwner() || String(o.owner)===perfOwner());}
function periodMonths(p){
 const date=$('#perfDate')?.value || todayStr().slice(0,7),y=Number(date.slice(0,4)),m=Number(date.slice(5,7))-1;
 const n=p==='year'?12:p==='quarter'?3:1,start=p==='year'?0:p==='quarter'?Math.floor(m/3)*3:m;
 return Array.from({length:n},(_,i)=>`${y}-${String(start+i+1).padStart(2,'0')}`);
}
function splitPeriodTarget(total,months){
 const cents=Math.round(total*100),base=Math.floor(cents/months.length),extra=cents%months.length;
 return Object.fromEntries(months.map((m,i)=>[m,(base+(i<extra?1:0))/100]));
}
function analyticsValidDate(s){if(!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(s||''))return false;const d=new Date(s+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s;}
function orderMonth(o){const d=orderDateValue(o);return analyticsValidDate(d)?d.slice(0,7):'';}
function inqMonth(q){const d=q.wonAt||q.receivedAt||q.createdAt;if(!d)return '';const date=typeof d==='number'?new Date(d):null;return date&&!isNaN(date)?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`:String(d).slice(0,7);}
function dealValue(o){const n=Number(o.amount);if(!Number.isFinite(n)||n<=0)return null;return o.currency==='CNY'?n:toCNY(n,o.currency);}
function combinedDeals(){
 if(perfCompanySummaryOnly())return Object.entries(salesConfig.actual?.monthly||{}).flatMap(([month,row])=>Object.entries(row.amounts).map(([currency,amount])=>({month,cny:currency==='CNY'?amount:toCNY(amount,currency),kind:'summary'})));
 return perfRows().filter(FTWOrderWorkflow.isDeal).map(o=>({...o,month:orderMonth(o),client:o.clientName||'未填客户',cny:dealValue(o),kind:'order'}));}
function periodTarget(){return periodMonths(perfPeriod).reduce((n,m)=>n+(Number(salesConfig.yearMonthly?.[m])||0),0);}
function periodActualParts(months){const set=new Set(months);return {orders:combinedDeals().filter(o=>set.has(o.month)&&o.cny!=null).reduce((n,o)=>n+o.cny,0)};}
function periodActual(months){return periodActualParts(months).orders;}
function refreshPerfOwners(){
 const el=$('#perfOwner');if(!el||!currentUser)return;const selected=el.value;
 const people=currentUser.role==='admin'?allUsers.filter(u=>u.role!=='admin'):allUsers.filter(u=>u.id===currentUser.id);
 el.innerHTML='<option value="company">公司总目标</option>'+people.map(u=>`<option value="${esc(u.id)}">${u.id===currentUser.id?'我的目标':esc(u.name||u.username)+' · 个人目标'}</option>`).join('');
 el.value=[...el.options].some(o=>o.value===selected)?selected:(currentUser.role==='admin'?'company':currentUser.id);
}
async function loadPerfSales(){
 const seq=++perfLoadSeq;perfTargetReady=false;renderPerformance();
 try{const res=await api(perfSalesUrl());if(!res.ok)throw Error('目标读取失败');const data=await res.json();if(seq!==perfLoadSeq)return;salesConfig=data||{yearMonthly:{}};perfTargetReady=true;}
 catch(e){if(seq===perfLoadSeq){salesConfig={yearMonthly:{}};toast(e.message);}}
 if(seq===perfLoadSeq)renderPerformance();
}
$('#perfEditTarget').onclick=()=>{
 if(!perfTargetReady||!salesConfig.canEdit)return toast('当前目标仅供查看');
 const company=perfCompany(),months=periodMonths(company?'year':perfPeriod),targetUrl=perfSalesUrl(),scope=company?'公司全年目标':'我的个人目标';
 openModal('设置目标',`<p>${esc(scope)} · ${months[0]}${months.length>1?' 至 '+months.at(-1):''}</p><div class="field"><label>本周期总目标（CNY）</label><input name="total" type="number" min="0" max="1000000000000" step="0.01" required value="${months.reduce((n,m)=>n+(Number(salesConfig.yearMonthly?.[m])||0),0)}" /></div><p class="muted">保存后平均分摊到 ${months.length} 个月，替换这些月份原目标；其他月份不变。个人目标合计不能超过公司全年目标；公司目标下调不能低于已分配合计。</p><div id="perfTargetPreview" class="muted"></div>`);
 const form=$('#modalForm'),input=form.elements.total;
 const preview=()=>{const n=Number(input.value);$('#perfTargetPreview').textContent=Number.isFinite(n)&&n>=0?Object.entries(splitPeriodTarget(n,months)).map(([m,v])=>m+'：'+v.toLocaleString('zh-CN',{minimumFractionDigits:2})).join(' · '):'请输入有效金额';};input.oninput=preview;preview();
 let saving=false;form.onsubmit=async e=>{e.preventDefault();if(saving)return;const n=Number(input.value);if(!input.value||!Number.isFinite(n)||n<0||n>1e12)return toast('请输入有效目标');saving=true;const btn=$('#modalFoot [type=submit]');if(btn)btn.disabled=true;
 try{const next=company?{year:months[0].slice(0,4),total:n}:{yearMonthly:splitPeriodTarget(n,months)};const res=await api(targetUrl,{method:'PUT',body:JSON.stringify(next)});if(!res.ok)throw Error((await res.json()).error||'保存失败');salesConfig=await res.json();closeModal();toast('目标已分摊并保存');renderPerformance();}catch(e){toast(e.message);}finally{saving=false;if(btn)btn.disabled=false;}};
};
// View structure and component geometry follow prototype/performance.html.
let perfDealFilter='all';
function renderPerformance(){
 if(!$('#perfDate')?.value)return;
 const months=periodMonths(perfPeriod),set=new Set(months),target=periodTarget(),deals=combinedDeals(),list=deals.filter(o=>set.has(o.month)),actual=list.reduce((n,o)=>n+(o.cny||0),0),rate=target?actual/target*100:0;
 $$('#view-performance [data-period]').forEach(b=>{b.classList.toggle('active',b.dataset.period===perfPeriod);b.setAttribute('aria-pressed',String(b.dataset.period===perfPeriod));});
 $('#perfEditTarget').disabled=!perfTargetReady||!salesConfig.canEdit;
 $('#perfEditTarget').innerHTML='<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/><circle cx="12" cy="12" r="3"/></svg>'+(perfCompany()?'设置全年目标':'设置我的目标');
 $('#perfEditTarget').hidden=perfTargetReady&&!salesConfig.canEdit;
 const first=Date.parse(months[0]+'-01T00:00:00+08:00'),[year,lastMonth]=months.at(-1).split('-').map(Number),end=Date.UTC(year,lastMonth,1)-8*3600000,elapsed=Math.max(0,Math.min(1,(Date.now()-first)/(end-first))),difference=actual-target*elapsed;
 const label=perfPeriod==='month'?months[0]:perfPeriod==='quarter'?year+' 年 Q'+Math.ceil(Number(months[0].slice(5))/3):year+' 年';
 $('#pfMetrics').innerHTML=`<div><span>${label} · ${perfCompany()?'公司':'个人'}实绩</span><b class="big num" id="pfActual">${fmtMoney(actual)}</b></div><div><span>目标</span><b class="num" id="pfTarget">${perfTargetReady?target?fmtMoney(target):'未设置':'读取中'}</b></div><div><span>完成率</span><b class="num" id="pfRate">${target&&perfTargetReady?rate.toFixed(1)+'<small>%</small>':'—'}</b></div><div><span>${actual>=target&&target?'已超出目标':'距目标还差'}</span><b class="num" id="pfDelta">${target&&perfTargetReady?fmtMoney(Math.abs(target-actual)):'—'}</b></div><span class="pace ${difference<0?'behind':'ahead'}">${!perfTargetReady?'正在读取目标':!target?'尚未设置目标':elapsed===0?'统计周期尚未开始':(difference<0?'比时间进度落后 ':'比时间进度领先 ')+fmtMoney(Math.abs(difference))}</span>`;
 $('#pfFill').style.width=Math.min(100,rate)+'%';$('#pfFill').classList.toggle('over',rate>=100);
 $('#pfTime').hidden=!target||!perfTargetReady;$('#pfTime').style.left=elapsed*100+'%';
 $('#pfTime span').style.transform=elapsed>.85?'translateX(-100%)':elapsed<.15?'none':'translateX(-50%)';
 $('#pfTime span').textContent='时间已过 '+Math.round(elapsed*100)+'% · 应完成 '+perfAxisMoney(target*elapsed);
 $('#pfTargetTick').textContent=target?perfAxisMoney(target):'目标';
 $('#pfRing').setAttribute('aria-label',target?'完成 '+rate.toFixed(1)+'%，时间进度 '+Math.round(elapsed*100)+'%':'尚未设置目标');
 const budget=salesConfig.budget?.[String(year)]||{company:0,allocated:0,remaining:0},allocation=budget.company?budget.allocated/budget.company*100:0;
 const invalid=list.filter(o=>o.cny==null).length,undated=deals.filter(o=>!o.month).length;
 $('#pfRulerFoot').innerHTML=`<span>${year} 年公司目标 <b>${fmtMoney(budget.company)}</b></span><span class="alloc">已分配到个人 <b>${fmtMoney(budget.allocated)}</b><i style="--w:${Math.min(100,allocation)}%" aria-hidden="true"></i><span class="num">${Math.round(allocation)}%</span></span><span>未分配 <b>${fmtMoney(Math.max(0,budget.remaining))}</b></span><span>统计区间 <b>${months[0]} 至 ${months.at(-1)}</b> · ${perfCompanySummaryOnly()?months.reduce((sum,m)=>sum+(salesConfig.actual?.monthly?.[m]?.count||0),0):list.length} 笔订单</span>${invalid||undated?`<span>待核对：${invalid} 笔金额或汇率异常，${undated} 笔日期异常未纳入周期。</span>`:''}${budget.remaining<0?'<span>历史个人目标已超额，请各成员调整。</span>':''}`;
 $('#performance-mh').textContent=year+' 年每月实绩';
 renderPerfTrendCharts();renderPerfTeam(deals);renderPerfStatus(months);
 if(perfCompanySummaryOnly()){
  $('#pfClientChart').innerHTML='<li style="display:block"><div class="empty">客户分布请在个人视图查看</div></li>';
  $('#pfFunnel').innerHTML='<div class="empty">询盘分布请在个人视图查看</div>';
 }else{renderClientChart(months);renderPerfInquiryDistribution();}
 renderPerfDetails(list,deals);
}
function renderPerfTeam(deals){
 const panel=$('#pfTeam');panel.hidden=!perfCompany()||currentUser?.role!=='admin';if(panel.hidden)return;
 const months=periodMonths(perfPeriod);$('#pfTeamMonth').textContent=months[0]+(months.length>1?' 至 '+months.at(-1):'')+' · CNY · 与上方周期一致';
 if(!perfTargetReady||salesConfig.scope!=='company'){$('#pfTeamBody').innerHTML='<div class="empty">正在读取目标…</div>';return;}
 const total=deals.filter(o=>months.includes(o.month)).reduce((sum,o)=>sum+(o.cny||0),0);
 const members=allUsers.filter(u=>u.role!=='admin').map(user=>{const list=deals.filter(o=>o.owner===user.id&&months.includes(o.month));return {user,actual:list.reduce((sum,o)=>sum+(o.cny||0),0),target:months.reduce((sum,m)=>sum+(Number(salesConfig.memberTargets?.[user.id]?.[m])||0),0),count:list.length,incomplete:list.some(o=>o.cny==null)};}).sort((a,b)=>b.actual-a.actual);
 $('#pfTeamBody').innerHTML=members.length?`<table class="tbl"><thead><tr><th>业务员</th><th class="r">实绩</th><th class="r hide-m">订单</th><th class="r">目标</th><th class="r">完成率</th></tr></thead><tbody>${members.map(({user,actual,target,count,incomplete})=>`<tr><td><b>${esc(user.name||user.username)}</b></td><td class="r numc"><strong>${fmtMoney(actual)}</strong><span class="share">${total?Math.round(actual/total*100):0}%</span>${incomplete?'<small>部分金额待核对</small>':''}</td><td class="r numc hide-m">${count}</td><td class="r numc">${target?fmtMoney(target):'<span class="unset">未设置</span>'}</td><td class="r">${target?`<span class="rate"><i><em style="width:${Math.min(100,actual/target*100)}%"></em></i><b>${(actual/target*100).toFixed(1)}%</b></span>`:'<span class="unset">未设置</span>'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">暂无业务员</div>';
}
function renderClientChart(months){
 const map=new Map();for(const o of combinedDeals()){if(months.includes(o.month)&&o.cny!=null)map.set(o.client,(map.get(o.client)||0)+o.cny);}
 const rows=[...map].sort((a,b)=>b[1]-a[1]).slice(0,10),total=[...map.values()].reduce((a,b)=>a+b,0);
 $('#pfClientChart').innerHTML=rows.length?rows.map(([client,amount])=>`<li><span class="nm" title="${esc(client)}">${esc(client)}</span><span class="v">${fmtMoney(amount)}<span class="share">${total?Math.round(amount/total*100):0}%</span></span><span class="bar"><i style="width:${amount/rows[0][1]*100}%"></i></span></li>`).join(''):'<li style="display:block"><div class="empty">本周期还没有成交订单</div></li>';
}
function renderPerfDetails(list,deals){
 const threshold=Math.max(0,Number($('#perfLarge').value)||0),counts=new Map();list.forEach(o=>{if(o.orderNo)counts.set(o.orderNo,(counts.get(o.orderNo)||0)+1);});
 const alerts=o=>[!o.month?'日期缺失或无效':'',o.cny==null?'金额或汇率异常':'',o.deliveryDate&&o.deliveryDate<todayStr()&&!['已发货','已完成','已取消'].includes(o.status)?'交期已过，未发货':'',counts.get(o.orderNo)>1?'疑似重复':''].filter(Boolean);
 const rows=perfCompanySummaryOnly()?[]:[...list,...deals.filter(o=>!o.month)].sort((a,b)=>(b.cny||0)-(a.cny||0));
 const n={all:rows.length,big:rows.filter(o=>o.cny>=threshold).length,late:rows.filter(o=>alerts(o).some(a=>a.startsWith('交期'))).length,dup:rows.filter(o=>counts.get(o.orderNo)>1).length};
 const chips=[['all','全部'],['big','大单'],['late','交期已过'],...(n.dup?[['dup','疑似重复']]:[])];
 if(!chips.some(([key])=>key===perfDealFilter))perfDealFilter='all';
 $('#pfDealChips').innerHTML=perfCompanySummaryOnly()?'':chips.map(([key,label])=>`<button class="chip" aria-pressed="${key===perfDealFilter}" data-deal-filter="${key}">${label} <b>${n[key]}</b></button>`).join('');
 $('#pfDealChips').querySelectorAll('button').forEach(b=>b.onclick=()=>{perfDealFilter=b.dataset.dealFilter;renderPerformance();});
 $('#pfAlertSummary').textContent=perfCompanySummaryOnly()?'公司汇总':'大单门槛 '+fmtMoney(threshold)+' · 大单 '+n.big+' 笔 · 异常 '+rows.filter(o=>alerts(o).length).length+' 笔（含日期异常）'+(n.dup?' · 疑似重复 '+n.dup+' 行':'');
 const filtered=rows.filter(o=>perfDealFilter==='all'||perfDealFilter==='big'&&o.cny>=threshold||perfDealFilter==='late'&&alerts(o).some(a=>a.startsWith('交期'))||perfDealFilter==='dup'&&counts.get(o.orderNo)>1);
 $('#pfDeals').innerHTML=perfCompanySummaryOnly()?'<div class="empty">公司视图展示汇总数据。切换个人目标可查看有权限访问的订单明细。</div>':filtered.length?`<table class="tbl data-table" data-column-toolbar="#pfColumnTools"><thead><tr><th data-col="c0">订单号</th><th data-col="c4">客户</th><th data-col="c1" class="hide-m">负责人</th><th data-col="c2" class="r">折合 CNY</th><th data-col="c3">标记</th></tr></thead><tbody id="pfDealBody">${filtered.map(o=>`<tr><td class="numc"><button type="button" class="link" data-perf-order="${esc(o.id)}">${esc(o.orderNo||'未填单号')}</button></td><td>${esc(o.client)}</td><td class="hide-m">${esc(clientOwnerLabel(o))}</td><td class="r numc"><b>${o.cny==null?'待核对':fmtMoney(o.cny)}</b></td><td>${o.cny>=threshold?'<span class="tag t-new">大单</span>':''}${alerts(o).map(a=>`<span class="tag t-bad">${esc(a)}</span>`).join('')|| (o.cny>=threshold?'':'—')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">当前筛选无订单</div>';
 $('#pfDeals').querySelectorAll('[data-perf-order]').forEach(b=>b.onclick=()=>openOrderDetail(b.dataset.perfOrder));
 window.applyTableColumnSettings?.($('#pfDeals table'));
 const tools=$('#pfColumnTools');tools.innerHTML=!perfCompanySummaryOnly()&&filtered.length?'<button type="button" class="col-cfg-btn" title="显示、隐藏或调整列">列设置</button>':'';
 tools.querySelector('button')?.addEventListener('click',()=>window.openColumnCfg('pfDealBody'));
}
function renderMonthlyChart(){renderPerfTrendCharts();}
function renderFunnel(){renderPerfInquiryDistribution();}

function barH(items, key) {
  if (!items.length) return '<div class="empty">暂无数据</div>';
  const max = Math.max(...items.map((x) => x[key]));
  return items.map((it) => {
    const pct = max ? Math.round((it[key] / max) * 100) : 0;
    return `<div class="bar-row">
      <span class="lbl" title="${esc(it.label)}">${esc(it.label)}</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <span class="v">${typeof it[key] === 'number' && it[key] > 1000 ? fmtMoney(it[key]) : it[key]}</span>
    </div>`;
  }).join('');
}


$('#perfDate').value=todayStr().slice(0,7);
$('#perfDate').onchange=()=>{if(!$('#perfDate').value)$('#perfDate').value=todayStr().slice(0,7);renderPerformance();};
$('#perfOwner').onchange=loadPerfSales;
$('#pfStatusWeek').onchange=()=>renderPerfStatus(periodMonths(perfPeriod));
$('#perfLarge').oninput=renderPerformance;
$$('#view-performance [data-period]').forEach(b=>b.onclick=()=>{$$('#view-performance [data-period]').forEach(x=>x.classList.toggle('active',x===b));perfPeriod=b.dataset.period;renderPerformance();});
window.loadSales=()=>{refreshPerfOwners();return loadPerfSales();};
window.addEventListener('ftw:dataReady',()=>{refreshPerfOwners();if(perfCompany())loadPerfSales();else renderPerformance();});
['ftw:inquiriesChanged','ftw:ratesReady'].forEach(e=>window.addEventListener(e,()=>{refreshPerfOwners();renderPerformance();}));
window.onViewActivated=((orig)=>function(view){orig?.(view);if(view==='performance'){refreshPerfOwners();renderPerformance();}})(window.onViewActivated);
