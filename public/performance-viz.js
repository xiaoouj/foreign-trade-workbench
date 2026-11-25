// Production series and targets, rendered in the supplied prototype's chart style.
let perfChartMode='chart';
function perfYearData(){const year=$('#perfDate').value.slice(0,4),deals=combinedDeals();return Array.from({length:12},(_,i)=>{const k=year+'-'+String(i+1).padStart(2,'0');return {k,actual:deals.filter(o=>o.month===k&&o.cny!=null).reduce((n,o)=>n+o.cny,0),target:perfTargetReady?Number(salesConfig.yearMonthly?.[k])||0:0};});}
function perfAxisMoney(n){return n>=1e8?(n/1e8).toFixed(1)+'亿':n>=1e4?(n/1e4).toFixed(1)+'万':Math.round(n).toLocaleString();}
function perfPlot(data,cumulative=false){
 let actual=0,target=0;const rows=cumulative?data.map(d=>({...d,actual:actual+=d.actual,target:target+=d.target})):data;
 const W=760,H=260,L=50,R=4,T=24,B=30,w=W-L-R,h=H-T-B,max=Math.max(1,...rows.flatMap(d=>[d.actual,d.target]))*1.12,x=i=>L+w*(i+.5)/12,y=v=>T+h-v/max*h;
 const axes=Array.from({length:5},(_,i)=>{const value=max*i/4;return `<line class="gl" x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}"/><text class="ax" x="${L-8}" y="${y(value)+4}" text-anchor="end">${perfAxisMoney(value)}</text>`;}).join('');
 const targetLine=rows.some(d=>d.target>0)?`<polyline class="tl" points="${rows.map((d,i)=>x(i)+','+y(d.target)).join(' ')}"/>`:'';
 const current=todayStr().slice(0,7),past=rows.filter(d=>d.k<=current||d.actual>0);
 let actualLine='';
 if(cumulative&&past.length){
  const area='M '+past.map((d,i)=>x(i)+' '+y(d.target)).join(' L ')+' L '+past.map((d,i)=>[x(i),y(d.actual)]).reverse().map(p=>p.join(' ')).join(' L ')+' Z';
  actualLine=`<path class="area" d="${area}"/><polyline class="line" points="${past.map((d,i)=>x(i)+','+y(d.actual)).join(' ')}"/>`;
 }
 const marks=rows.map((d,i)=>{
  const future=d.k>current&&d.actual===0,cur=d.k===current,height=Math.max(2,h*d.actual/max),left=x(i)-w/12*.3,label=d.k+' '+(cumulative?'累计':'')+'实绩 '+fmtMoney(d.actual)+'，目标 '+(perfTargetReady?perfTargetMoney(d.target):'读取中');
  const color=future?'fut':d.target>0&&d.actual>=d.target?'hit':cur?'cur':'';
  return `<g tabindex="0" role="button" data-perf-month="${d.k}" aria-label="${esc(label)}；查看该月"><title>${esc(label)}</title>${cumulative?(past.includes(d)?`<circle class="dot" cx="${x(i)}" cy="${y(d.actual)}" r="3.5"/>`:''):`<rect class="bar ${color}" x="${left}" y="${H-B-height}" width="${w/12*.6}" height="${height}" rx="2"/><text class="lab perf-bar-value" x="${x(i)}" y="${H-B-height-6}" text-anchor="middle">${future?'—':perfAxisMoney(d.actual)}</text>`}<text class="ax" x="${x(i)}" y="${H-B+16}" text-anchor="middle">${i+1}月</text>${cur?`<rect class="now" x="${x(i)-10}" y="${H-B+21}" width="20" height="3" rx="1.5"/>`:''}<rect x="${x(i)-w/24}" y="${T}" width="${w/12}" height="${h+B}" fill="transparent"/></g>`;
 }).join('');
 const last=past.at(-1),lastIndex=last?rows.indexOf(last):0;
 const endLabel=cumulative&&last?`<text class="lab" x="${Math.min(W-4,x(lastIndex)+8)}" y="${Math.max(T,y(last.actual)-8)}" text-anchor="end">${perfAxisMoney(last.actual)}</text>`:'';
 return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="group" aria-label="${cumulative?'累计实绩与目标趋势':'每月订单实绩柱状图与目标线'}">${axes}${actualLine}${targetLine}${marks}${endLabel}</svg><div class="tip" hidden role="status"></div>`;
}
function bindPerfMonthCharts(host){
 host.querySelectorAll('[data-perf-month]').forEach(el=>{
  const choose=()=>{$('#perfDate').value=el.dataset.perfMonth;perfPeriod='month';renderPerformance();};
  el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};
  const tip=host.querySelector('.tip');
  const show=()=>{if(!tip)return;tip.textContent=el.getAttribute('aria-label').replace('；查看该月','');const box=host.getBoundingClientRect(),rect=el.getBoundingClientRect();tip.hidden=false;tip.classList.add('show');tip.style.left=Math.max(100,Math.min(box.width-100,rect.left-box.left+rect.width/2))+'px';tip.style.top=Math.max(30,rect.top-box.top)+'px';};
  el.addEventListener('pointerenter',show);el.addEventListener('focus',show);
  el.addEventListener('pointerleave',()=>{if(tip)tip.hidden=true;});el.addEventListener('blur',()=>{if(tip)tip.hidden=true;});
 });
}
function perfDataTable(rows){let actual=0,target=0;return `<div class="tbl-wrap" style="padding:0"><table class="tbl"><thead><tr><th>月份</th><th class="r">实绩</th><th class="r">目标</th><th class="r">完成率</th><th class="r hide-m">累计实绩</th><th class="r hide-m">累计完成率</th></tr></thead><tbody>${rows.map(d=>{actual+=d.actual;target+=d.target;return `<tr${d.k===todayStr().slice(0,7)?' style="background:#fffce0"':''}><td class="numc">${d.k}</td><td class="r numc">${fmtMoney(d.actual)}</td><td class="r numc">${perfTargetReady?fmtMoney(d.target):'读取中'}</td><td class="r numc">${d.target?(d.actual/d.target*100).toFixed(1)+'%':'—'}</td><td class="r numc hide-m">${fmtMoney(actual)}</td><td class="r numc hide-m">${target?(actual/target*100).toFixed(1)+'%':'—'}</td></tr>`;}).join('')}</tbody></table></div>`;}
function renderPerfTrendCharts(){
 const rows=perfYearData(),monthly=$('#pfMonthlyChart'),cumulative=$('#pfCumulative'),isCumulative=perfChartMode==='cumulative';
 $$('#pfChartModes [data-perf-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.perfMode===perfChartMode));b.onclick=()=>{perfChartMode=b.dataset.perfMode;renderPerfTrendCharts();};});
 $('#performance-mleg').innerHTML=perfChartMode==='table'?'':isCumulative?'<span><i style="background:var(--navy-800);height:3px"></i>累计实绩</span><span><i class="dash"></i>累计目标</span><span><i style="background:rgba(41,60,128,.15)"></i>与目标的差距</span>':'<span><i style="background:var(--navy-800)"></i>达到月目标</span><span><i style="background:#b7c0d9"></i>未达到</span><span><i class="dash"></i>月目标 '+(Math.max(...rows.map(r=>r.target))-Math.min(...rows.map(r=>r.target))<.02?perfAxisMoney(rows[0].target):'按月设置')+'</span><span><i style="background:var(--yellow)"></i>本月</span>';
 monthly.hidden=isCumulative;monthly.innerHTML=isCumulative?'':perfChartMode==='table'?perfDataTable(rows):perfPlot(rows);bindPerfMonthCharts(monthly);
 cumulative.hidden=!isCumulative;cumulative.innerHTML=isCumulative?perfPlot(rows,true):'';bindPerfMonthCharts(cumulative);
}
function perfMonthWeeks(month) {
 const first = new Date(month + '-01T00:00:00Z');
 const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
 const date = day => month + '-' + String(day).padStart(2, '0');
 const ranges = [];
 let start = 1;
 let end = Math.min(days, 7 - (first.getUTCDay() + 6) % 7);
 while (start <= days) {
   ranges.push({start: date(start), end: date(end)});
   start = end + 1;
   end = Math.min(days, end + 7);
 }
 return ranges;
}


const perfStatusColors={'生产中':'#2f5bd3','待收尾款':'#9a6200','待发货':'#c68a12','已收款':'#0b8a97','已发货':'#6a4bb8','已完成':'#1b7a4b','新询盘':'#2f5bd3','已报价':'#c68a12','等回复':'#6a4bb8','谈判中':'#0b8a97','成交':'#1b7a4b','暂缓':'#9aa0b2','无效':'#c3c7d1','输单':'#b5bac7'};
function perfStatusSplit(rows,label,extraClass=''){
 const total=rows.reduce((sum,row)=>sum+row.count,0);
 return `<div class="bigline"><b>${total}</b><span>${label}</span></div><div class="split" role="img" aria-label="${esc(label)}状态分布">${rows.filter(row=>row.count).map(row=>`<span style="flex:${row.count};background:${perfStatusColors[row.status]||'#9aa0b2'}" title="${esc(row.status)} ${row.count}"></span>`).join('')}</div><ul class="slist ${extraClass}">${rows.map(row=>`<li><i style="background:${perfStatusColors[row.status]||'#9aa0b2'}"></i><span>${esc(row.status)}</span><strong>${row.count}${extraClass?' 笔':''}</strong><small>${total?(row.count/total*100).toFixed(1)+'%':'—'}</small></li>`).join('')}</ul>`;
}
function renderPerfStatus(months){
 const host=$('#pfStatus'),select=$('#pfStatusWeek');select.hidden=perfCompanySummaryOnly();
 if(select.hidden){host.innerHTML='<div class="empty">切换个人目标可查看订单状态。</div>';return;}
 const month=$('#perfDate').value,weeks=perfMonthWeeks(month);
 if(select.dataset.month!==month){select.dataset.month=month;select.innerHTML='<option value="">所选周期</option>'+weeks.map(({start,end})=>`<option value="${start}">${start.slice(5)} 至 ${end.slice(5)}</option>`).join('');}
 const week=weeks.find(range=>range.start===select.value),orders=combinedDeals().filter(o=>months.includes(o.month)&&(!week||orderDateValue(o)>=week.start&&orderDateValue(o)<=week.end));
 if(!orders.length){host.innerHTML='<div class="empty">所选范围暂无生产及后续订单</div>';return;}
 const counts=new Map();orders.forEach(o=>counts.set(o.status||'未设置',(counts.get(o.status||'未设置')||0)+1));
 host.innerHTML=perfStatusSplit([...counts].map(([status,count])=>({status,count})),'笔生产及后续订单','perf-status-list');
}
function renderPerfInquiryDistribution(){
 const months=periodMonths(perfPeriod),list=perfInquiries().filter(q=>months.includes(String(q.receivedAt||'').slice(0,7)));
 if(!list.length){$('#pfFunnel').innerHTML='<div class="empty">当前周期暂无询盘</div>';return;}
 const counts=new Map();list.forEach(q=>counts.set(q.status||'新询盘',(counts.get(q.status||'新询盘')||0)+1));
 $('#pfFunnel').innerHTML=perfStatusSplit([...counts].map(([status,count])=>({status,count})),'条询盘收到于本周期');
}
