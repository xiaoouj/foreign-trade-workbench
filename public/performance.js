// 业绩口径：未取消订单；成交询盘仅作为独立参考，避免重复计入。
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
 return perfRows().filter(o=>!['已取消','Cancelled'].includes(o.status)).map(o=>({...o,month:orderMonth(o),client:o.clientName||'未填客户',cny:dealValue(o),kind:'order'}));}
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
function renderPerformance(){
 if(!$('#perfDate'))return;
 const months=periodMonths(perfPeriod),set=new Set(months),target=periodTarget(),deals=combinedDeals(),list=deals.filter(o=>set.has(o.month)),actual=list.reduce((n,o)=>n+(o.cny||0),0),rate=target?actual/target*100:0;
 $('#pfTarget').textContent=perfTargetReady?(target?perfTargetMoney(target):'未设置'):'读取中';$('#pfActual').textContent=fmtMoney(actual);$('#pfRate').textContent=perfTargetReady&&target?rate.toFixed(1)+'%':'—';
 $('#pfDelta').textContent=perfTargetReady&&target?(actual>=target?'超额 ':'还差 ')+fmtMoney(Math.abs(target-actual)):'—';
 $('#perfEditTarget').disabled=!perfTargetReady||!salesConfig.canEdit;
 $('#perfEditTarget').textContent=perfCompany()?'⚙ 设置公司全年目标':'⚙ 设置我的目标';
 $('#perfEditTarget').style.display=perfTargetReady&&!salesConfig.canEdit?'none':'';
 const budget=salesConfig.budget?.[months[0].slice(0,4)]||{company:0,allocated:0,remaining:0};
 $('#perfBudget').textContent=`${months[0].slice(0,4)} 年 · 公司目标 ${perfTargetMoney(budget.company)} · 个人合计 ${perfTargetMoney(budget.allocated)} · 尚可订立 ${perfTargetMoney(Math.max(0,budget.remaining))}${budget.remaining<0?' · 历史个人目标已超额，请各成员调整':''}`;
 const missed=list.filter(o=>o.cny==null).length,undated=deals.filter(o=>!o.month).length;
 $('#pfBreakdown').textContent=`${months[0]} 至 ${months.at(-1)} · ${list.length} 笔未取消订单，按下单日期统计（缺失时用创建日期）。目标：${perfCompany()?'公司全年目标':clientOwnerLabel({owner:perfOwner()})+'的个人目标'}。${missed?' '+missed+' 笔金额或汇率异常未计金额。':''}${undated?' '+undated+' 笔日期异常未纳入周期。':''}成交询盘不重复计入。`;
 $('#pfRing').innerHTML=`<div class="analytics-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,rate)}"><i style="width:${Math.min(100,rate)}%"></i></div><strong>${target&&perfTargetReady?rate.toFixed(1)+'%':'尚未设置目标'}</strong>`;
 $('#pfRingLabel').textContent=target&&perfTargetReady?(actual>=target?'已达成目标':'当前周期目标进度'):'点击「设置目标」填写本周期总额';
 const threshold=Number($('#perfLarge').value)||100000;
 const alerts=o=>[!o.month?'日期缺失或无效':'',o.cny==null?'金额或汇率异常':'',o.deliveryDate&&o.deliveryDate<todayStr()&&!['已发货','已收款','已完成','已取消'].includes(o.status)?'交期已过，尚未发货':''].filter(Boolean);
 const rows=perfCompanySummaryOnly()?[]:[...list,...deals.filter(o=>!o.month)].sort((a,b)=>(b.cny||0)-(a.cny||0));
 $('#pfDeals').innerHTML=rows.length?`<table class="data-table"><thead><tr><th>订单 / 客户</th><th>负责人</th><th>折合 CNY</th><th>标记</th></tr></thead><tbody>${rows.map(o=>`<tr><td><button type="button" class="order-detail-link" data-perf-order="${esc(o.id)}">${esc(o.orderNo||'未填单号')}</button><br>${esc(o.client)}</td><td>${esc(clientOwnerLabel(o))}</td><td class="amount">${o.cny==null?'待核对':fmtMoney(o.cny)}</td><td>${o.cny>=threshold?'<span class="analytics-flag large">大单</span>':''}${alerts(o).map(x=>`<span class="analytics-flag issue">${esc(x)}</span>`).join('')|| (o.cny>=threshold?'':'—')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">当前筛选无订单</div>';
 $('#pfDeals').querySelectorAll('[data-perf-order]').forEach(b=>b.onclick=()=>openOrderDetail(b.dataset.perfOrder));
 $('#pfAlertSummary').textContent=`大单 ${list.filter(o=>o.cny>=threshold).length} 笔 · 异常 ${rows.filter(o=>alerts(o).length).length} 笔（含日期异常）`;
 renderMonthlyChart();
 renderPerfStatus(months);
 if(perfCompanySummaryOnly()){
   const rows=months.map(m=>salesConfig.actual?.monthly?.[m]).filter(Boolean),count=rows.reduce((n,r)=>n+r.count,0),invalid=rows.reduce((n,r)=>n+r.invalidCount,0);
   $('#pfBreakdown').textContent=`${months[0]} 至 ${months.at(-1)} · 公司 ${count} 笔未取消订单汇总 · 所有人查看同一公司目标与实绩。${invalid?' '+invalid+' 笔金额异常未计入。':''}${missed?' 部分币种汇率不可用，金额未计入。':''}${salesConfig.actual?.undatedCount?' '+salesConfig.actual.undatedCount+' 笔日期异常未计入周期。':''}`;
   $('#pfDeals').innerHTML='<div class="empty">公司视图展示汇总数据。切换个人目标可查看有权限访问的订单明细。</div>';
   $('#pfAlertSummary').textContent='公司汇总';
   $('#pfClientChart').innerHTML='<div class="empty">客户分布请在个人视图查看</div>';
   $('#pfFunnel').innerHTML='<div class="empty">询盘分布请在个人视图查看</div>';
 }else{renderClientChart(months);renderFunnel();}
}
function renderMonthlyChart(){renderPerfTrendCharts();}

function renderClientChart(months){const map=new Map();combinedDeals().filter(o=>months.includes(o.month)&&o.cny!=null).forEach(o=>map.set(o.client,(map.get(o.client)||0)+o.cny));$('#pfClientChart').innerHTML=barH([...map].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count).slice(0,10),'count');}
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
$('#perfLarge').oninput=renderPerformance;
$$('#view-performance [data-period]').forEach(b=>b.onclick=()=>{$$('#view-performance [data-period]').forEach(x=>x.classList.toggle('active',x===b));perfPeriod=b.dataset.period;renderPerformance();});
window.loadSales=()=>{refreshPerfOwners();return loadPerfSales();};
window.addEventListener('ftw:dataReady',()=>{refreshPerfOwners();if(perfCompany())loadPerfSales();else renderPerformance();});
['ftw:inquiriesChanged','ftw:ratesReady'].forEach(e=>window.addEventListener(e,()=>{refreshPerfOwners();renderPerformance();}));
window.onViewActivated=((orig)=>function(view){orig?.(view);if(view==='performance'){refreshPerfOwners();renderPerformance();}})(window.onViewActivated);
