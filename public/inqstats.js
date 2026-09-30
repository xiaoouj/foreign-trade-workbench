// ====== 询盘分析看板（管理员）======
// 汇总全部询盘：本月询盘数、来源分布、成交数、国家分布、流失/搁置客户数。
// 数据来自 window.getAllInquiries()（服务端已按 RBAC 过滤；管理员可见全部）。
// 本视图按钮带 data-admin-only，仅管理员可见。

const INQ_LOST = ['输单', '无效', '暂缓']; // 视为流失 / 搁置

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

function renderRanking(id, rows, label) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  el.innerHTML = '<div class="isb-rank-head"><span>' + label + '</span><span>询盘</span><span>成交</span><span>转化</span></div>' + rows.slice(0, 10).map((r, i) => `<div class="isb-rank-row"><b>${i + 1}</b><span class="isb-rank-name">${esc(r.label)}</span><span>${r.total}</span><span>${r.won}</span><strong>${r.rate}%</strong></div>`).join('');
}

function renderTrend(inqs) {
 const months=[...new Set(inqs.map(q=>String(q.receivedAt||'').slice(0,7)).filter(m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m)))].sort();
 const vals=months.map(month=>({month,total:inqs.filter(q=>q.receivedAt?.slice(0,7)===month).length,won:inqs.filter(q=>q.receivedAt?.slice(0,7)===month&&q.status==='成交').length})),max=Math.max(1,...vals.map(v=>v.total));
 $('#isbTrend').innerHTML=vals.length?vals.map(x=>`<div class="isb-trend-col"><div class="isb-trend-bars"><i style="height:${x.total/max*100}%" title="询盘 ${x.total}"></i><em style="height:${x.won/max*100}%" title="成交 ${x.won}"></em></div><span>${x.month}</span><small>${x.total} / ${x.won}</small></div>`).join(''):'<div class="empty">无有效日期数据</div>';
}
function isbFilterOptions(id,label,options){const el=$('#'+id),value=el.value;el.innerHTML=`<option value="">${label}</option>`+options.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');el.value=value;el.onchange=renderInqStatsBoard;}
function isbIssues(q){return [!analyticsValidDate(q.receivedAt)?'收到日期缺失或无效':'',!q.owner?'未分配负责人':'',q.status==='成交'&&!(Number(q.expectedAmount)>0)?'成交金额缺失':'',q.nextFollowAt&&q.nextFollowAt<todayStr()&&!['成交','输单','无效','暂缓'].includes(q.status)?'跟进逾期':''].filter(Boolean);}
function renderInqStatsBoard() {
  const all = (window.getAllInquiries ? window.getAllInquiries() : []) || [];
  if(!$('#isbOwnerFilter'))return;
  const unique=(key)=>[...new Set(all.map(q=>String(q[key]||'未填')))].sort().map(v=>[v,v]);
  const owners=new Map(all.map(q=>[orderOwnerKey(q),clientOwnerLabel(q)+(q.owner?' ('+((allUsers.find(u=>u.id===q.owner)||{}).username||q.owner)+')':'')]));
  isbFilterOptions('isbOwnerFilter','全部负责人',[...owners]);
  isbFilterOptions('isbYearFilter','全部年份',[...new Set(all.map(q=>(q.receivedAt||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort().reverse().map(v=>[v,v+' 年']));
  for(const [id,key,label] of [['isbSourceFilter','source','全部来源'],['isbCountryFilter','country','全部国家'],['isbStatusFilter','status','全部状态']])isbFilterOptions(id,label,unique(key));
  $('#isbMonthFilter').onchange=renderInqStatsBoard;
  $('#isbReset').onclick=()=>{$$('#isbFilters select').forEach(s=>s.value='');renderInqStatsBoard();};
  const val=id=>$('#'+id).value;
  const inqs=all.filter(q=>(!(val('isbYearFilter')||val('isbMonthFilter'))||analyticsValidDate(q.receivedAt))&&(!val('isbOwnerFilter')||orderOwnerKey(q)===val('isbOwnerFilter'))&&(!val('isbYearFilter')||(q.receivedAt||'').slice(0,4)===val('isbYearFilter'))&&(!val('isbMonthFilter')||(q.receivedAt||'').slice(5,7)===val('isbMonthFilter'))&&(!val('isbSourceFilter')||(q.source||'未填')===val('isbSourceFilter'))&&(!val('isbCountryFilter')||(q.country||'未填')===val('isbCountryFilter'))&&(!val('isbStatusFilter')||(q.status||'未填')===val('isbStatusFilter')));

  const month = (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10)).slice(0, 7);
  const total = inqs.length;
  const monthInqs = inqs.filter((q) => (q.receivedAt || '').slice(0, 7) === month);
  const won = inqs.filter((q) => (q.status || '') === '成交');
  const lost = inqs.filter((q) => INQ_LOST.includes(q.status || ''));
  const prevMonth = new Date(new Date(month + '-01').getTime() - 86400000).toISOString().slice(0, 7);
  const prevMonthInqs = inqs.filter((q) => (q.receivedAt || '').slice(0, 7) === prevMonth);
  const rate = total ? Math.round((won.length / total) * 100) : 0;
  const pending = inqs.filter((q) => !['成交', '输单', '无效', '暂缓'].includes(q.status || '')).length;
  const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
  const follow = inqs.filter((q) => q.nextFollowAt && q.nextFollowAt <= today && !['成交', '输单', '无效', '暂缓'].includes(q.status || '')).length;
  const overdue = inqs.filter((q) => q.nextFollowAt && q.nextFollowAt < today && !['成交', '输单', '无效', '暂缓'].includes(q.status || '')).length;
  setText('isbMonth', total);
  setText('isbPending', pending);
  setText('isbWon', won.length);
  setText('isbRate', '成交率 ' + rate + '%');
  setText('isbFollow', follow);
  setText('isbOverdue', '逾期 ' + overdue + ' 条');
  setText('isbLost', '流失/搁置 ' + lost.length);
  setText('isbTotal', inqs.filter(q=>isbIssues(q).length).length);
  setText('isbMonthTrend', '当前筛选 / 可见总数 '+total+' / '+all.length);

  const stageOrder = ['新询盘', '已报价', '等回复', '谈判中', '成交'];
  const funnel = document.getElementById('isbFunnel');
  if (funnel) {
    funnel.innerHTML = stageOrder.map((st, i) => {
      const n = inqs.filter((q) => (q.status || '新询盘') === st).length;
      const pct = total ? Math.round(n / total * 100) : 0;
      return `<div class="isb-funnel-row"><span class="isb-funnel-label">${st}</span><span class="isb-funnel-bar"><i style="width:${Math.max(n ? 5 : 0, pct)}%"></i></span><b>${n}</b><em>${pct}%</em></div>`;
    }).join('');
  }
  renderTrend(inqs, month);

  // 来源转化效果
  const srcMap = {};
  inqs.forEach((q) => { const k = q.source || '未填'; if (!srcMap[k]) srcMap[k] = { total: 0, won: 0 }; srcMap[k].total++; if (q.status === '成交') srcMap[k].won++; });
  const srcList = Object.entries(srcMap).map(([label, v]) => ({ label, ...v, rate: v.total ? Math.round(v.won / v.total * 100) : 0 })).sort((a, b) => b.rate - a.rate || b.total - a.total);
  renderRanking('isbSourceTable', srcList, '来源');

  const ownerMap = {};
  inqs.forEach((q) => { const k = orderOwnerKey(q); if (!ownerMap[k]) ownerMap[k] = { total: 0, won: 0 }; ownerMap[k].total++; if (q.status === '成交') ownerMap[k].won++; });
  const ownerList = Object.entries(ownerMap).map(([label, v]) => ({ label: owners.get(label)||label, ...v, rate: v.total ? Math.round(v.won / v.total * 100) : 0 })).sort((a, b) => b.won - a.won || b.rate - a.rate);
  renderRanking('isbOwnerTable', ownerList, '业务员');

  // 国家分布（Top 12）
  const coMap = {};
  inqs.forEach((q) => { const k = q.country || '未填'; coMap[k] = (coMap[k] || 0) + 1; });
  const coList = Object.entries(coMap).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 12);
  const cc = document.getElementById('isbCountryChart');
  if (cc) cc.innerHTML = (typeof barH === 'function') ? barH(coList, 'count') : '';

  // 状态分布
  const stMap = {};
  inqs.forEach((q) => { const k = q.status || '新询盘'; stMap[k] = (stMap[k] || 0) + 1; });
  const stList = Object.entries(stMap).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count);
  const stc = document.getElementById('isbStatusChart');
  if (stc) stc.innerHTML = (typeof barH === 'function') ? barH(stList, 'count') : '';
  const detail=inqs.slice().sort((a,b)=>Number(isbIssues(b).includes('跟进逾期'))-Number(isbIssues(a).includes('跟进逾期'))||(Number(b.expectedAmount)||0)-(Number(a.expectedAmount)||0));
  $('#isbDetails').innerHTML=detail.length?`<table class="data-table"><thead><tr><th>客户 / 收到日期</th><th>负责人</th><th>状态 / 金额</th><th>提醒</th></tr></thead><tbody>${detail.map(q=>`<tr><td><button type="button" class="order-detail-link" data-isb-id="${esc(q.id)}">${esc(q.clientName||q.contactName||'未填客户')}</button><br>${esc(q.receivedAt||'无日期')}</td><td>${esc(clientOwnerLabel(q))}</td><td>${esc(q.status||'新询盘')}<br>${esc(q.expectedAmount||'—')} ${esc(q.currency||'')}</td><td>${isbIssues(q).map(x=>`<span class="analytics-flag issue">${esc(x)}</span>`).join('')||'—'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">当前筛选无询盘</div>';
  $('#isbDetails').querySelectorAll('[data-isb-id]').forEach(b=>b.onclick=()=>window.openInqModal?.(b.dataset.isbId));

}

// 数据就绪后首渲染
window.addEventListener('ftw:dataReady', () => { renderInqStatsBoard(); });

// 进入本视图时强制重算（与 performance.js 同样的 wrap 模式）
window.onViewActivated = (function (orig) {
  return function (view) {
    if (typeof orig === 'function') orig(view);
    if (view === 'inqstats') renderInqStatsBoard();
  };
})(window.onViewActivated);

window.addEventListener('ftw:inquiriesChanged',renderInqStatsBoard);
