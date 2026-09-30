/* ============================================================
   SalesFlow — 集成外贸人工作台真实数据
   调用 CRM 现有 REST 接口（/api/clients, /api/orders,
   /api/inquiries, /api/sales, /api/users, /api/me），
   复用同一登录会话（cookie / Bearer），无需改动后端。
   ============================================================ */
'use strict';

const STATE = { clients: [], orders: [], inquiries: [], sales: {}, users: [], search: '' };
let currentView = 'dashboard';

/* ---------- API ---------- */
async function api(path) {
  const headers = {};
  const t = localStorage.getItem('ftw_token');
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(path, { headers, credentials: 'same-origin' });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function safeApi(path) { try { return await api(path); } catch (e) { return null; } }

/* ---------- 工具 ---------- */
const $ = (s) => document.querySelector(s);
const CNY = '¥', USD = '$';
function money(n, cur) {
  n = Number(n) || 0;
  const s = n.toLocaleString('zh-CN');
  return (cur === 'USD' ? USD : CNY) + s;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function initial(name) { return (esc(name || '?')).slice(0, 1).toUpperCase(); }
function avatarColor(seed) {
  const pal = ['#5d87ff', '#0e9488', '#7a6bff', '#e0760a', '#16a34a', '#db2777', '#0891b2'];
  let h = 0; for (const c of String(seed || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pal[h % pal.length];
}
function roleLabel(r) { return ({ admin: '管理员', manager: '经理', sales: '销售' }[r] || '销售'); }

/* 状态 → 标签样式 */
function statusPill(s) {
  s = String(s || '');
  if (/已收款|成交|赢单/.test(s)) return '<span class="pill pill--success"><span class="d"></span>' + esc(s) + '</span>';
  if (/已发货|已确认|跟进中|谈判/.test(s)) return '<span class="pill pill--info"><span class="d"></span>' + esc(s) + '</span>';
  if (/等回复|待|逾期|预警|暂缓/.test(s)) return '<span class="pill pill--warning"><span class="d"></span>' + esc(s) + '</span>';
  if (/流失|失败|作废|无效/.test(s)) return '<span class="pill pill--danger"><span class="d"></span>' + esc(s) + '</span>';
  return '<span class="pill pill--neutral"><span class="d"></span>' + esc(s || '未知') + '</span>';
}

/* ---------- 登录 ---------- */
function showLogin() { window.__ftwNoticeUser = null; document.dispatchEvent(new Event('ftw:session-change'));  $('#loginOverlay').style.display = 'grid'; }
async function doLogin() {
  const u = $('#loginUser').value.trim();
  const p = $('#loginPw').value;
  const err = $('#loginErr');
  err.style.display = 'none';
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }), credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || '登录失败'; err.style.display = 'block'; return; }
    localStorage.setItem('ftw_token', data.token);
    $('#loginOverlay').style.display = 'none';
    init();
  } catch (e) { err.textContent = '网络错误：' + e.message; err.style.display = 'block'; }
}

/* ---------- 启动 ---------- */
async function init() {
  let me = null;
  try { me = await api('/api/me'); } catch (e) { return; } // 401 时 api 已弹出登录
  if (me) {
    window.__ftwNoticeUser = { id: me.id };
    document.dispatchEvent(new Event('ftw:session-change'));
    $('#sideName').textContent = me.name || me.username;
    $('#sideRole').textContent = roleLabel(me.role);
    $('#sideAvatar').textContent = initial(me.name || me.username);
  }
  await loadAll();
}

async function loadAll() {
  showLoading();
  const [clients, orders, inquiries, sales, users] = await Promise.all([
    safeApi('/api/clients'), safeApi('/api/orders'), safeApi('/api/inquiries'),
    safeApi('/api/sales'), safeApi('/api/users')
  ]);
  STATE.clients = clients || [];
  STATE.orders = orders || [];
  STATE.inquiries = inquiries || [];
  STATE.sales = sales || {};
  STATE.users = users || [];
  $('#badgeLeads').textContent = STATE.inquiries.length;
  $('#badgeClients').textContent = STATE.clients.length;
  renderView(currentView);
}
function showLoading() { $('#content').innerHTML = '<div class="loading">正在从外贸人工作台加载真实数据…</div>'; }

/* ---------- 视图渲染 ---------- */
function renderView(v) {
  currentView = v;
  document.querySelectorAll('.nav-item[data-view]').forEach((n) => n.classList.toggle('active', n.dataset.view === v));
  const titles = { dashboard: ['仪表盘', '工作台 / 概览'], leads: ['线索', '销售 / 线索'], pipeline: ['商机看板', '销售 / 商机看板'], clients: ['客户', '客户 / 全部客户'] };
  $('#pageTitle').textContent = titles[v][0];
  $('#crumb').textContent = titles[v][1];
  const map = { dashboard: renderDashboard, leads: renderLeads, pipeline: renderPipeline, clients: renderClients };
  (map[v] || renderDashboard)();
}

function renderDashboard() {
  const c = STATE.clients, o = STATE.orders, i = STATE.inquiries, s = STATE.sales;
  const monthNow = new Date().toISOString().slice(0, 7);
  let teamMonth = 0;
  Object.values(s).forEach((u) => { if (u && u.yearMonthly && u.yearMonthly[monthNow]) teamMonth += Number(u.yearMonthly[monthNow]); });
  const kpis = [
    { label: '客户总数', val: c.length, ico: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', sub: '已建档客户' },
    { label: '进行中商机', val: o.length, ico: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="6" cy="18" r="3"/><line x1="18" y1="3" x2="18" y2="9"/><circle cx="18" cy="12" r="3"/><line x1="6" y1="15" x2="18" y2="12"/>', sub: '订单 / 商机' },
    { label: '线索总数', val: i.length, ico: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>', sub: '询盘 / 线索' },
    { label: '本月团队销售额', val: money(teamMonth), ico: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', sub: monthNow }
  ];
  const kpiHtml = kpis.map((k) => `
    <div class="card kpi">
      <div class="top"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${k.ico}</svg></div></div>
      <div><div class="label">${k.label}</div><div class="val">${k.val}</div></div>
      <div class="delta up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>${esc(k.sub)}</div>
    </div>`).join('');

  const chart = buildTrendChart(s);
  const funnel = buildOrderFunnel(o);

  const recent = [...o].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  const recentHtml = recent.length ? `
    <table><thead><tr><th>客户 / 单号</th><th>状态</th><th>负责人</th><th>金额</th><th>币种</th></tr></thead><tbody>
    ${recent.map((r) => `
      <tr><td><div class="cell-name"><div class="av-sm" style="background:${avatarColor(r.clientName)}">${initial(r.clientName)}</div><div>${esc(r.clientName)}<div class="cell-sub">${esc(r.orderNo || '')}</div></div></div></td>
      <td>${statusPill(r.status)}</td><td>${esc(r.ownerName || r.owner || '—')}</td>
      <td class="amount">${money(r.amount, r.currency)}</td><td class="muted">${esc(r.currency || 'CNY')}</td></tr>`).join('')}
    </tbody></table>` : emptyState('暂无订单数据');

  $('#content').innerHTML = `
    <div class="kpi-grid">${kpiHtml}</div>
    <div class="grid-2">
      <div class="card card-pad">
        <div class="section-head"><h3>团队销售趋势</h3><span class="link" id="refreshBtn2" style="cursor:pointer">数据来自 sales.json</span></div>
        ${chart}
      </div>
      <div class="card card-pad">
        <div class="section-head"><h3>商机阶段分布</h3></div>
        ${funnel}
      </div>
    </div>
    <div class="card table-wrap card-pad">
      <div class="section-head"><h3>近期商机</h3><span class="link" data-go="pipeline">全部商机 →</span></div>
      ${recentHtml}
    </div>`;
  $('#content').querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => renderView(el.dataset.go)));
}

/* 销售趋势图（SVG 面积图，来自 sales.json 团队月度汇总） */
function buildTrendChart(sales) {
  const monthMap = {};
  Object.values(sales || {}).forEach((u) => {
    if (!u || !u.yearMonthly) return;
    Object.entries(u.yearMonthly).forEach(([m, v]) => { monthMap[m] = (monthMap[m] || 0) + Number(v); });
  });
  const months = Object.keys(monthMap).sort();
  if (months.length < 1) return emptyState('暂无销售数据');
  const vals = months.map((m) => monthMap[m]);
  const W = 560, H = 220, padL = 40, padR = 15, padT = 20, padB = 30;
  const maxV = Math.max(...vals, 1);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = months.length;
  const x = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v) => padT + innerH - (v / maxV) * innerH;
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${pts[0]} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${padT + innerH} L${padL},${padT + innerH} Z`;
  const labels = months.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="10" fill="var(--text-3)" text-anchor="middle">${esc(m.slice(2))}</text>`).join('');
  const lastX = x(n - 1), lastY = y(vals[n - 1]);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="220" preserveAspectRatio="none">
    <defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--brand-500)" stop-opacity=".28"/>
      <stop offset="100%" stop-color="var(--brand-500)" stop-opacity="0"/></linearGradient></defs>
    <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--border)" stroke-width="1"/>
    <path d="${area}" fill="url(#gArea)"/>
    <polyline fill="none" stroke="var(--brand-500)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(' ')}"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="5" fill="var(--brand-500)" stroke="var(--bg-surface)" stroke-width="2"/>
    ${labels}
  </svg>`;
}

/* 商机阶段漏斗（按订单 status 计数） */
function buildOrderFunnel(orders) {
  const cnt = {};
  orders.forEach((o) => { const k = o.status || '其他'; cnt[k] = (cnt[k] || 0) + 1; });
  const entries = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return emptyState('暂无商机');
  const max = Math.max(...entries.map((e) => e[1]));
  const colors = ['', 's2', 's3', 's4', 's5'];
  return `<div class="funnel">${entries.map(([k, v], idx) => `
    <div class="fn-row"><div class="fn-label">${esc(k)}</div>
    <div class="fn-bar-wrap"><div class="fn-bar ${colors[idx % colors.length]}" style="width:${(v / max * 100).toFixed(0)}%">${v}</div></div></div>`).join('')}</div>`;
}

function renderLeads() {
  const q = STATE.search.toLowerCase();
  const list = STATE.inquiries.filter((x) =>
    !q || [x.clientName, x.contactName, x.country, x.source, x.product, x.owner].join(' ').toLowerCase().includes(q));
  const rows = list.length ? list.map((x) => `
    <tr><td><div class="cell-name"><div class="av-sm" style="background:${avatarColor(x.clientName)}">${initial(x.clientName)}</div><div>${esc(x.clientName)}<div class="cell-sub">${esc(x.contactName || '')}</div></div></div></td>
    <td>${esc(x.country || '—')}</td><td>${esc(x.source || '—')}</td><td>${esc(x.product || '—')}</td>
    <td>${statusPill(x.status)}</td><td class="amount">${money(x.expectedAmount, x.currency)}</td>
    <td>${esc(x.owner || '—')}</td><td class="muted">${esc(x.nextFollowAt || '—')}</td></tr>`).join('')
    : emptyState('没有匹配的线索');
  $('#content').innerHTML = `
    <div class="toolbar">
      <span class="chip active">全部 ${STATE.inquiries.length}</span>
      <span class="chip">待跟进 ${STATE.inquiries.filter((x) => x.nextFollowAt).length}</span>
      <span class="chip">已成交 ${STATE.inquiries.filter((x) => /成交/.test(x.status || '')).length}</span>
      <div class="spacer"></div>
      <span class="muted">共 ${list.length} 条</span>
    </div>
    <div class="card table-wrap card-pad">
      <table><thead><tr><th>客户 / 联系人</th><th>国家</th><th>来源</th><th>产品</th><th>状态</th><th>预计金额</th><th>负责人</th><th>下次跟进</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
}

function renderPipeline() {
  const q = STATE.search.toLowerCase();
  const list = STATE.orders.filter((o) =>
    !q || [o.clientName, o.orderNo, o.ownerName, o.notes].join(' ').toLowerCase().includes(q));
  const groups = {};
  list.forEach((o) => { const k = o.status || '其他'; (groups[k] = groups[k] || []).push(o); });
  const order = ['已收款', '已发货', '已确认', '待确认', '草稿', '其他'];
  const keys = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 99) - (order.indexOf(b) + 99));
  const colColors = { '已收款': '#16a34a', '已发货': '#2f6bff', '已确认': '#5d87ff', '待确认': '#f59e0b', '草稿': '#9aa4b8', '其他': '#9aa4b8' };
  const cols = keys.length ? keys.map((k) => `
    <div class="col">
      <div class="col-head"><div class="t"><span class="d" style="background:${colColors[k] || '#9aa4b8'}"></span>${esc(k)}</div><span class="n">${groups[k].length}</span></div>
      ${groups[k].map((o) => `
        <div class="deal"><div class="co">${esc(o.clientName)}</div>
          <div class="amt">${money(o.amount, o.currency)}</div>
          <div class="tags"><span class="tag">${esc(o.orderNo || '')}</span>${o.notes ? `<span class="tag">${esc(o.notes)}</span>` : ''}</div>
          <div class="meta"><div class="av-sm" style="background:${avatarColor(o.clientName)}">${initial(o.clientName)}</div><span class="cell-sub">${esc(o.ownerName || o.owner || '')}</span></div>
        </div>`).join('')}
    </div>`).join('')
    : emptyState('暂无商机');
  $('#content').innerHTML = `<div class="board">${cols}</div>`;
}

function renderClients() {
  const q = STATE.search.toLowerCase();
  const list = STATE.clients.filter((c) =>
    !q || [c.company, c.contactName, c.country, c.ownerName, c.stage].join(' ').toLowerCase().includes(q));
  const cards = list.length ? list.map((c) => `
    <div class="card contact">
      <div class="av-lg" style="background:linear-gradient(135deg,${avatarColor(c.company)},#1742d6)">${initial(c.company)}</div>
      <div class="nm">${esc(c.company)}</div>
      <div class="role">${esc(c.country || '')} · ${esc(c.contactName || '—')}</div>
      <div class="row"><span class="pill pill--neutral"><span class="d"></span>${esc(c.stage || '未知')}</span></div>
      <div class="row">${statusPill(c.ownerName ? '负责: ' + c.ownerName : '未分配')}</div>
      <div class="row muted">年值 ${esc(c.annualValue || '—')}</div>
      <div class="acts"><button class="btn btn--ghost btn--sm">详情</button><button class="btn btn--primary btn--sm">跟进</button></div>
    </div>`).join('')
    : emptyState('没有匹配的客户');
  $('#content').innerHTML = `
    <div class="toolbar">
      <span class="chip active">全部 ${STATE.clients.length}</span>
      <div class="spacer"></div><span class="muted">共 ${list.length} 家</span>
    </div>
    <div class="contact-grid">${cards}</div>`;
}

function emptyState(msg) {
  return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div>${esc(msg)}</div></div>`;
}

/* ---------- 交互绑定 ---------- */
function bindUI() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => el.addEventListener('click', () => renderView(el.dataset.view)));
  $('#openMainApp').addEventListener('click', () => window.open('index.html', '_blank'));
  $('#newDealBtn').addEventListener('click', () => window.open('index.html', '_blank'));
  $('#toggleSidebar').addEventListener('click', () => $('#app').classList.toggle('collapsed'));
  $('#refreshBtn').addEventListener('click', () => loadAll());
  $('#loginBtn').addEventListener('click', doLogin);
  $('#loginPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('#globalSearch').addEventListener('input', (e) => { STATE.search = e.target.value.trim(); if (currentView !== 'dashboard') renderView(currentView); });
  $('#themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.getAttribute('data-theme') === 'dark';
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
  });
}

document.addEventListener('DOMContentLoaded', () => { bindUI(); init(); });
