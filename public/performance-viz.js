// Charts use the same filtered orders, exchange rates and target scope as the KPI cards.
let perfChartMode='chart';
function perfYearData(){const year=$('#perfDate').value.slice(0,4),deals=combinedDeals();return Array.from({length:12},(_,i)=>{const k=year+'-'+String(i+1).padStart(2,'0');return {k,actual:deals.filter(o=>o.month===k&&o.cny!=null).reduce((n,o)=>n+o.cny,0),target:perfTargetReady?Number(salesConfig.yearMonthly?.[k])||0:0};});}
function perfAxisMoney(n){return n>=1e8?(n/1e8).toFixed(1)+'亿':n>=1e4?(n/1e4).toFixed(1)+'万':Math.round(n).toLocaleString();}
function perfPlot(data,cumulative=false){
 let a=0,t=0;const rows=cumulative?data.map(d=>({...d,actual:a+=d.actual,target:t+=d.target})):data;
 const W=760,H=280,L=64,R=20,T=20,B=40,w=W-L-R,h=H-T-B,max=Math.max(1,...rows.flatMap(d=>[d.actual,d.target]))*1.1;
 const x=i=>L+w*(i+.5)/12,y=v=>T+h-v/max*h;
 const axis=Array.from({length:5},(_,i)=>{const v=max*i/4;return `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e7edf5"/><text x="${L-9}" y="${y(v)+4}" text-anchor="end">${perfAxisMoney(v)}</text>`;}).join('');
 const target=rows.some(d=>d.target>0)?`<polyline fill="none" stroke="#f0a449" stroke-width="2" stroke-dasharray="6 5" points="${rows.map((d,i)=>x(i)+','+y(d.target)).join(' ')}"/>`:'';
 const actualLine=cumulative?`<path d="M ${x(0)} ${T+h} ${rows.map((d,i)=>'L '+x(i)+' '+y(d.actual)).join(' ')} L ${x(11)} ${T+h} Z" fill="#edf4ff"/><polyline fill="none" stroke="#2870ee" stroke-width="3" points="${rows.map((d,i)=>x(i)+','+y(d.actual)).join(' ')}"/>`:'';
 const marks=rows.map((d,i)=>{const label=`${d.k} ${cumulative?'累计':''}实绩 ${fmtMoney(d.actual)}，目标 ${perfTargetReady?perfTargetMoney(d.target):'读取中'}`;return `<g tabindex="0" role="button" data-perf-month="${d.k}" aria-label="${esc(label)}；查看该月"><title>${esc(label)}</title>${cumulative?`<circle cx="${x(i)}" cy="${y(d.actual)}" r="4" fill="#2870ee" stroke="white" stroke-width="2"/>`:`<rect x="${x(i)-w/36}" y="${y(d.actual)}" width="${w/18}" height="${d.actual?T+h-y(d.actual):1}" rx="3" fill="${periodMonths(perfPeriod).includes(d.k)?'#2563eb':'#a5c7ff'}"/>`}<rect x="${x(i)-w/24}" y="${T}" width="${w/12}" height="${h+B}" fill="transparent"/><text x="${x(i)}" y="${H-15}" text-anchor="middle">${i+1}月</text></g>`;}).join('');
 return `<div class="perf-chart-legend"><span><i></i>${cumulative?'累计实绩':'月度实绩'}</span><span><i class="target"></i>${cumulative?'累计目标':'月度目标'}</span><small>单位：CNY · 点击月份查看明细</small></div><div class="perf-svg-scroll"><svg class="perf-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${cumulative?'累计实绩与目标趋势':'每月订单实绩柱状图与目标线'}">${axis}${actualLine}${target}${marks}</svg></div>`;
}
function bindPerfMonthCharts(host){host.querySelectorAll('[data-perf-month]').forEach(el=>{const choose=()=>{$('#perfDate').value=el.dataset.perfMonth;perfPeriod='month';$$('#view-performance [data-period]').forEach(b=>b.classList.toggle('active',b.dataset.period==='month'));renderPerformance();};el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};});}
function perfDataTable(rows,cumulative=false){let a=0,t=0;return `<div class="table-wrap"><table class="data-table"><thead><tr><th>月份</th><th>${cumulative?'累计':''}实绩 CNY</th><th>${cumulative?'累计':''}目标 CNY</th><th>完成率</th></tr></thead><tbody>${rows.map(d=>{const actual=cumulative?(a+=d.actual):d.actual,target=cumulative?(t+=d.target):d.target;return `<tr><td>${d.k}</td><td>${fmtMoney(actual)}</td><td>${perfTargetReady?perfTargetMoney(target):'读取中'}</td><td>${target?(actual/target*100).toFixed(1)+'%':'—'}</td></tr>`;}).join('')}</tbody></table></div>`;}
function renderPerfTrendCharts(){
 const rows=perfYearData(),host=$('#pfMonthlyChart');host.innerHTML=`<div class="perf-mode"><button data-perf-mode="chart" aria-pressed="${perfChartMode==='chart'}">图表</button><button data-perf-mode="table" aria-pressed="${perfChartMode==='table'}">数据表</button></div>`+(perfChartMode==='chart'?perfPlot(rows):perfDataTable(rows));
 host.querySelectorAll('[data-perf-mode]').forEach(b=>b.onclick=()=>{perfChartMode=b.dataset.perfMode;renderPerfTrendCharts();});bindPerfMonthCharts(host);
 $('#pfCumulative').innerHTML=perfPlot(rows,true)+`<details class="perf-data-details"><summary>查看累计数据表</summary>${perfDataTable(rows,true)}</details>`;bindPerfMonthCharts($('#pfCumulative'));
}
function renderPerfStatus(months){
 const host=$('#pfStatus');if(perfCompanySummaryOnly()){host.innerHTML='<div class="empty">公司视图仅提供金额汇总；切换个人目标查看订单状态。</div>';return;}
 const list=combinedDeals().filter(o=>months.includes(o.month)),map=new Map();list.forEach(o=>map.set(o.status||'未设置',(map.get(o.status||'未设置')||0)+1));
 if(!list.length){host.innerHTML='<div class="empty">当前周期暂无订单</div>';return;}
 const colors=['#2563eb','#4f9cf9','#25a68c','#f0ad4e','#9b86d8','#8297b1'];let offset=0;
 const segments=[...map].map(([label,count],i)=>{const length=count/list.length*100,seg=`<circle cx="70" cy="70" r="52" fill="none" stroke="${colors[i%colors.length]}" stroke-width="15" pathLength="100" stroke-dasharray="${length} ${100-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${esc(label)}：${count} 笔</title></circle>`;offset+=length;return seg;}).join('');
 host.innerHTML=`<div class="perf-status-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="共 ${list.length} 笔未取消订单的状态分布">${segments}<text x="70" y="68" text-anchor="middle" class="perf-ring-count">${list.length}</text><text x="70" y="87" text-anchor="middle" class="perf-ring-unit">笔订单</text></svg><ul>${[...map].map(([label,count],i)=>`<li><i style="background:${colors[i%colors.length]}"></i><span>${esc(label)}</span><strong>${count}</strong><small>${(count/list.length*100).toFixed(1)}%</small></li>`).join('')}</ul></div><p class="muted">按订单笔数统计 · 已取消订单不计入</p>`;
}
function renderPerfInquiryDistribution(){
 const months=periodMonths(perfPeriod),list=perfInquiries().filter(q=>months.includes(String(q.receivedAt||'').slice(0,7))),labels=[...new Set(['新询盘','已报价','等回复','谈判中','成交',...list.map(q=>q.status||'未设置')])],colors=['#a6c8ff','#5897fa','#efbc62','#9280dc','#2ba68b','#9aaabd'];
 if(!list.length){$('#pfFunnel').innerHTML='<div class="empty">当前周期暂无询盘</div>';return;}
 const counts=labels.map(label=>({label,count:list.filter(q=>(q.status||'未设置')===label).length}));
 $('#pfFunnel').innerHTML=`<div class="perf-inquiry-total"><strong>${list.length}</strong><span>本周期收到的询盘</span></div><div class="perf-stacked" role="img" aria-label="询盘当前状态分布">${counts.map((d,i)=>`<span style="width:${d.count/list.length*100}%;background:${colors[i%colors.length]}" title="${esc(d.label)}：${d.count}"></span>`).join('')}</div><div class="perf-inquiry-legend">${counts.map((d,i)=>`<div><span><i style="background:${colors[i%colors.length]}"></i>${esc(d.label)}</span><strong>${d.count}<small> · ${(d.count/list.length*100).toFixed(1)}%</small></strong></div>`).join('')}</div><p class="muted">展示当前状态占比，不代表逐阶段转化率。</p>`;
}
