function newestRecords(a,b,dateField) {
  const stamp=v=>{if(v==null||v==='')return 0;const n=typeof v==='number'||/^\d+$/.test(String(v))?Number(v):Date.parse(v);return Number.isFinite(n)&&n>0?n:0;};
  const time=r=>(dateField&&stamp(r[dateField]))||stamp(r.createdAt)||stamp(r.updatedAt);
  return time(b)-time(a)||stamp(b.createdAt)-stamp(a.createdAt)||stamp(b.updatedAt)-stamp(a.updatedAt);
}

// 单号排序键：取单号尾部连续数字的后 6 位，按数值比较。
// 单号结构：ST + 业务员编号(2位) + 年份(2位) + 序号(4位)。
//   例 ST06260112 = 业务员 06 / 2026 年 / 第 0112 号。
// 排序只看「年份 + 序号」（即后 6 位），忽略公司前缀与业务员编号。
// 例：ST06260112 → 260112、ST02260111 → 260111、CA0223010901 → 010901、156 → 156
// 无尾部数字时返回 null（排序时排最后）。
function docNoKey(value) {
  const s = String(value == null ? '' : value).trim();
  const m = s.match(/(\d+)(?!.*\d)/);
  if (!m) return null;
  const n = Number(m[1].slice(-6));
  return Number.isFinite(n) ? n : null;
}
// 生成「按单号」比较器：无尾部数字的排最后，其余按后 6 位数值**降序**
//（年份+序号大的在前 —— 最新的单号在第 1 页，与原「按日期倒序」的观感一致）
function byDocNo(field) {
  return (a, b) => {
    const ka = docNoKey(a && a[field]);
    const kb = docNoKey(b && b[field]);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka;
  };
}
// ====== 外贸人工作台 前端逻辑 ======
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = (path, opts = {}) => {
  const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('ftw_token') : null;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  // 超时控制：避免请求永远 pending 导致页面"一直转圈"且无任何提示。
  // 默认 15s；服务端可达时登录/各接口均在毫秒级返回，超时即说明浏览器到 API 的网络/地址不通。
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(() => ctrl.abort(), (typeof opts.timeout === 'number' ? opts.timeout : 15000));
  // credentials: same-origin 确保同源请求始终携带 cookie；Bearer 头作为刷新不丢失的兜底
  return fetch(path, { ...opts, headers, credentials: 'same-origin', signal: ctrl.signal }).then((res) => {
    clearTimeout(timer);
    if (res.status === 401 && !String(path).includes('/api/login')) {
      localStorage.removeItem('ftw_token');
      if (typeof window.showLogin === 'function') window.showLogin('登录已过期，请重新登录');
    }
    if (res.status >= 500 && typeof toast === 'function') toast('服务器暂时不可用，请稍后重试');
    return res;
  }).catch((err) => {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort',cancel);
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (err && err.name === 'AbortError') {
      if (typeof toast === 'function') toast('请求超时，请稍后重试');
      throw new Error('请求超时');
    }
    if (typeof toast === 'function') toast('网络连接失败，请检查 NAS 服务');
    throw err;
  });
};
// 供独立扩展脚本（如 CRM 批量导入模块）复用统一请求封装。
window.api = api;

// ---------- 预置数据 ----------
const COUNTRIES = [
  { code: 'CN', name: '中国', tz: 'Asia/Shanghai', flag: '🇨🇳' },
  { code: 'US', name: '美国', tz: 'America/New_York', flag: '🇺🇸' },
  { code: 'GB', name: '英国', tz: 'Europe/London', flag: '🇬🇧' },
  { code: 'DE', name: '德国', tz: 'Europe/Berlin', flag: '🇩🇪' },
  { code: 'FR', name: '法国', tz: 'Europe/Paris', flag: '🇫🇷' },
  { code: 'IT', name: '意大利', tz: 'Europe/Rome', flag: '🇮🇹' },
  { code: 'ES', name: '西班牙', tz: 'Europe/Madrid', flag: '🇪🇸' },
  { code: 'JP', name: '日本', tz: 'Asia/Tokyo', flag: '🇯🇵' },
  { code: 'KR', name: '韩国', tz: 'Asia/Seoul', flag: '🇰🇷' },
  { code: 'AE', name: '阿联酋', tz: 'Asia/Dubai', flag: '🇦🇪' },
  { code: 'IN', name: '印度', tz: 'Asia/Kolkata', flag: '🇮🇳' },
  { code: 'VN', name: '越南', tz: 'Asia/Ho_Chi_Minh', flag: '🇻🇳' },
  { code: 'TH', name: '泰国', tz: 'Asia/Bangkok', flag: '🇹🇭' },
  { code: 'ID', name: '印度尼西亚', tz: 'Asia/Jakarta', flag: '🇮🇩' },
  { code: 'TR', name: '土耳其', tz: 'Europe/Istanbul', flag: '🇹🇷' },
  { code: 'RU', name: '俄罗斯', tz: 'Europe/Moscow', flag: '🇷🇺' },
  { code: 'BR', name: '巴西', tz: 'America/Sao_Paulo', flag: '🇧🇷' },
  { code: 'MX', name: '墨西哥', tz: 'America/Mexico_City', flag: '🇲🇽' },
  { code: 'CA', name: '加拿大', tz: 'America/Toronto', flag: '🇨🇦' },
  { code: 'AU', name: '澳大利亚', tz: 'Australia/Sydney', flag: '🇦🇺' },
  { code: 'ZA', name: '南非', tz: 'Africa/Johannesburg', flag: '🇿🇦' },
  { code: 'SA', name: '沙特', tz: 'Asia/Riyadh', flag: '🇸🇦' },
];
const GRADES = ['S', 'A', 'B', 'C', 'D'];
// 旧版阶段名 → 等级映射（数据自动迁移，不再显示中文阶段名）
const _OLD_STAGES = new Map(['潜在','跟进中','报价','样品','成交','流失'].map((s, i) => [s, 'C']));
function gradeOf(raw) { return (raw && _OLD_STAGES.has(raw)) ? _OLD_STAGES.get(raw) : (raw || '-'); }
const STATUSES = ['待确认', '已确认', '生产中', '已发货', '已收款', '已完成', '已取消'];
const CURRENCIES = ['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'AUD', 'CAD', 'HKD', 'SGD', 'INR'];
// 商机阶段（独立于订单状态）：用于加权预测
const OPPTY_STAGES = ['初步接触', '需求确认', '方案报价', '商务谈判', '赢单', '输单'];
const CLOSED_OPPTY = new Set(['赢单', '输单']); // 关闭阶段不计入进行中管道

// ---------- 本地存储偏好 ----------
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('ftw_' + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('ftw_' + k, JSON.stringify(v)); },
};

// ---------- 工具 ----------
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 2200);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtMoney(n) {
  if (n == null || isNaN(n)) return '-';
  return '¥' + Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- 视图切换（hash 路由：地址栏可区分页面，支持刷新/收藏/前进后退） ----------
let clientFollowFilter = false; // 仪表盘「待跟进客户」卡片跳转后，客户列表仅显示待跟进
let currentClientId = null;     // 客户 360° 详情页当前客户 ID
const VALID_VIEWS = ['dashboard', 'clients', 'orders', 'enquiry', 'quotations', 'docs', 'performance', 'emails', 'products', 'shipments', 'suppliers', 'finance', 'comms', 'chatlog', 'mail', 'calc', 'settings', 'audit', 'tasks', 'reports', 'inqstats', 'client-detail', 'order-detail', 'reminders', 'knowledge'];

// 进入首页时自动刷新：先用内存数据立即重绘，再拉最新数据重绘一次。
// 节流只用来挡住「快速连点导航」造成的抖动（1.2 秒）；正常进首页一定会重新拉数据。
let dashLastReload = 0;
function refreshDashboardOnEnter() {
  try { renderDashboard(); } catch (e) { console.error('renderDashboard', e); }
  const now = Date.now();
  if (now - dashLastReload < 1200) return;
  dashLastReload = now;
  Promise.resolve()
    .then(() => (window.refreshInquiries ? window.refreshInquiries() : null))
    .then(() => loadAll())
    .then(() => { try { renderDashboard(); } catch (e) { console.error('renderDashboard', e); } })
    .catch((e) => console.error('仪表盘自动刷新失败', e));
}

function activateView(view) {
  if(view.startsWith('order-detail?')){window.salesSelectedOrder=new URLSearchParams(view.split('?')[1]).get('id');view='order-detail';}
  if (view === 'tools') {
    history.replaceState(null, '', '#/dashboard');
    view = 'dashboard';
  }
  if (!VALID_VIEWS.includes(view)) view = 'dashboard';
  if (!document.getElementById('view-' + view)?.classList.contains('active')) window.scrollTo({top:0,left:0,behavior:'instant'});
  if (view !== 'clients') clientFollowFilter = false;
  $$('.nav-item').forEach((x) => x.classList.remove('active'));
  $$('.view').forEach((x) => x.classList.remove('active'));
  const nav = document.querySelector('.nav-item[data-view="' + (view==='order-detail'?'orders':view) + '"]');
  if (nav) {
    nav.classList.add('active');
    // 所在分组折叠时自动展开
    const group = nav.closest('.nav-group');
    if (group && group.classList.contains('collapsed')) setGroupCollapsed(group, false);
  }
  const sec = $('#view-' + view);
  if (sec) sec.classList.add('active');
  updateTopbar(view);
  if (view === 'client-detail') renderClientDetail();
  if (view === 'order-detail' && typeof renderSalesOrder==='function') renderSalesOrder();
  if (view === 'dashboard') refreshDashboardOnEnter();
  // 客户列表：视图刚显示出来才量得到容器宽度，这里再适配一次列宽
  // （首帧渲染时该 section 还是 display:none，clientWidth=0，适配会失效）
  if (view === 'clients' && typeof clApplyWidths === 'function') {
    try { clApplyWidths(); } catch (e) { console.warn('clApplyWidths', e); }
  }
  // 视图激活钩子：供 settings.js 等扩展模块在进入页面时渲染内容
  if (typeof window.onViewActivated === 'function') window.onViewActivated(view);
}

// 窗口尺寸变化：列宽重新适配容器（否则拉窄窗口又会出现横向滚动/列被盖住）
let clResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(clResizeTimer);
  clResizeTimer = setTimeout(() => {
    const sec = document.getElementById('view-clients');
    if (sec && sec.classList.contains('active') && typeof clApplyWidths === 'function') {
      try { clApplyWidths(); } catch (e) {}
    }
  }, 160);
});
function switchView(view) {
  // 统一走 hash，由 hashchange 完成激活，保证地址栏与视图一致
  if (('#/' + view) === location.hash) activateView(view);
  else location.hash = '/' + view;
}
window.addEventListener('hashchange', () => {
  activateView(location.hash.replace(/^#\/?/, '') || 'dashboard');
});
$$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

// ---------- 侧边栏分组折叠 ----------
function setGroupCollapsed(group, collapsed) {
  group.classList.toggle('collapsed', collapsed);
  const key = group.dataset.group || '';
  const saved = LS.get('navGroups', {});
  saved[key] = collapsed;
  LS.set('navGroups', saved);
}
function initNavGroups() {
  const saved = LS.get('navGroups', {});
  $$('.nav-group').forEach((group) => {
    const title = group.querySelector('.nav-group-title');
    if (!title) return;
    if (saved[group.dataset.group]) group.classList.add('collapsed');
    title.addEventListener('click', () => setGroupCollapsed(group, !group.classList.contains('collapsed')));
  });
}

// ---------- 顶栏（页面标题 / 全局搜索 / 折叠菜单） ----------
const VIEW_TITLES = {
  dashboard: '工作台', clients: '客户资料', enquiry: '询盘 / 商机', orders: '订单', quotations: '报价管理',
  shipments: '出货', docs: '单证生成', products: '产品库', emails: '开发信',
  comms: '沟通', chatlog: '沟通 · 聊天记录', mail: '沟通 · 邮件中心', performance: '业绩进度', finance: '财务',
  suppliers: '供应商', calc: '计算器', settings: '系统设置', tasks: '任务日历', reports: '报表导出', inqstats: '询盘分析',
  reminders: '提醒中心', knowledge: '资料/知识库',
  'client-detail': '客户 360° 视图', 'order-detail':'订单详情与交付'
};
function updateTopbar(view) {
  const title = VIEW_TITLES[view] || '仪表盘';
  const pt = $('#pageTitle'); if (pt) pt.textContent = title;
  const bc = $('#pageBreadcrumb'); if (bc) bc.textContent = '外贸工作台 / ' + title;
  document.title = title + ' · 外贸工作台';
  const av = $('#tbAvatar');
  if (av && currentUser) av.textContent = String(currentUser.name || currentUser.username || 'A').slice(0, 1).toUpperCase();
}
// 按角色收敛界面：非管理员隐藏 admin-only 入口（如操作日志）
function applyRoleUI() {
  const isAdmin = !!(currentUser && currentUser.role === 'admin');
  $$('[data-admin-only]').forEach((el) => { el.style.display = isAdmin ? '' : 'none'; });
}
function bindTopbar() {
  const create = $('#tbCreate');
  if (create) create.onclick = () => {
    const old = document.querySelector('#quickCreateMenu');
    if (old) { old.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'quickCreateMenu'; menu.className = 'quick-create-menu';
    menu.innerHTML = '<button data-create="client">客户</button><button data-create="inquiry">询盘</button><button data-create="order">订单</button><button data-create="task">任务</button><button data-create="comm">沟通记录</button>';
    create.parentElement.appendChild(menu);
    menu.querySelectorAll('[data-create]').forEach((b) => b.onclick = () => {
      menu.remove();
      if (b.dataset.create === 'client') openClientModal();
      else if (b.dataset.create === 'inquiry' && typeof openInqModal === 'function') openInqModal();
      else if (b.dataset.create === 'order') openOrderModal();
      else if (b.dataset.create === 'task' && typeof window.openTaskModal === 'function') window.openTaskModal();
      else if (b.dataset.create === 'comm' && typeof window.openCommModal === 'function') window.openCommModal();
    });
  };
  const gs = $('#globalSearch');
  if (gs) {
    gs.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const t = gs.value.trim();
      if (!t) return;
      const q = t.toLowerCase();
      const hitClient = clients.find((c) => [c.company, c.contactName, c.country, c.contactEmail].some((v) => String(v || '').toLowerCase().includes(q)));
      const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
      const hitInq = inqs.find((i) => [i.clientName, i.product, i.country, i.contactName].some((v) => String(v || '').toLowerCase().includes(q)));
      const hitOrder = orders.find((o) => [o.orderNo, o.clientName, o.country].some((v) => String(v || '').toLowerCase().includes(q)));
      if (hitClient) { switchView('clients'); const ci = $('#clientSearch'); if (ci) { ci.value = t; ci.dispatchEvent(new Event('input', { bubbles: true })); } toast('已定位客户：' + hitClient.company); }
      else if (hitInq) { switchView('enquiry'); if (typeof openInqModal === 'function') setTimeout(() => openInqModal(hitInq.id), 180); toast('已定位询盘：' + (hitInq.clientName || '')); }
      else if (hitOrder) { switchView('orders'); toast('已定位订单：' + (hitOrder.orderNo || '')); }
      else toast('没有找到匹配记录');
    });
  }
  const rt = $('#tbRate');
  if (rt) rt.addEventListener('click', () => { loadRates(true); toast('正在刷新汇率…'); });
}
// 仪表盘交互：数据卡片点击跳转 / 快捷新建
function bindDashboardActions() {
  $$('#view-dashboard [data-go]').forEach((card) => {
    card.addEventListener('click', () => {
      const go = card.dataset.go;
      if (go === 'refresh') { loadAll(); loadRates(true); toast('已刷新数据'); return; }
      switchView(go);
      if (go === 'enquiry' && card.dataset.filter === 'follow') {
        window.inqFollowFilter = true;
        if (typeof renderInqList === 'function') renderInqList();
        toast('已筛选：仅显示你的待跟进询盘');
      }
    });
  });
  const q = (id) => $('#' + id);
  if (q('qaQuote')) q('qaQuote').onclick = () => quickDoc('quotation');
  if (q('qaClient')) q('qaClient').onclick = () => openClientModal();
  if (q('qaPI')) q('qaPI').onclick = () => quickDoc('pi');
  if (q('qaPL')) q('qaPL').onclick = () => quickDoc('packing');
  if (q('dashNewTask')) q('dashNewTask').onclick = () => { if (typeof window.openTaskModal === 'function') window.openTaskModal(); else switchView('tasks'); };
  // 客户详情页返回
  if (q('cdBack')) q('cdBack').onclick = () => switchView('clients');
  // 客户详情页已改为平铺渲染全部区块（v20260901e），无选项卡切换
}
function quickDoc(type) {
  switchView('docs');
  setTimeout(() => {
    const btn = document.querySelector('.doc-type[data-doctype="' + type + '"]');
    if (btn) btn.click();
  }, 0);
}

// ================= 首页世界时间（可配置国家与工作时段） =================
const FTW_MARKET_ZONES = [
['中国','北京','Asia/Shanghai'],['美国','纽约','America/New_York'],['美国','洛杉矶','America/Los_Angeles'],['美国','芝加哥','America/Chicago'],['美国','丹佛','America/Denver'],['加拿大','多伦多','America/Toronto'],['加拿大','温哥华','America/Vancouver'],['德国','柏林','Europe/Berlin'],['英国','伦敦','Europe/London'],['法国','巴黎','Europe/Paris'],['意大利','罗马','Europe/Rome'],['西班牙','马德里','Europe/Madrid'],['荷兰','阿姆斯特丹','Europe/Amsterdam'],['波兰','华沙','Europe/Warsaw'],['俄罗斯','莫斯科','Europe/Moscow'],['俄罗斯','符拉迪沃斯托克','Asia/Vladivostok'],['阿联酋','迪拜','Asia/Dubai'],['沙特阿拉伯','利雅得','Asia/Riyadh'],['土耳其','伊斯坦布尔','Europe/Istanbul'],['以色列','耶路撒冷','Asia/Jerusalem'],['印度','加尔各答','Asia/Kolkata'],['巴基斯坦','卡拉奇','Asia/Karachi'],['孟加拉国','达卡','Asia/Dhaka'],['印度尼西亚','雅加达','Asia/Jakarta'],['印度尼西亚','望加锡','Asia/Makassar'],['印度尼西亚','查亚普拉','Asia/Jayapura'],['越南','胡志明市','Asia/Ho_Chi_Minh'],['泰国','曼谷','Asia/Bangkok'],['马来西亚','吉隆坡','Asia/Kuala_Lumpur'],['新加坡','新加坡','Asia/Singapore'],['菲律宾','马尼拉','Asia/Manila'],['日本','东京','Asia/Tokyo'],['韩国','首尔','Asia/Seoul'],['澳大利亚','悉尼','Australia/Sydney'],['澳大利亚','珀斯','Australia/Perth'],['澳大利亚','阿德莱德','Australia/Adelaide'],['澳大利亚','布里斯班','Australia/Brisbane'],['新西兰','奥克兰','Pacific/Auckland'],['巴西','圣保罗','America/Sao_Paulo'],['墨西哥','墨西哥城','America/Mexico_City'],['智利','圣地亚哥','America/Santiago'],['阿根廷','布宜诺斯艾利斯','America/Argentina/Buenos_Aires'],['哥伦比亚','波哥大','America/Bogota'],['秘鲁','利马','America/Lima'],['南非','约翰内斯堡','Africa/Johannesburg'],['埃及','开罗','Africa/Cairo'],['尼日利亚','拉各斯','Africa/Lagos'],['肯尼亚','内罗毕','Africa/Nairobi'],['摩洛哥','卡萨布兰卡','Africa/Casablanca']
].map(([country,city,tz])=>({country,city,tz}));
const FTW_CLOCK_DEFAULTS = ['Asia/Dubai','Europe/London','America/New_York','America/Los_Angeles'];
let ftwClockPrefs = [];
let ftwClockUserKey = '';
const ftwClockFormats = new Map();
function ftwClockKey() { return 'ftw.worldClocks.v1.' + ((currentUser && (currentUser.id || currentUser.username)) || 'guest'); }
function ftwValidClock(p) {
  return p && FTW_MARKET_ZONES.some(z => z.tz === p.tz) && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.end) && p.start !== p.end && Array.isArray(p.days) && p.days.length > 0 && p.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
}
function ftwLoadClocks() {
  const key = ftwClockKey();
  if (key === ftwClockUserKey) return;
  ftwClockUserKey = key;
  ftwClockPrefs = FTW_CLOCK_DEFAULTS.map(tz => ({tz,start:'09:00',end:'18:00',days:[1,2,3,4,5]}));
  try { const p = JSON.parse(localStorage.getItem(key)); if (Array.isArray(p) && p.length <= 12 && p.every(ftwValidClock) && new Set(p.map(x=>x.tz)).size === p.length) ftwClockPrefs = p; } catch {}
}
function ftwClockState(p, now = new Date()) {
  if (!ftwClockFormats.has(p.tz)) ftwClockFormats.set(p.tz, new Intl.DateTimeFormat('en-GB',{timeZone:p.tz,month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}));
  const a = Object.fromEntries(ftwClockFormats.get(p.tz).formatToParts(now).map(x=>[x.type,x.value]));
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(a.weekday),m=+a.hour*60+(+a.minute),n=s=>+s.slice(0,2)*60+(+s.slice(3)),start=n(p.start),end=n(p.end),night=end<start;
  const working=night?(m>=start&&p.days.includes(day))||(m<end&&p.days.includes((day+6)%7)):p.days.includes(day)&&m>=start&&m<end;
  const workday=p.days.includes(day)||(night&&m<end&&p.days.includes((day+6)%7));
  return {working,status:working?'工作时段':workday?'非工作时段':'休息日',time:a.hour+':'+a.minute+':'+a.second,date:a.month+'月'+a.day+'日 周'+'日一二三四五六'[day],offset:a.timeZoneName.replace('GMT','UTC')};
}
function ftwClockStyles() {
  if(document.getElementById('ftwClockStyle'))return;
  const style=document.createElement('style');style.id='ftwClockStyle';
  style.textContent=`
#worldClocks.ftw-clock-panel{display:block;flex:1 1 580px;min-width:0;max-width:100%;padding:12px;border:1px solid var(--line,#dde3e8);border-radius:12px;background:var(--card,#fff)}
.welcome-row:has(.ftw-clock-panel){flex-wrap:wrap;align-items:flex-start;gap:16px}.ftw-clock-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:14px}.ftw-clock-toolbar button{white-space:nowrap}.ftw-clock-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px}.ftw-clock-item{padding:10px;border:1px solid var(--line,#dde3e8);border-radius:8px;color:var(--ink,#263b32)}.ftw-clock-item[data-working="yes"]{border-color:#5b9b76;background:color-mix(in srgb,var(--card,#fff) 91%,#53ae76)}.ftw-clock-city{font-size:14px;font-weight:600}.ftw-clock-item time{display:block;font-size:23px;font-variant-numeric:tabular-nums;line-height:1.5}.ftw-clock-meta{font-size:12px;color:var(--muted,#79867d)}.ftw-clock-state{font-size:14px;margin-top:5px}.ftw-clock-item[data-working="yes"] .ftw-clock-state{color:#27834d}.ftw-clock-note{font-size:12px;color:var(--muted,#79867d);margin:10px 0 0}.ftw-clock-pick{border:1px solid var(--line,#dde3e8);padding:12px;border-radius:8px;margin:8px 0}.ftw-clock-pick[hidden]{display:none}.ftw-clock-choice{display:flex;gap:9px;align-items:center;font-size:14px}.ftw-clock-choice input,.ftw-clock-days input{width:auto!important;margin:0}.ftw-clock-schedule{margin-top:12px}.ftw-clock-hours{display:flex;gap:16px}.ftw-clock-hours label{flex:1;font-size:14px}.ftw-clock-hours input{width:100%;display:block;margin-top:5px}.ftw-clock-days{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.ftw-clock-days label{display:flex;gap:4px;align-items:center;font-size:14px}.ftw-clock-search{width:100%;margin:12px 0}@media(max-width:520px){.ftw-clock-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ftw-clock-toolbar{flex-wrap:wrap}.ftw-clock-item time{font-size:21px}}`;
  document.head.appendChild(style);
}
function renderTimezones() { ftwClockUserKey='';ftwLoadClocks();renderWorldClocks();tickTimezones(); }
function renderWorldClocks() {
  ftwLoadClocks();ftwClockStyles();
  const wrap=$('#worldClocks');if(!wrap)return;
  wrap.classList.add('ftw-clock-panel');
  // Only rebuild when preferences change; ticking must not remove keyboard focus.
  const signature=JSON.stringify(ftwClockPrefs);
  if(wrap.dataset.clockSignature===signature)return;
  wrap.dataset.clockSignature=signature;
  wrap.innerHTML=`<div class="ftw-clock-toolbar"><b>客户当地时间 <span id="ftwClockSummary"></span></b><button type="button" class="btn-ghost" id="ftwClockSettings">设置展示国家</button></div><div class="ftw-clock-grid">${ftwClockPrefs.map(p=>{const z=FTW_MARKET_ZONES.find(z=>z.tz===p.tz);return `<div class="ftw-clock-item" data-clock-zone="${esc(p.tz)}"><div class="ftw-clock-city">${esc(z.country)} · ${esc(z.city)}</div><time>--:--:--</time><div class="ftw-clock-meta"></div><div class="ftw-clock-state"></div><div class="ftw-clock-meta">${p.start}–${p.end}${p.end<p.start?' 次日':''}</div></div>`}).join('')||'<div class="muted">尚未选择国家，请点击“设置展示国家”。</div>'}</div><p class="ftw-clock-note">按设置的当地工作日与时段判断，不含节假日；不代表客户在线。设置按账号保存在当前浏览器。</p>`;
  $('#ftwClockSettings').onclick=ftwConfigureClocks;
}
function tickTimezones() {
  renderWorldClocks();const now=new Date();let active=0;
  ftwClockPrefs.forEach(p=>{const state=ftwClockState(p,now);if(state.working)active++;const el=document.querySelector('[data-clock-zone="'+p.tz+'"]');if(!el)return;el.dataset.working=state.working?'yes':'no';el.querySelector('time').textContent=state.time;el.querySelector('.ftw-clock-meta').textContent=state.date+' · '+state.offset;el.querySelector('.ftw-clock-state').textContent=(state.working?'● ':'○ ')+state.status;});
  const count=$('#ftwClockSummary');if(count)count.textContent=' · '+active+'/'+ftwClockPrefs.length+' 工作中';
}
function ftwConfigureClocks() {
  ftwLoadClocks();
  openModal('首页时区与工作时间',`<p class="muted">最多展示 12 个城市。多时区国家请按客户所在城市选择。可分别设置工作日；结束早于开始表示跨夜。</p><input class="ftw-clock-search" id="ftwClockSearch" placeholder="搜索国家或城市" aria-label="搜索国家或城市"><div id="ftwClockChoices">${FTW_MARKET_ZONES.map(z=>{const saved=ftwClockPrefs.find(p=>p.tz===z.tz),p=saved||{start:'09:00',end:'18:00',days:[1,2,3,4,5]};return `<div class="ftw-clock-pick" data-search="${esc(z.country+z.city+z.tz)}"><label class="ftw-clock-choice"><input name="clockZone" type="checkbox" value="${z.tz}" ${saved?'checked':''}>${esc(z.country)} · ${esc(z.city)}</label><div class="ftw-clock-schedule" ${saved?'':'hidden'}><div class="ftw-clock-hours"><label>当地开始<input type="time" data-hour="start" value="${p.start}"></label><label>当地结束<input type="time" data-hour="end" value="${p.end}"></label></div><div class="ftw-clock-days">${[1,2,3,4,5,6,0].map(d=>`<label><input type="checkbox" data-day="${d}" ${p.days.includes(d)?'checked':''}>周${'日一二三四五六'[d]}</label>`).join('')}</div></div></div>`}).join('')}</div><p id="ftwClockEmpty" hidden>没有匹配的国家或城市。</p>`,{wide:true});
  const form=$('#modalForm');
  form.querySelectorAll('[name="clockZone"]').forEach(box=>box.onchange=()=>{box.closest('.ftw-clock-pick').querySelector('.ftw-clock-schedule').hidden=!box.checked;});
  $('#ftwClockSearch').oninput=e=>{let count=0;const q=e.target.value.trim().toLowerCase();form.querySelectorAll('.ftw-clock-pick').forEach(row=>{row.hidden=!row.dataset.search.toLowerCase().includes(q);if(!row.hidden)count++;});$('#ftwClockEmpty').hidden=count>0;};
  form.onsubmit=e=>{e.preventDefault();const boxes=[...form.querySelectorAll('[name="clockZone"]:checked')];if(boxes.length>12)return toast('最多选择 12 个城市');const next=boxes.map(box=>{const row=box.closest('.ftw-clock-pick');return {tz:box.value,start:row.querySelector('[data-hour="start"]').value,end:row.querySelector('[data-hour="end"]').value,days:[...row.querySelectorAll('[data-day]:checked')].map(el=>+el.dataset.day)};});if(!next.every(ftwValidClock))return toast('请选择工作日，并设置不同的开始和结束时间');try{localStorage.setItem(ftwClockKey(),JSON.stringify(next));}catch{return toast('保存失败，请检查浏览器存储空间');}ftwClockPrefs=next;closeModal();renderWorldClocks();tickTimezones();toast('首页时区设置已保存');};
}

// ================= 实时汇率 =================
let rateData = null; // { base, rates(USD-base), source, updated }
const DASH_RATE_SYMBOLS = ['CNY', 'EUR', 'GBP', 'AED'];
async function loadRates(manual) {
  try {
    const r = await api(`/api/rates?base=USD&symbols=USD,CNY,EUR,GBP,AED`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '汇率获取失败');
    rateData = j;
    window.dispatchEvent(new Event('ftw:ratesReady'));
    renderRates();
    $('#connDot').className = 'dot ok';
    $('#rateSource').textContent = '汇率源: ' + j.source;
    const tm = $('#rateTimeInline'); if (tm) tm.textContent = new Date(j.updated).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false });
  } catch (e) {
    $('#connDot').className = 'dot bad';
    $('#rateSource').textContent = '汇率源: 不可用';
    if (manual) toast('汇率获取失败: ' + e.message);
  }
}
function rateOf(base, sym) {
  // rateData.rates 为 rateData.base 基准: 1 base = r[sym]
  if (!rateData) return null;
  const r = rateData.rates;
  const bk = rateData.base || 'USD';
  if (base === sym) return 1;
  // 基准币种自身在 rates 中可能缺省（部分源省略基准键），其相对值恒为 1
  let rb = r[base];
  if (rb == null && base === bk) rb = 1;
  let rs = r[sym];
  if (rs == null && sym === bk) rs = 1;
  if (rb == null || rs == null) return null;
  return rs / rb; // 1 base = rs/rb sym
}
function renderRates() {
  const srcEl = $('#rateSourceInline2');
  if (srcEl) srcEl.textContent = rateData?.source || 'FXRatesAPI';
  const list = $('#rateList2');
  if (!list) return;
  if (!rateData) { list.innerHTML = '<div class="empty">汇率加载中…</div>'; return; }
  const base = 'USD';
  list.innerHTML = DASH_RATE_SYMBOLS.map((sym) => {
    const v = rateOf(base, sym);
    return `<div class="rate-item">
      <span class="pair">1 ${base} =</span>
      <span class="val">${v != null ? v.toFixed(4) : '—'} ${sym}</span>
    </div>`;
  }).join('');
  calcFx();
}
const rateRefresh2El = $('#rateRefresh2');
if (rateRefresh2El) rateRefresh2El.addEventListener('click', () => loadRates(true));

// 首页汇率换算器
function calcFx() {
  const amtEl = $('#fxAmount'); const fromEl = $('#fxFrom'); const toEl = $('#fxTo');
  const out = $('#fxResult'); const lbl = $('#fxToLabel');
  if (!amtEl || !fromEl || !toEl) return;
  const amt = parseFloat(amtEl.value);
  const from = fromEl.value; const to = toEl.value;
  if (lbl) lbl.textContent = to;
  if (out) out.textContent = '--';
  if (isNaN(amt) || !rateData) return;
  const v = rateOf(from, to);
  if (v == null) return;
  if (out) out.textContent = (amt * v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
['fxAmount', 'fxFrom', 'fxTo'].forEach((id) => {
  const el = $('#' + id);
  if (el) el.addEventListener('input', calcFx);
});

// 折算人民币：amount(币种cur) -> CNY，使用 USD 基准 rates
function toCNY(amount, cur) {
  if (!rateData || amount == null) return null;
  const r = rateData.rates;
  const rCny = r['CNY'], rCur = r[cur];
  if (!rCny || !rCur) return null;
  return amount * (rCny / rCur);
}

// ================= 数据：客户 / 订单 =================
let clients = [];
let orders = [];
let currentUser = null;   // 当前登录用户 {id, username, name}
let allUsers = [];
function assignableUsers() { return (allUsers || []).filter(u => currentUser && (['admin', 'manager'].includes(currentUser.role) || u.id === currentUser.id)); }
window.assignableUsers = assignableUsers;
function canSeeBusiness(owner) { return !!currentUser && (['admin', 'manager'].includes(currentUser.role) || owner === currentUser.id); }
        // 全部业务员（用于责任人下拉 / 用户管理）

// 当前用户可见的订单：新订单按 owner 过滤；历史无 owner 的订单视为共享，所有人可见
function userOrders() {
  if (!currentUser) return orders;
  // 管理员/经理：业绩统计看全公司订单；普通业务员只看自己名下（无 owner 的历史单共享）
  if (currentUser.role === 'admin' || currentUser.role === 'manager') return orders;
  return orders.filter((o) => o.owner === currentUser.id);
}

async function loadAll() {
  // 同一时间只允许一次全量加载：并发调用复用同一个请求，避免进首页/切页面时重复拉数据
  if (window.__loadAllP) return window.__loadAllP;
  window.__loadAllP = _loadAll().finally(() => { window.__loadAllP = null; });
  return window.__loadAllP;
}
async function _loadAll() {
  const [c, o] = await Promise.all([api('/api/clients').then((r) => r.json()), api('/api/orders').then((r) => r.json())]);
  clients = c; orders = o;
  backfillClientCreated(); initClientFilters();
  renderClients(); renderOrders(); renderDashboard();
  // 客户速览抽屉开着时同步重渲染，避免编辑保存后抽屉里是旧数据（v20260902d）
  try {
    const _dr = document.getElementById('clientDrawer');
    if (window.__openClientDrawerId && _dr && _dr.classList.contains('open')) openClientDrawer(window.__openClientDrawerId);
  } catch { /* 非关键增强 */ }
  // 加载报价数据
  safe(window.loadQuotations);
  // 通知其他模块（询盘/业绩）数据已就绪
  window.dispatchEvent(new Event('ftw:dataReady'));
}

// ---------- 仪表盘 ----------
function renderDashboard() {
  const v = $('#view-dashboard');
  if (!v) return;
  const today = todayStr();
  const month = today.slice(0, 7);
  const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
  // 待跟进询盘：按当前登录人的跟进人过滤，下次跟进日期 ≤ 今天
  const pending = inqs.filter((iq) => {
    if (!iq.nextFollowAt || iq.nextFollowAt > today) return false;
    return canSeeBusiness(iq.owner);
  });
  // 欢迎行
  const greet = $('#dashGreeting');
  const hint = $('#dashHint');
  if (greet) {
    const hour = new Date().getHours();
    const prefix = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    greet.textContent = prefix + '，' + (currentUser ? (currentUser.name || currentUser.username) : '管理员');
  }
  if (hint) {
    const overdue = pending.filter((iq) => iq.nextFollowAt < today).length;
    hint.textContent = pending.length
      ? '今天有 ' + pending.length + ' 项待跟进' + (overdue ? '（' + overdue + ' 条已逾期）' : '') + '，请及时处理。'
      : '今天没有待跟进事项，保持节奏。';
  }
  const dateEl = $('#dashDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('zh-CN', {month:'long',day:'numeric',weekday:'long'});
  renderWorldClocks();
  renderDashKpis();
  // 工作台业务面板
  renderPipeline();
  renderTodoList();
  renderOppList();
  // 兼容旧结构：待跟进列表
  const fl = $('#followList');
  const fc = $('#followCount');
  if (fl && fc) {
    if (fc) fc.textContent = pending.length;
    if (!pending.length) { fl.innerHTML = '<div class="empty">暂无待跟进询盘</div>'; }
    else {
      fl.innerHTML = pending.map((iq) => {
        const overdue = iq.nextFollowAt < today;
        return `<div class="follow-row ${overdue ? 'overdue' : ''}">
          <div class="f-main">
            <button class="f-co link-name" data-detail-name="${esc(iq.clientName || '未指定')}">${esc(iq.clientName || '未指定')}</button>
            <div class="f-meta">${esc(iq.product || '—')} · ${esc(iq.status || '新询盘')} · 跟进人:${esc(iq.ownerName || '-')}</div>
          </div>
          <span class="f-tag">${overdue ? '已逾期 ' + iq.nextFollowAt : '今日 ' + iq.nextFollowAt}</span>
          <button class="link-btn" data-edit-i="${iq.id}">编辑</button>
          <button class="link-btn" data-done-i="${iq.id}">完成跟进</button>
        </div>`;
      }).join('');
      fl.querySelectorAll('[data-detail-name]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault(); openClientDetailByName(b.dataset.detailName);
      }));
      fl.querySelectorAll('[data-edit-i]').forEach((b) => b.addEventListener('click', () => {
        if (typeof openInqModal === 'function') openInqModal(b.dataset.editI);
      }));
      fl.querySelectorAll('[data-done-i]').forEach((b) => b.addEventListener('click', async () => {
        const iq = inqs.find((x) => x.id === b.dataset.doneI);
        if (!iq) return;
        const next = new Date(); next.setDate(next.getDate() + 7);
        const iso = next.toISOString().slice(0, 10);
        const r = await api('/api/inquiries/' + iq.id, { method: 'PUT', body: JSON.stringify({ nextFollowAt: iso }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); toast('更新失败：' + (j.error || r.status)); return; }
        iq.nextFollowAt = iso;
        toast('已跟进，下次跟进设为 ' + iso);
        renderDashboard();
      }));
    }
  }
  renderActionQueue(pending);
  renderFunnel();
  renderRevenueTrend();
  // ===== 新版 5 块（插入到旧功能区之后，不覆盖旧功能） =====
  insertNewDash(v);
}

// ================= 仪表盘 KPI 卡片（独立刷新：数据/询盘/报价异步就绪后自动重算） =================
// 订单归属月份：优先 orderDate；缺失时回退 deliveryDate / createdAt / updatedAt（与「业绩进度」同口径）
function orderMonthKey(o) {
  const tryStr = (v) => { const s = String(v == null ? '' : v).slice(0, 7); return /^\d{4}-\d{2}$/.test(s) ? s : ''; };
  for (const f of ['orderDate', 'deliveryDate', 'createdAt', 'updatedAt']) {
    const v = o[f];
    if (v == null || v === '') continue;
    if (typeof v === 'number') {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      const s = tryStr(v);
      if (s) return s;
    }
  }
  return '';
}
// 成交询盘归属月份：优先 wonAt，回退 receivedAt / updatedAt / createdAt
function inqMonthKey(q) {
  const v = q.wonAt || q.receivedAt || q.updatedAt || q.createdAt;
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const s = String(v).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : '';
}
// 仪表盘 6 个 KPI 卡片
function renderDashKpis() {
  const today = todayStr();
  const month = today.slice(0, 7);
  const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
  // 待跟进询盘：按当前登录人的跟进人过滤，下次跟进日期 ≤ 今天
  const pending = inqs.filter((iq) => {
    if (!iq.nextFollowAt || iq.nextFollowAt > today) return false;
    return canSeeBusiness(iq.owner);
  });
  const statFollow = $('#statFollow'); if (statFollow) statFollow.textContent = pending.length;
  // 当月报价：与「报价管理」页同源（报价单记录，按创建月份），保证两处数字一致
  const qts = (typeof window.getAllQuotations === 'function') ? window.getAllQuotations() : [];
  const monthQuotes = qts.filter((q) => {
    const k = q.createdAt ? new Date(q.createdAt).toISOString().slice(0, 7) : (q.validUntil || '').slice(0, 7);
    return k === month;
  });
  const statQuotes = $('#statQuotes'); if (statQuotes) statQuotes.textContent = monthQuotes.length;
  // 客户数量
  const statClients = $('#statClients'); if (statClients) statClients.textContent = clients.length;
  // 今日任务
  const tasks = typeof window.getAllTasks === 'function' ? window.getAllTasks() : [];
  const todayTasks = tasks.filter((t) => !['已完成', '已取消'].includes(t.status) && t.dueDate && t.dueDate <= today);
  const statTasksToday = $('#statTasksToday'); if (statTasksToday) statTasksToday.textContent = todayTasks.length;
  // 进行中商机 + 加权管道：以「询盘商机」为准（与询盘漏斗/询盘分析同口径），按阶段概率加权
  const OPEN_STAGES = ['新询盘', '已报价', '等回复', '谈判中'];
  const STAGE_PROB = { '新询盘': 10, '已报价': 30, '等回复': 50, '谈判中': 70 };
  const openOpp = inqs.filter((q) => OPEN_STAGES.includes(q.status || ''));
  let weighted = 0;
  for (const q of openOpp) weighted += (toCNY(Number(q.expectedAmount) || 0, q.currency) || 0) * (STAGE_PROB[q.status] || 0) / 100;
  const wEl = $('#statWeighted'); if (wEl) wEl.textContent = (typeof fmtMoney === 'function') ? fmtMoney(weighted) : Math.round(weighted).toLocaleString();
  const oEl = $('#statOpenOpp'); if (oEl) oEl.textContent = openOpp.length;
  // 本月成交：订单（日期回退、非取消）+ 成交询盘，与「业绩进度」同口径
  let monthRevenue = orders
    .filter((o) => o.status !== '已取消' && orderMonthKey(o) === month)
    .reduce((s, o) => s + (toCNY(Number(o.amount) || 0, o.currency) || 0), 0);
  monthRevenue += inqs
    .filter((q) => (q.status || '') === '成交' && inqMonthKey(q) === month)
    .reduce((s, q) => s + (toCNY(Number(q.expectedAmount) || 0, q.currency) || 0), 0);
  const mrEl = $('#statMonthRevenue'); if (mrEl) mrEl.textContent = (typeof fmtMoney === 'function') ? fmtMoney(monthRevenue) : Math.round(monthRevenue).toLocaleString();
}
// 数据 / 询盘 / 报价加载完成后，仅刷新 KPI 卡片（不整页重渲染）
window.addEventListener('ftw:dataReady', () => { try { renderDashKpis(); } catch (e) { console.error('dashKpis', e); } });
window.addEventListener('ftw:inquiriesChanged', () => {
  try { renderDashKpis(); } catch (e) { console.error('dashKpis', e); }
  try { renderDashboard(); } catch (e) { /* 询盘变化联动仪表盘 */ }
  // 询盘变化 → 客户列表阶段/在途徽标即时联动（提交后刷新，不用手动 F5）
  try { renderClients(); } catch (e) { /* 客户视图不在当前页时静默 */ }
});
window.addEventListener('ftw:quotationsChanged', () => { try { renderDashKpis(); } catch (e) { console.error('dashKpis', e); } });
window.addEventListener('ftw:ratesReady', () => { if (window.fillDashboardRates) window.fillDashboardRates(); try { renderDashKpis(); } catch (e) { console.error('dashKpis', e); } try { renderOrders(); } catch (e) { console.error('orders', e); } });
// 新版主页 4 块：机会概览 / 漏斗 / 待办清单 / 实时汇率
function insertNewDash(v) {
  const old = v.querySelector('.dashv2-new');
  const draft = old?.querySelector('#aiChatInput')?.value || '';
  if (old) old.remove();
  const div = document.createElement('div');
  div.className = 'dashv2-new';
  div.innerHTML = `
<div class="dashv2-row mid single">
  <div class="dashv2-card ai-chat-card">
    <div class="fc-head"><span>AI 工作助手</span><span class="fc-sub" id="aiChatSub">对话式管理 CRM · 数据实时</span></div>
    <div class="ai-chat-body" id="aiChatBody">
      <div class="ai-msg assistant">
        <div class="ai-bubble">你好！我是 AI 管家 2.0，可以查客户、建客户/询盘/联系人、记沟通、建任务、跳转页面——写操作会先给你确认卡片。试试：「帮我新增客户：Acme Trading 德国 展会认识」。</div>
      </div>
    </div>
    <div class="ai-sugs" id="aiSugs">
      <button class="ai-sug">今天该跟进哪些客户？</button>
      <button class="ai-sug">最近7天有哪些新询盘？</button>
      <button class="ai-sug">总结当前商机情况</button>
      <button class="ai-sug">帮我创建任务：本周五整理报价单</button>
      <button class="ai-sug">查一下客户总数和各阶段分布</button>
      <button class="ai-sug">帮我记录：今天和客户电话沟通了试单细节</button>
    </div>
    <div class="ai-chat-input">
      <button id="aiChatAttach" class="ai-attach" type="button" title="上传文件（PDF/Word/Excel/TXT/CSV），AI 将解析内容用于登记客户/更新状态">📎</button>
      <input type="file" id="aiChatFile" class="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
      <input id="aiChatInput" placeholder="输入指令，Enter 发送…（可先 📎 上传文件）" autocomplete="off" />
      <button id="aiChatSend" class="btn-save" type="button">发送</button>
    </div>
  </div>
</div>
<div class="dashv2-row bot">
  <div class="dashv2-card todo-card">
    <div class="td-head"><span>待办清单</span><span class="td-sub" id="tdSub">加载中…</span><button class="td-add" id="tdAddBtn" title="新建任务">+</button></div>
    <div class="td-tabs">
      <button type="button" class="td-tab active" data-p="today">今日 <span id="tdC1">0</span></button>
      <button type="button" class="td-tab" data-p="overdue">超期 <span id="tdC2">0</span></button>
      <button type="button" class="td-tab" data-p="all">未完成 <span id="tdC3">0</span></button>
    </div>
    <div class="td-list" id="tdList"><div class="td-empty">加载中…</div></div>
  </div>
  <div class="dashv2-card rate-card">
    <div class="rc-head"><span>实时汇率</span><span class="rc-sub" id="rateTime">--</span></div>
    <div class="rate-rows">
      <div class="rate-row"><span>USD → CNY</span><b id="rc1">--</b></div>
      <div class="rate-row"><span>USD → EUR</span><b id="rc2">--</b></div>
      <div class="rate-row"><span>USD → GBP</span><b id="rc3">--</b></div>
      <div class="rate-row"><span>USD → AED</span><b id="rc4">--</b></div>
    </div>
    <button class="rc-refresh" id="rateRefreshBtn">刷新汇率</button>
  </div>
</div>`;
  const grid = v.querySelector('.section-grid') || v.querySelector('.bottom-grid');
  if (grid) v.insertBefore(div, grid); else v.appendChild(div);
  // ===== 待办清单：真实任务数据（/api/tasks 按 RBAC 过滤） =====
  let dashTasks = [];
  let tdFilter = 'today';
  function renderDashTodos() {
    const today = new Date().toISOString().slice(0, 10);
    const open = dashTasks.filter((t) => !['已完成', '已取消'].includes(t.status || '待办'));
    const todayList = open.filter((t) => t.dueDate === today);
    const overdueList = open.filter((t) => t.dueDate && t.dueDate < today);
    const priOrder = { '高': 0, '中': 1, '低': 2 };
    const sortByPri = (a, b) => (priOrder[a.priority || '中'] - priOrder[b.priority || '中']) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    $('#tdC1').textContent = todayList.length;
    $('#tdC2').textContent = overdueList.length;
    $('#tdC3').textContent = open.length;
    $('#tdSub').innerHTML = `今日 <b>${todayList.length}</b> · 超期 <b>${overdueList.length}</b> · 未完成 <b>${open.length}</b>`;
    let list = tdFilter === 'today' ? todayList : tdFilter === 'overdue' ? overdueList : open;
    list = list.slice().sort(sortByPri).slice(0, 30);
    const host = $('#tdList');
    if (!host) return;
    if (!list.length) { host.innerHTML = '<div class="td-empty">' + (tdFilter === 'today' ? '今日暂无待办任务' : tdFilter === 'overdue' ? '没有超期任务，保持得很好' : '没有未完成任务') + '</div>'; return; }
    host.innerHTML = list.map((t) => {
      const od = t.dueDate && t.dueDate < today;
      return `<div class="td-item ${t.status === '已完成' ? 'done' : ''}" data-id="${esc(t.id)}">
        <input type="checkbox" class="td-check" data-done="${esc(t.id)}" ${t.status === '已完成' ? 'checked' : ''} title="标记完成/重开" />
        <span class="td-title" title="${esc(t.notes || t.title)}">${esc(t.title)}</span>
        <span class="td-pri p${esc(t.priority || '中')}">${esc(t.priority || '中')}</span>
        <span class="td-date ${od ? 'od' : ''}">${esc(t.dueDate || '无日期')}</span>
      </div>`;
    }).join('');
    // 勾选完成/重开
    host.querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = cb.dataset.done;
      const t = dashTasks.find((x) => x.id === id); if (!t) return;
      const done = t.status !== '已完成';
      const body = done ? { status: '已完成', doneAt: Date.now() } : { status: '待办', doneAt: null };
      const r = await api('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify(body) });
      if (!r.ok) { toast('更新失败'); cb.checked = !cb.checked; return; }
      t.status = body.status;
      toast(done ? '已完成' : '已重开');
      renderDashTodos();
    }));
    // 点击行打开编辑
    host.querySelectorAll('.td-item').forEach((row) => row.addEventListener('click', () => {
      const id = row.dataset.id;
      if (typeof tasks !== 'undefined' && !tasks.some((x) => x.id === id) && typeof loadTasks === 'function') loadTasks().catch(() => {});
      if (typeof openTaskModal === 'function') setTimeout(() => openTaskModal(id), typeof loadTasks === 'function' ? 250 : 0);
    }));
  }
  div.querySelectorAll('.td-tab').forEach((t) => t.addEventListener('click', () => {
    div.querySelectorAll('.td-tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    tdFilter = t.dataset.p;
    renderDashTodos();
  }));
  api('/api/tasks').then((r) => r.json()).then((list) => { dashTasks = Array.isArray(list) ? list : []; renderDashTodos(); }).catch(() => { dashTasks = []; renderDashTodos(); });
  const addBtn = div.querySelector('#tdAddBtn'); if (addBtn) addBtn.addEventListener('click', () => { if (typeof openTaskModal === 'function') openTaskModal(null); });
  // AI 管家初始化
  initAiChat(div);
  div.querySelector('#aiChatInput').value = draft;
  // 汇率刷新统一由 ratesReady 同步，包含顶部刷新入口。
  function fillRatesCard() {
    const pairs = [['rc1', 'CNY'], ['rc2', 'EUR'], ['rc3', 'GBP'], ['rc4', 'AED']];
    pairs.forEach(([id, sym]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const v = (rateData && rateData.rates) ? rateData.rates[sym] : null;
      el.textContent = v ? v.toFixed(4) : '--';
    });
    const t = document.getElementById('rateTime');
    if (t) t.textContent = rateData ? ('更新 ' + new Date(rateData.updated).toLocaleTimeString()) : '--';
    const rs = document.getElementById('rateSource');
    if (rs) rs.textContent = rateData ? ('汇率源: ' + rateData.source) : '汇率源: 不可用';
    const cd = document.getElementById('connDot');
    if (cd) cd.style.background = rateData ? '#22c55e' : '#e25151';
  }
  window.fillDashboardRates = fillRatesCard;
  if (typeof loadRates === 'function' && !rateData) {
    loadRates().catch(() => {}).then(fillRatesCard);
  } else {
    fillRatesCard();
  }
  const rb = div.querySelector('#rateRefreshBtn');
  if (rb) rb.addEventListener('click', async () => {
    try { await loadRates(); } catch (e) {}
    fillRatesCard();
  });
}

// 销售管道（dashboard 设计稿：按询盘阶段分布）
function renderPipeline() {
  const el = $('#pipelineList');
  if (!el) return;
  const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
  const stages = (window.INQ_PIPELINE || []);
  const counts = stages.map((l) => ({
    code: l.code, label: l.label,
    count: inqs.filter((i) => (i.status || '新询盘') === l.code).length,
    amount: inqs.filter((i) => (i.status || '新询盘') === l.code).reduce((s, i) => s + (toCNY(Number(i.expectedAmount) || 0, i.currency) || 0), 0),
  }));
  const max = Math.max(1, ...counts.map((c) => c.count));
  if (!counts.length) { el.innerHTML = '<div class="empty">暂无管道数据</div>'; return; }
  el.innerHTML = counts.map((c) => {
    const pct = Math.round((c.count / max) * 100);
    const barClass = c.code === '成交' ? 'won' : (c.code === '报价' || c.code === '已报价' ? 'warm' : (c.code === '商务谈判' ? 'hot' : ''));
    return `<div class="pipeline-item">
      <div class="pipeline-stage">${esc(c.label)}</div>
      <div class="pipeline-bar-wrap"><div class="pipeline-bar ${barClass}" style="width:${pct}%"></div></div>
      <div class="pipeline-count">${c.count}</div>
      <div class="pipeline-amount">${fmtMoney(c.amount)}</div>
    </div>`;
  }).join('');
}

// 今日待办（dashboard 设计稿：待跟进询盘 + 今日任务）
function renderTodoList() {
  const el = $('#todoList');
  if (!el) return;
  const today = todayStr();
  const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
  const pending = inqs.filter((iq) => iq.nextFollowAt && iq.nextFollowAt <= today && (canSeeBusiness(iq.owner)));
  const tasks = typeof window.getAllTasks === 'function' ? window.getAllTasks().filter((t) => !['已完成', '已取消'].includes(t.status) && t.dueDate && t.dueDate <= today) : [];
  const rows = [];
  pending.forEach((iq) => {
    const overdue = iq.nextFollowAt < today;
    rows.push({
      type: 'follow',
      id: iq.id,
      clientId: iq.clientId,
      clientName: iq.clientName || '未指定客户',
      title: iq.product || '待跟进询盘',
      desc: `${esc(iq.status || '新询盘')} · 跟进人 ${esc(iq.ownerName || '-')}`,
      tagClass: overdue ? 'tag-overdue' : 'tag-follow',
      tagText: overdue ? '已逾期' : '今日跟进',
      date: iq.nextFollowAt,
    });
  });
  tasks.forEach((t) => {
    const overdue = t.dueDate < today;
    rows.push({
      type: 'task',
      id: t.id,
      title: t.title || '未命名任务',
      desc: `${esc(t.clientName || t.relatedName || '未关联客户')} · ${esc(t.status)}`,
      tagClass: overdue ? 'tag-overdue' : 'tag-follow',
      tagText: overdue ? '任务逾期' : '今日任务',
      date: t.dueDate,
    });
  });
  if (!rows.length) { el.innerHTML = '<div class="empty" style="padding:20px 16px">今天没有待办事项</div>'; return; }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  el.innerHTML = rows.map((r) => `<div class="todo-item" data-todo-type="${r.type}" data-todo-id="${esc(r.id)}" ${r.clientId ? `data-todo-client="${esc(r.clientId)}"` : ''}>
    <div class="todo-avatar">${esc((r.clientName || r.title).slice(0, 1).toUpperCase())}</div>
    <div class="todo-content">
      <div class="todo-title">${esc(r.title)}</div>
      <div class="todo-desc">${esc(r.desc)}</div>
      <span class="todo-tag ${r.tagClass}">${esc(r.tagText)}</span>
    </div>
    <div class="todo-date">${esc(r.date)}</div>
  </div>`).join('');
  el.querySelectorAll('.todo-item').forEach((row) => row.onclick = () => {
    const type = row.dataset.todoType;
    const cid = row.dataset.todoClient;
    if (cid) viewClientDetail(cid);
    else if (type === 'task') switchView('tasks');
    else if (type === 'follow' && typeof openInqModal === 'function') openInqModal(row.dataset.todoId);
  });
}

// 活跃商机（dashboard 设计稿：近 7 天有更新的询盘）
function renderOppList() {
  const el = $('#oppList');
  if (!el) return;
  const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
  const now = new Date();
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(now.getDate() - 7);
  const iso7 = sevenDaysAgo.toISOString().slice(0, 10);
  const recent = inqs.filter((iq) => {
    const updated = iq.updatedAt ? new Date(iq.updatedAt).toISOString().slice(0, 10) : (iq.receivedAt || '');
    return updated >= iso7;
  }).slice().sort((a, b) => (b.updatedAt || b.receivedAt || '') - (a.updatedAt || a.receivedAt || '')).slice(0, 8);
  if (!recent.length) { el.innerHTML = '<div class="empty" style="padding:20px 16px">近 7 天暂无活跃商机</div>'; return; }
  el.innerHTML = recent.map((iq) => {
    const amount = toCNY(Number(iq.expectedAmount) || 0, iq.currency) || 0;
    const stageClass = (iq.status || '新询盘') === '新询盘' ? 'stage-new' : ((iq.status || '').includes('报价') ? 'stage-quote' : 'stage-confirm');
    return `<div class="opp-card" data-opp-client="${esc(iq.clientId || '')}" data-opp-name="${esc(iq.clientName || '')}">
      <div class="opp-left">
        <div class="opp-avatar">${esc((iq.clientName || iq.product || '?').slice(0, 1).toUpperCase())}</div>
        <div class="opp-content">
          <div class="opp-name">${esc(iq.clientName || '未指定客户')}</div>
          <div class="opp-meta">${esc(iq.product || '—')} · ${esc(iq.country || '-')}</div>
        </div>
      </div>
      <div class="opp-right">
        <div class="opp-amount">${amount ? fmtMoney(amount) : '—'}</div>
        <span class="opp-status ${stageClass}">${esc(iq.status || '新询盘')}</span>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.opp-card').forEach((card) => card.onclick = () => {
    const cid = card.dataset.oppClient;
    if (cid) viewClientDetail(cid);
    else openClientDetailByName(card.dataset.oppName);
  });
}

function renderActionQueue(pending) {
  const el = $('#actionQueue');
  const countEl = $('#actionQueueCount');
  if (!el) return;
  const today = todayStr();
  const rows = [];
  pending.slice(0, 5).forEach((iq) => rows.push({
    tone: iq.nextFollowAt < today ? 'danger' : 'warn',
    label: iq.nextFollowAt < today ? '询盘逾期' : '今日跟进',
    name: iq.clientName || '未指定客户',
    meta: (iq.product || '未填写产品') + ' · ' + (iq.nextFollowAt || '-'),
    action: '打开询盘',
    fn: `data-action-inq="${esc(iq.id)}"`,
  }));
  const taskRows = typeof window.getAllTasks === 'function' ? window.getAllTasks().filter((t) => !['已完成', '已取消'].includes(t.status) && t.dueDate && t.dueDate <= today).slice(0, 5) : [];
  taskRows.forEach((t) => rows.push({
    tone: t.dueDate < today ? 'danger' : 'info',
    label: t.dueDate < today ? '任务逾期' : '今日任务',
    name: t.title || '未命名任务',
    meta: (t.clientName || t.relatedName || '未关联客户') + ' · ' + t.dueDate,
    action: '打开任务',
    fn: 'data-action-task="1"',
  }));
  if (countEl) countEl.textContent = rows.length;
  if (!rows.length) { el.innerHTML = '<div class="empty">今天没有重点待处理事项</div>'; return; }
  el.innerHTML = rows.slice(0, 8).map((r) => `<div class="action-row">
    <span class="action-tone ${r.tone}">${r.label}</span>
    <div class="action-main"><b>${esc(r.name)}</b><span>${esc(r.meta)}</span></div>
    <button class="link-btn" ${r.fn}>${r.action}</button>
  </div>`).join('');
  el.querySelectorAll('[data-action-inq]').forEach((b) => b.onclick = () => {
    if (typeof openInqModal === 'function') openInqModal(b.dataset.actionInq);
    else switchView('enquiry');
  });
  el.querySelectorAll('[data-action-task]').forEach((b) => b.onclick = () => switchView('tasks'));
}

// ---------- 销售漏斗（首页增强，复用询盘数据，按 status 阶段） ----------
function renderFunnel() {
  const el = $('#funnelBars');
  if (!el) return;
  const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
  const palette = ['var(--stage-1)', 'var(--stage-2)', 'var(--stage-3)', 'var(--stage-4)', 'var(--stage-5)', 'var(--stage-6)'];
  const counts = (window.INQ_PIPELINE || []).map((l, idx) => ({
    code: l.code, label: l.label,
    count: inqs.filter((i) => (i.status || '新询盘') === l.code).length,
    color: palette[idx % palette.length],
  }));
  const max = Math.max(1, ...counts.map((c) => c.count));
  el.innerHTML = counts.map((c) => {
    const pct = Math.round((c.count / max) * 100);
    return `<div class="bar-row">
      <span class="lbl">${c.label}</span>
      <span class="bar"><i style="width:${pct}%;background:${c.color}"></i></span>
      <span class="v">${c.count}</span>
    </div>`;
  }).join('');
}
window.renderFunnel = renderFunnel;

// ---------- AI 管家（首页对话式 CRM 管理，2.0：agent 编排 + ActionCard 确认） ----------
let aiChatHistory = []; // {role, content}
let aiChatBusy = false;
let aiChatDoc = null; // 兼容旧字段
let aiChatDocs = []; // 当前待提交的多个上传文件解析文本（一次性，随下一轮指令注入）

function aiChatScroll() {
  const body = $('#aiChatBody');
  if (body) body.scrollTop = body.scrollHeight;
}

function aiChatBubble(role, html) {
  const body = $('#aiChatBody');
  if (!body) return;
  const div = document.createElement('div');
  div.className = 'ai-msg ' + (role === 'user' ? 'user' : 'assistant');
  div.innerHTML = `<div class="ai-bubble">${html}</div>`;
  body.appendChild(div);
  aiChatScroll();
  return div;
}

// ---------- AI ActionCard 生命周期（跨视图重绘保持） ----------
// 问题：仪表盘每次 renderDashboard 都会整体重建 #aiChatBody，旧代码把卡片只放 DOM、
// 历史只存纯文本 → 卡片/执行反馈随任意一次 loadAll/切页被抹掉，用户看到「点击后没执行」。
// 修复：assistant 历史条目携带 cards[]（含 status），重绘时按状态重渲染并重新接线。
function aiCardHtmlWithStatus(action, idx, status) {
  let html = (window.agentActionCardHtml && typeof agentActionCardHtml === 'function') ? agentActionCardHtml(action, idx) : '';
  if (!html) return '';
  if (status === 'done') html = html.replace(/<div class="ag-btns">[\s\S]*?<\/div>/, '<div class="ag-btns"><span style="color:var(--ok,#16a34a)">✔ 已执行</span></div>');
  else if (status === 'cancel') html = html.replace(/<div class="ag-btns">[\s\S]*?<\/div>/, '<div class="ag-btns"><span class="muted">已取消</span></div>');
  return html;
}
function aiDoneText(doneMsgHtml) {
  const t = document.createElement('div');
  t.innerHTML = doneMsgHtml || '';
  return (t.textContent || '').trim();
}
// 在 host 内查找未接线的卡片并按 entry.cards 状态接线；执行成功/取消同步回写 entry，
// 使重绘后仍能还原「✔ 已执行 / 已取消」并保留成功消息
function wireAgentCardsIn(host, entry) {
  if (!host || !entry || !Array.isArray(entry.cards)) return;
  host.querySelectorAll('[data-ag-card]:not([data-wired])').forEach((card) => {
    card.dataset.wired = '1';
    const idx = Number(card.dataset.agCard);
    const rec = entry.cards[idx];
    if (!rec) return;
    if (rec.status === 'done' || rec.status === 'cancel') return;
    const meta = window.AGENT_ACTIONS && AGENT_ACTIONS[rec.tool];
    if (!meta) return;
    const cancelBtn = card.querySelector('.ag-cancel');
    const okBtn = card.querySelector('.ag-ok');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      rec.status = 'cancel';
      const btns = card.querySelector('.ag-btns');
      if (btns) btns.innerHTML = '<span class="muted">已取消</span>';
    });
    if (!okBtn) return;
    okBtn.addEventListener('click', async () => {
      const params = {};
      card.querySelectorAll('input[data-ag-k]').forEach((inp) => { params[inp.dataset.agK] = inp.value.trim(); });
      const missing = meta.fields.filter((f) => f.req && !params[f.k]);
      if (missing.length) { toast('请填写：' + missing.map((f) => f.label).join('、')); return; }
      okBtn.disabled = true; okBtn.textContent = '执行中…';
      try {
        const rr = await meta.exec(params);
        if (rr.ok) {
          rec.status = 'done'; rec.params = params;
          card.querySelector('.ag-btns').innerHTML = '<span style="color:var(--ok,#16a34a)">✔ 已执行</span>';
          aiChatBubble('assistant', meta.doneMsg(params));
          aiChatHistory.push({ role: 'assistant', content: aiDoneText(meta.doneMsg(params)) });
          wireAiGoLinks();
          if (typeof loadAll === 'function') loadAll().catch(() => {});
          if (typeof loadTasks === 'function') loadTasks().catch(() => {});
          window.dispatchEvent(new Event('ftw:dataReady'));
        } else {
          const jj = await rr.json().catch(() => ({}));
          okBtn.disabled = false; okBtn.textContent = '重试';
          aiChatBubble('assistant', '❌ 执行失败：' + esc(jj.error || ('HTTP ' + rr.status)));
        }
      } catch (e) {
        okBtn.disabled = false; okBtn.textContent = '重试';
        aiChatBubble('assistant', '❌ 执行失败：' + esc((e && e.message) || '网络错误'));
      }
    });
  });
}

// 聊天流内的跳转链接（查看任务/查看客户等）
function wireAiGoLinks() {
  const body = $('#aiChatBody');
  if (!body) return;
  body.querySelectorAll('[data-ai-go]:not([data-go-wired])').forEach((l) => {
    l.dataset.goWired = '1';
    l.addEventListener('click', (e) => { e.preventDefault(); switchView(l.dataset.aiGo); });
  });
}

// 📎 上传文件 → /api/parse-doc 解析 → 暂存文本，随下一轮指令注入 agent
function wireAiChatAttach() {
  const attach = $('#aiChatAttach');
  const fileInput = $('#aiChatFile');
  if (!attach || !fileInput || fileInput.dataset.wired) return;
  fileInput.dataset.wired = '1';
  function selectFiles() { fileInput.value = ''; fileInput.click(); }
  attach.addEventListener('click', (e) => { e.preventDefault(); selectFiles(); });
  fileInput.multiple = true;
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!files.length) return;
    const tooLarge = files.find(f => f.size > 20 * 1024 * 1024);
    if (tooLarge) { toast('单个文件不超过 20 MB：' + tooLarge.name); return; }
    const thinking = files.map(file => ({ file, node: aiChatBubble('assistant', '<span class="ai-thinking">解析《' + esc(file.name) + '》中<span class="dots"></span></span>') }));
    try {
      const loaded = [];
      for (const item of thinking) {
        const file = item.file;
        aiChatBubble('user', '📎 上传文件：' + esc(file.name));
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
        });
        const pr = await api('/api/parse-doc', { method: 'POST', timeout: 120000, body: JSON.stringify({ filename: file.name, data: b64 }) });
        const pj = await pr.json(); if (!pr.ok) throw new Error(file.name + '：' + (pj.error || '文件解析失败'));
        const MAX = 12000; const text = pj.text.length > MAX ? pj.text.slice(0, MAX) + '\n…（内容过长，已截取前 ' + MAX + ' 字）' : pj.text;
        loaded.push({ name: file.name, text });
        if (item.node) item.node.querySelector('.ai-bubble').innerHTML = `📄 已加载《${esc(file.name)}》（${pj.text.length} 字${pj.text.length > MAX ? '，已截取前 ' + MAX + ' 字' : ''}）。`;
      }
      aiChatDocs = loaded;
      aiChatDoc = loaded[0] || null;
      aiChatBubble('assistant', `已加载 ${loaded.length} 个文件。现在告诉我如何处理这些文件内容。`);
    } catch (err) {
      aiChatDocs = []; aiChatDoc = null;
      for (const item of thinking) if (item.node) item.node.querySelector('.ai-bubble').innerHTML = '❌ 文件解析失败：' + esc(err.message);
    }
    const input = $('#aiChatInput'); if (input) input.focus();
  });
}

async function sendAiChat(text) {
  text = (text || '').trim();
  if (!text || aiChatBusy) return;
  aiChatBusy = true;
  const input = $('#aiChatInput'); if (input) input.disabled = true;
  const sendBtn = $('#aiChatSend'); if (sendBtn) sendBtn.disabled = true;
  aiChatBubble('user', esc(text));
  const thinking = aiChatBubble('assistant', '<span class="ai-thinking">思考中<span class="dots"></span></span>');
  aiChatHistory.push({ role: 'user', content: text });
  try {
    // 走 agent 编排层：服务端执行查询工具（带 RBAC），写动作返回 ActionCard 由用户确认
    const msgs = [];
    if (aiChatDocs.length) {
      for (const doc of aiChatDocs) msgs.push({ role: 'user', content: '[用户上传文件《' + doc.name + '》的内容]\n' + doc.text });
    } else if (aiChatDoc) {
      msgs.push({ role: 'user', content: '[用户上传文件《' + aiChatDoc.name + '》的内容]\n' + aiChatDoc.text });
    }
    msgs.push(...aiChatHistory.slice(-12));
    const r = await api('/api/ai/agent', {
      method: 'POST',
      timeout: 300000, // 多轮工具循环耗时较长，单独放宽
      body: JSON.stringify({ messages: msgs }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'AI 调用失败');

    const parts = [];
    if (j.text) parts.push(esc(j.text).replace(/\n/g, '<br>'));
    const queryCards = (j.queryResults || []).map((q) => (window.agentQueryCardHtml ? agentQueryCardHtml(q) : '')).join('');
    if (queryCards) parts.push(queryCards);

    const actions = j.actions || [];
    const writes = actions.filter((a) => a && window.AGENT_ACTIONS && AGENT_ACTIONS[a.tool]);
    // assistant 历史条目携带待确认卡片（含状态），保证视图重绘后卡片与执行反馈不丢失
    const entry = {
      role: 'assistant',
      content: j.text || '',
      cards: writes.length ? writes.map((w) => ({ tool: w.tool, params: { ...(w.params || {}) }, say: w.say || '', status: 'pending' })) : undefined,
    };
    if (writes.length) parts.push(writes.map((a, i) => (window.agentActionCardHtml ? agentActionCardHtml(a, i) : '')).join(''));
    if (!parts.length) parts.push('（已执行操作）');

    if (thinking) { thinking.querySelector('.ai-bubble').innerHTML = parts.join(''); }
    aiChatHistory.push(entry);
    aiChatDocs = []; aiChatDoc = null; // 文件内容一次性注入，避免下一轮重复携带

    // navigate 动作直接执行（低风险，无需确认）
    const viewNames = { dashboard: '工作台', clients: '客户资料', enquiry: '询盘商机', orders: '订单数据', tasks: '任务日历', quotations: '报价管理', reminders: '提醒中心' };
    for (const nv of actions.filter((a) => a && a.tool === 'navigate')) {
      const v = nv.params && nv.params.view;
      if (v && viewNames[v]) {
        aiChatBubble('assistant', `📍 正在跳转到「${viewNames[v]}」…`);
        setTimeout(() => { try { switchView(v); } catch (e) {} }, 600);
      }
    }

    // ActionCard 交互：取消 / 确认执行（走现有 REST，继承权限与审计）
    if (thinking) wireAgentCardsIn(thinking, entry);
    const chatBody = $('#aiChatBody');
    if (chatBody && window.wireAgentQueryCards) wireAgentQueryCards(chatBody);
    wireAiGoLinks();
  } catch (e) {
    const msg = e && e.message ? e.message : 'AI 调用失败';
    const isCfg = /配置|未设置|model|baseUrl/i.test(msg);
    if (thinking) thinking.querySelector('.ai-bubble').innerHTML = isCfg
      ? `⚙️ AI 接口尚未配置。请先在 <a href="#" id="aiGoCfg">AI 助手设置</a> 中配置本地 Ollama / LM Studio 或云端接口。`
      : '⚠️ ' + esc(msg);
    const cfgLink = $('#aiGoCfg');
    if (cfgLink) cfgLink.addEventListener('click', (ev) => { ev.preventDefault(); if (typeof openAiSettings === 'function') openAiSettings(); });
    aiChatHistory.pop(); // 失败的这轮不入历史
  } finally {
    aiChatBusy = false;
    if (input) { input.disabled = false; input.focus(); }
    if (sendBtn) sendBtn.disabled = false;
    aiChatScroll();
  }
}

function initAiChat(div) {
  const input = div.querySelector('#aiChatInput');
  const sendBtn = div.querySelector('#aiChatSend');
  if (!input || !sendBtn) return;
  wireAiChatAttach();
  // 视图重绘后回放历史消息（aiChatHistory 在模块级保留；assistant 条目可能带待确认/已执行的 ActionCard）
  aiChatHistory.forEach((m) => {
    if (m.role !== 'user' && m.role !== 'assistant') return;
    const parts = [];
    if (m.content) {
      const clean = String(m.content).replace(/ACTION\s*[:：]\s*\{[^\n]*\}/g, '').trim();
      if (clean) parts.push(esc(clean).replace(/\n/g, '<br>'));
    }
    if (m.role === 'assistant' && Array.isArray(m.cards) && m.cards.length) {
      parts.push(m.cards.map((a, i) => aiCardHtmlWithStatus(a, i, a.status)).join(''));
    }
    if (!parts.length) return;
    const node = aiChatBubble(m.role, parts.join(''));
    if (m.role === 'assistant' && Array.isArray(m.cards) && m.cards.length) wireAgentCardsIn(node, m);
  });
  sendBtn.addEventListener('click', () => { const v = input.value; input.value = ''; sendAiChat(v); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { const v = input.value; input.value = ''; sendAiChat(v); } });
  div.querySelectorAll('.ai-sug').forEach((b) => b.addEventListener('click', () => sendAiChat(b.textContent.trim())));
  // 检查 AI 配置状态，未配置时提示
  api('/api/ai/config').then((r) => r.json()).then((cfg) => {
    const sub = $('#aiChatSub');
    if (cfg && cfg.baseUrl && cfg.model) { if (sub) sub.textContent = '已连接 ' + (cfg.model || ''); }
    else if (sub) { sub.innerHTML = '未配置 · <a href="#" id="aiCfgLink">去设置</a>'; const l = $('#aiCfgLink'); if (l) l.addEventListener('click', (e) => { e.preventDefault(); if (typeof openAiSettings === 'function') openAiSettings(); }); }
  }).catch(() => {});
}


function renderRevenueTrend() {
  const el = $('#revenueTrend');
  if (!el) return;
  // 最近 12 个月（含当月）
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  const vals = months.map((m) => orders
    .filter((o) => (o.orderDate || '').slice(0, 7) === m && !['已取消', 'Cancelled'].includes(o.status))
    .reduce((s, o) => s + (toCNY(Number(o.amount) || 0, o.currency) || 0), 0));
  const total = vals.reduce((s, v) => s + v, 0);
  if (!total) { el.innerHTML = '<div class="empty" style="padding:36px 0">暂无成交订单数据</div>'; return; }
  // 画布几何
  const W = 600, H = 270, PL = 50, PR = 18, PT = 18, PB = 30;
  const IW = W - PL - PR, IH = H - PT - PB;
  const niceMax = (() => {
    const raw = Math.max(...vals);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = Math.ceil(raw / (mag / 2)) * (mag / 2);
    return n || 1;
  })();
  const X = (i) => PL + (IW / 11) * i;
  const Y = (v) => PT + IH - (v / niceMax) * IH;
  const fmtK = (v) => v >= 1e8 ? (v / 1e8).toFixed(1) + '亿' : v >= 1e4 ? (v / 1e4).toFixed(v >= 1e5 ? 0 : 1) + '万' : Math.round(v).toLocaleString();
  // 网格线 + y 轴刻度
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = (niceMax / 4) * g;
    const y = Y(v);
    grid += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--line-2, #eee)" stroke-width="1"/>`
      + `<text x="${PL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted, #999)">${fmtK(v)}</text>`;
  }
  // 面积 + 折线路径
  const pts = vals.map((v, i) => [X(i), Y(v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${X(11)} ${PT + IH} L${PL} ${PT + IH} Z`;
  const dots = pts.map((p, i) => {
    const cur = i === 11;
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${cur ? 4.5 : 3}" fill="${cur ? 'var(--brand, #f1481e)' : 'var(--panel, #fff)'}" stroke="var(--brand, #5b8def)" stroke-width="2"><title>${months[i]}：¥${vals[i].toLocaleString(undefined, { maximumFractionDigits: 0 })}</title></circle>`;
  }).join('');
  const labels = months.map((m, i) => `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted, #999)">${i % 2 === 0 || i === 11 ? m.slice(5)+'月' : ''}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" tabindex="0" aria-label="近12个月收入趋势，左右方向键查看各月金额">
    <defs><linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--brand, #5b8def)" stop-opacity=".22"/>
      <stop offset="100%" stop-color="var(--brand, #5b8def)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#rtFill)"/>
    <path d="${line}" fill="none" stroke="var(--brand, #5b8def)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}<line class="rt-guide" x1="0" x2="0" y1="${PT}" y2="${PT+IH}" stroke="var(--brand,#2563eb)" stroke-dasharray="4 4" visibility="hidden"/><circle class="rt-active" r="6" fill="var(--brand,#2563eb)" stroke="white" stroke-width="2" visibility="hidden"/>
  </svg><div class="rt-tooltip" role="status" hidden></div>
  <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted,#999);margin-top:2px">
    <span>12 个月合计：<b style="color:var(--ink,#333)">${typeof fmtMoney === 'function' ? fmtMoney(total) : '¥' + Math.round(total).toLocaleString()}</b></span>
    <span>本月：<b style="color:var(--brand,#5b8def)">${typeof fmtMoney === 'function' ? fmtMoney(vals[11]) : '¥' + Math.round(vals[11]).toLocaleString()}</b></span>
  </div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.rt-tooltip');
  const guide = el.querySelector('.rt-guide'), active = el.querySelector('.rt-active');
  let selected = 11;
  function showMonth(i) {
    selected = Math.max(0, Math.min(11, i));
    const x = X(selected), y = Y(vals[selected]);
    guide.setAttribute('x1', x); guide.setAttribute('x2', x);
    active.setAttribute('cx', x); active.setAttribute('cy', y);
    guide.setAttribute('visibility', 'visible'); active.setAttribute('visibility', 'visible');
    tip.textContent = months[selected] + ' · ¥' + vals[selected].toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' CNY';
    tip.hidden = false;
    const point = new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());
    const box = el.getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(box.width-tip.offsetWidth, point.x-box.left-tip.offsetWidth/2)) + 'px';
    tip.style.top = Math.max(0, point.y-box.top-tip.offsetHeight-12) + 'px';
  }
  function hideTip() {tip.hidden=true;guide.setAttribute('visibility','hidden');active.setAttribute('visibility','hidden');}
  function pointMonth(e) {
    const point = new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    showMonth(Math.round((point.x-PL)/IW*11));
  }
  svg.addEventListener('pointermove', pointMonth);
  svg.addEventListener('pointerdown', pointMonth);
  svg.addEventListener('pointerleave', e => {if(e.pointerType !== 'touch')hideTip();});
  svg.addEventListener('focus', () => showMonth(selected));
  svg.addEventListener('blur', hideTip);
  svg.addEventListener('keydown', e => {
    if(e.key==='Escape'){hideTip();return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();showMonth(e.key==='Home'?0:e.key==='End'?11:selected+(e.key==='ArrowLeft'?-1:1));
  });

}
window.renderRevenueTrend = renderRevenueTrend;

// ---------- 客户 360° 详情 ----------
function viewClientDetail(clientId) {
  currentClientId = clientId;
  switchView('client-detail');
}

// ---------- 客户速览侧板（参考 ai-crm-vibe：列表右侧滑出详情） ----------
function openClientDrawer(clientId) {
  const drawer = $('#clientDrawer');
  const mask = $('#clientDrawerMask');
  const bodyEl = $('#clientDrawerBody');
  if (!drawer || !mask || !bodyEl) return;
  const c = clients.find((x) => x.id === clientId);
  if (!c) { toast('客户不存在'); return; }
  if(!drawer.classList.contains('open'))window.__clientDrawerReturnFocus=document.activeElement;
  drawer.inert=false;
  window.__openClientDrawerId = clientId; // 供保存后热刷新定位（v20260902d）
  const myOrders = orders.filter((o) => o.clientId === c.id || (o.clientName || '') === (c.company || ''));
  const myQuotes = window.getAllQuotations ? window.getAllQuotations().filter((x) => x.clientId === c.id || (x.clientName || '') === (c.company || '')) : [];
  const myInqs = window.getAllInquiries ? window.getAllInquiries().filter((x) => x.clientId === c.id || (x.clientName || '') === (c.company || '')) : [];
  const myComms = (window.getAllComms ? window.getAllComms() : [])
    .filter((x) => (x.clientName || '').trim().toLowerCase() === (c.company || '').trim().toLowerCase())
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const dealOrders = myOrders.filter((o) => ['已收款', '已发货'].includes(o.status || ''));
  const cumCNY = dealOrders.reduce((s, o) => s + (toCNY(Number(o.amount) || 0, o.currency) || 0), 0);
  const grade = gradeOf(c.stage);
  const gradeClass = 'tag-' + String(grade).toLowerCase().replace(/\+/g, 'plus');
  bodyEl.innerHTML = `
    <div class="cd-head">
      <div class="cd-avatar">${esc((c.company || '?').slice(0, 1).toUpperCase())}</div>
      <div class="cd-head-main">
        <div class="cd-name">${esc(c.company || '未命名')}</div>
        <div class="cd-sub">${esc(c.country || '未知国家')} · ${esc(c.contactName || '-')}</div>
        <span class="tag ${gradeClass}">${esc(grade)} 级客户</span>
      </div>
    </div>
    <div class="cd-actions">
      <button class="btn btn-primary" id="cdFull">360° 详情</button>
      <button class="btn btn-ghost" id="cdEdit">编辑</button>
      <button class="btn btn-ghost" id="cdInq">+ 询盘</button>
    </div>
    <div class="cd-kpis">
      <div class="cd-kpi"><b>${myInqs.length}</b><span>询盘</span></div>
      <div class="cd-kpi"><b>${myQuotes.length}</b><span>报价</span></div>
      <div class="cd-kpi"><b>${myOrders.length}</b><span>订单</span></div>
      <div class="cd-kpi"><b>${cumCNY ? fmtMoney(cumCNY) : '—'}</b><span>累计成交</span></div>
    </div>
    <div class="cd-sec">
      <div class="cd-sec-title">基本信息</div>
      <div class="cd-row"><span>邮箱</span><span>${esc(c.contactEmail || '-')}</span></div>
      <div class="cd-row"><span>电话</span><span>${esc(c.contactPhone || '-')}</span></div>
      <div class="cd-row"><span>来源</span><span>${esc(c.source || '-')}</span></div>
      <div class="cd-row"><span>阶段</span><span>${esc(phaseOf(c))}</span></div>
      <div class="cd-row"><span>跟进人</span><span>${esc(clientOwnerLabel(c))}</span></div>
      <div class="cd-row"><span>下次跟进</span><span>${esc(c.nextFollowUp || '—')}</span></div>
    </div>
    <div class="cd-sec">
      <div class="cd-sec-title">标签</div>
      <div class="cd-tags">${(c.tags || []).length ? (c.tags || []).map((t) => `<span class="cd-tag">${esc(t)}</span>`).join('') : '<span class="muted">暂无标签</span>'}</div>
    </div>
    <div class="cd-sec">
      <div class="cd-sec-title">最近沟通</div>
      ${myComms.length ? myComms.slice(0, 5).map((m) => `
        <div class="cd-comm">
          <div class="cd-comm-date">${esc(m.date || '')} · ${esc(m.channel || m.type || '')}</div>
          <div class="cd-comm-txt">${esc((m.content || '').slice(0, 80))}${(m.content || '').length > 80 ? '…' : ''}</div>
        </div>`).join('') : '<div class="muted">暂无沟通记录</div>'}
    </div>`;
  drawer.classList.add('open');
  mask.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  $('#clientDrawerClose').focus({preventScroll:true});
  bodyEl.querySelector('#cdFull').addEventListener('click', () => { closeClientDrawer(); viewClientDetail(clientId); });
  bodyEl.querySelector('#cdEdit').addEventListener('click', () => { closeClientDrawer(); openClientModal(clientId); });
  bodyEl.querySelector('#cdInq').addEventListener('click', () => { closeClientDrawer(); if (typeof openInqModal === 'function') openInqModal(null, { clientId: c.id, clientName: c.company }); });
}
function closeClientDrawer() {
  const drawer = $('#clientDrawer');
  const mask = $('#clientDrawerMask');
  window.__openClientDrawerId = null;
  if (drawer) { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); drawer.inert=true; }
  if(window.__clientDrawerReturnFocus?.isConnected)window.__clientDrawerReturnFocus.focus({preventScroll:true});
  window.__clientDrawerReturnFocus=null;
  if (mask) mask.classList.remove('open');
}
window.openClientDrawer = openClientDrawer;
window.closeClientDrawer = closeClientDrawer;
(function initClientDrawer() {
  $('#clientDrawerClose')?.addEventListener('click', closeClientDrawer);
  $('#clientDrawerMask')?.addEventListener('click', closeClientDrawer);
  document.addEventListener('keydown', (e) => {
    if(!$('#clientDrawer')?.classList.contains('open'))return;
    if(e.key==='Escape'){e.preventDefault();closeClientDrawer();}
    if(e.key==='Tab'){const els=[...$('#clientDrawer').querySelectorAll('button,a[href],input,select,[tabindex="0"]')].filter(el=>!el.disabled&&el.offsetParent!==null);const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  });
})();

function renderClientDetail() {
  const container = $('#view-client-detail');
  if (!container) return;
  const profile = $('#cdProfile');
  const body = $('#cdBody');
  if (!currentClientId) {
    if (profile) profile.innerHTML = '';
    if (body) body.innerHTML = '<div class="empty">未选择客户</div>';
    return;
  }
  const c = clients.find((x) => x.id === currentClientId);
  if (!c) {
    if (profile) profile.innerHTML = '';
    if (body) body.innerHTML = '<div class="empty">客户不存在</div>';
    return;
  }
  const myOrders = orders.filter((o) => o.clientId === c.id || (o.clientName || '') === (c.company || ''));
  const myQuotes = (window.getAllQuotations ? window.getAllQuotations().filter((x) => x.clientId === c.id || (x.clientName || '') === (c.company || '')) : [])
    .slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const myInqs = (window.getAllInquiries ? window.getAllInquiries().filter((x) => x.clientId === c.id || (x.clientName || '') === (c.company || '')) : [])
    .slice().sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  const myComms = (window.getAllComms ? window.getAllComms() : []).filter((x) => (x.clientName || '').trim().toLowerCase() === (c.company || '').trim().toLowerCase()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const myChats = (window.getAllChats ? window.getAllChats() : []).filter((x) => (x.clientName || '').trim().toLowerCase() === (c.company || '').trim().toLowerCase()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const qtTotalOf = (q) => (q.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const consAll = (window.getContactsByClient ? window.getContactsByClient(c.id) : []);
  const prim = consAll.find((x) => x.isPrimary) || consAll[0];
  const createdAtStr = (c.createdAt || c.updatedAt) ? new Date(c.createdAt || c.updatedAt).toISOString().slice(0, 10) : '-';
  const dealOrders = myOrders.filter((o) => ['已收款', '已发货'].includes(o.status || ''));
  const cumCNY = dealOrders.reduce((s, o) => s + (toCNY(Number(o.amount) || 0, o.currency) || 0), 0);
  const dealDates = dealOrders.map((o) => o.orderDate || o.deliveryDate || (o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : '')).filter(Boolean).sort();
  const lastDeal = dealDates.length ? dealDates[dealDates.length - 1] : '-';
  const gradeClass = 'tag-' + String(gradeOf(c.stage)).toLowerCase().replace(/\+/g, 'plus');

  if (profile) {
    profile.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar">${esc((c.company || '?').slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="profile-name">${esc(c.company || '未命名')}</div>
          <div class="profile-sub">${esc(c.country || '未知国家')} · ${esc(c.contactName || '-')}</div>
          <span class="profile-grade ${gradeClass}">${esc(gradeOf(c.stage))} 级客户</span>
        </div>
      </div>
      <div class="profile-actions">
        <button class="btn btn-primary" id="cdNewInquiry">+ 询盘</button>
        <button class="btn btn-ghost" id="cdNewQuote">+ 报价</button>
        <button class="btn btn-ghost" id="cdNewOrder">+ 订单</button>
      </div>
      <div class="profile-section">
        <div class="profile-sec-title">基本信息</div>
        <div class="profile-row"><span>联系人</span><span>${esc(c.contactName || '-')}</span></div>
        <div class="profile-row"><span>邮箱</span><span>${esc(c.contactEmail || '-')}</span></div>
        <div class="profile-row"><span>电话</span><span>${esc(c.contactPhone || '-')}</span></div>
        <div class="profile-row"><span>来源</span><span>${esc(c.source || '-')}</span></div>
        <div class="profile-row"><span>创建日期</span><span>${esc(createdAtStr)}</span></div>
        <div class="profile-row"><span>上次成交</span><span>${esc(lastDeal)}</span></div>
        <div class="profile-row"><span>累计成交</span><span>${cumCNY ? fmtMoney(cumCNY) : '—'}</span></div>
        <div class="profile-row"><span>跟进人</span><span>${esc(c.ownerName || '-')}</span></div>
      </div>
      <div class="profile-section">
        <div class="profile-sec-title">标签</div>
        <div class="profile-tags">
          ${(c.tags || []).length ? (c.tags || []).map((t) => `<span class="profile-tag">${esc(t)}</span>`).join('') : '<span class="muted">暂无标签</span>'}
        </div>
      </div>
      <div class="profile-section">
        <div class="profile-sec-title">备注</div>
        <textarea id="cdNotes" class="notes-area" placeholder="记录客户偏好、关键人关系等…">${esc(c.notes || '')}</textarea>
        <button class="btn btn-primary" id="cdSaveNotes" style="margin-top:10px;width:100%">保存备注</button>
      </div>
    `;
  }

  // 平铺渲染全部区块（360° 视图不折叠）
  renderClientDetailAll();

  // 绑定 profile 内按钮
  const cdNewInquiry = $('#cdNewInquiry');
  if (cdNewInquiry) cdNewInquiry.onclick = () => { if (typeof openInqModal === 'function') openInqModal({ clientId: c.id, clientName: c.company, country: c.country, contactName: c.contactName, currency: 'USD', receivedAt: todayStr(), status: '新询盘' }); };
  const cdNewQuote = $('#cdNewQuote');
  if (cdNewQuote) cdNewQuote.onclick = () => { if (typeof openQuoteModal === 'function') openQuoteModal(null, { clientName: c.company, clientId: c.id, contactName: c.contactName }); };
  const cdNewOrder = $('#cdNewOrder');
  if (cdNewOrder) cdNewOrder.onclick = () => openOrderModal(null, { clientName: c.company, clientId: c.id, country: c.country });
  const cdSaveNotes = $('#cdSaveNotes');
  if (cdSaveNotes) cdSaveNotes.onclick = async () => {
    const v = $('#cdNotes').value;
    const idx = clients.findIndex((x) => x.id === currentClientId);
    if (idx >= 0) clients[idx].notes = v;
    await api('/api/clients/' + currentClientId, { method: 'PUT', body: JSON.stringify({ notes: v }) });
    toast('备注已保存');
  };
}

const CD_TAB_TITLES = { timeline: '时间线', quotes: '报价单', orders: '订单', comms: '沟通', contacts: '联系人' };

// Each customer's history remembers its selected year during this session.
const clientHistoryYears=new Map();
function clientRecordDate(record,kind){
 const raw=kind==='orders'?record.orderDate:kind==='quotes'?record.createdAt:kind==='inquiries'?record.receivedAt:kind==='comms'?record.date:record.createdAt;
 const dateOf=v=>{if(!v)return '';const d=typeof v==='number'?fmtDateShort(v):String(v).slice(0,10);const parsed=new Date(d+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(parsed)&&parsed.toISOString().slice(0,10)===d?d:'';};
 return dateOf(raw)||dateOf(record.createdAt);
}
function clientHistoryRecords(c){
 const match=x=>x.clientId?String(x.clientId)===String(c.id):!!c.company&&(x.clientName||'').trim().toLowerCase()===c.company.trim().toLowerCase();
 return {orders:orders.filter(match),quotes:(window.getAllQuotations?.()||[]).filter(match),inquiries:(window.getAllInquiries?.()||[]).filter(match),comms:(window.getAllComms?.()||[]).filter(match),chats:(window.getAllChats?.()||[]).filter(match)};
}
function clientYearMatches(record,kind){const year=clientHistoryYears.get(currentClientId)||'all';return year==='all'||(clientRecordDate(record,kind).slice(0,4)||'unknown')===year;}
function renderClientDetailAll() {
 const body=$('#cdBody'),c=clients.find(x=>x.id===currentClientId);if(!body||!c)return;
 const records=clientHistoryRecords(c),years=[...new Set(Object.entries(records).flatMap(([kind,rows])=>rows.map(r=>clientRecordDate(r,kind).slice(0,4)||'unknown')))];
 years.sort((a,b)=>a==='unknown'?1:b==='unknown'?-1:b.localeCompare(a));
 let selected=clientHistoryYears.get(currentClientId);if(!selected||(selected!=='all'&&!years.includes(selected)))selected=years[0]||'all';clientHistoryYears.set(currentClientId,selected);
 const selectedOrders=records.orders.filter(o=>clientYearMatches(o,'orders')),active=selectedOrders.filter(o=>!['已取消','Cancelled'].includes(o.status)),amounts=active.map(o=>toCNY(Number(o.amount)||0,o.currency)),missing=amounts.filter(v=>v==null).length;
 body.innerHTML=`<div class="client-year-toolbar"><div><h3>客户业务档案</h3><p>按业务日期归档，缺失时使用创建日期；左侧累计成交为全部年份。</p></div><label>查看年份<select id="cdYear" data-no-combo><option value="all">全部年份</option>${years.map(y=>`<option value="${y}">${y==='unknown'?'日期未填写':y+' 年'}</option>`).join('')}</select></label></div><div class="client-year-summary"><div><span>订单数</span><strong>${selectedOrders.length}<small> 笔</small></strong></div><div><span>订单金额 · 未取消</span><strong>${fmtMoney(amounts.reduce((n,v)=>n+(v||0),0))}</strong>${missing?`<small>${missing} 笔汇率缺失，未计金额</small>`:''}</div><div><span>报价数</span><strong>${records.quotes.filter(q=>clientYearMatches(q,'quotes')).length}<small> 份</small></strong></div></div>`+['orders','quotes','timeline','comms','contacts'].map(t=>`<section class="detail-section" data-client-section="${t}"><h3 class="detail-sec-title">${CD_TAB_TITLES[t]||t}${t==='contacts'?' · 全部':''}</h3><div class="detail-sec-body">${detailTabHtml(t)}</div></section>`).join('');
 $('#cdYear').value=selected;$('#cdYear').onchange=e=>{clientHistoryYears.set(currentClientId,e.target.value);renderClientDetailAll();};
 body.querySelectorAll('[data-client-order]').forEach(b=>b.onclick=()=>openOrderDetail(b.dataset.clientOrder));
}

function detailTabHtml(tab) {
  if (!currentClientId) return '<div class="empty">未选择客户</div>';
  const c = clients.find((x) => x.id === currentClientId);
  if (!c) return '<div class="empty">客户不存在</div>';
  const records=clientHistoryRecords(c);
  const filtered=kind=>records[kind].filter(r=>clientYearMatches(r,kind)).sort((a,b)=>clientRecordDate(b,kind).localeCompare(clientRecordDate(a,kind)));
  const myOrders=filtered('orders'),myQuotes=filtered('quotes'),myInqs=filtered('inquiries'),myComms=filtered('comms'),myChats=filtered('chats');
  const qtTotalOf = (q) => (q.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const consAll = (window.getContactsByClient ? window.getContactsByClient(c.id) : []);

  if (tab === 'timeline') {
    const timeline = [
      ...myInqs.map((x) => ({ date: clientRecordDate(x,'inquiries'), type: 'inquiry', title: '新询盘：' + (x.product || '未指定产品'), meta: x.status || '新询盘', clientId: x.clientId, clientName: x.clientName, id: x.id })),
      ...myQuotes.map((x) => ({ date: clientRecordDate(x,'quotes'), type: 'quote', title: '报价：' + (x.quoteNo || '报价单'), meta: (x.status || '草稿') + ' · ' + qtTotalOf(x).toLocaleString() + ' ' + (x.currency || 'USD'), id: x.id })),
      ...myOrders.map((x) => ({ date: clientRecordDate(x,'orders'), type: 'order', title: '订单：' + (x.orderNo || '订单'), meta: x.status || '' })),
      ...myComms.map((x) => ({ date: x.date || '', type: 'chat', title: x.summary || '沟通记录', meta: (x.content || '').slice(0, 80) })),
      ...myChats.map((x) => ({ date: fmtDateShort(x.createdAt), type: 'chat', title: x.title || '聊天记录', meta: (x.raw || '').slice(0, 80) })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return timeline.length ? `<div class="timeline">${timeline.map((x) => `<div class="timeline-item">
      <div class="timeline-dot ${x.type}"></div>
      <div class="timeline-date">${esc(x.date||'日期未填写')}</div>
      <div class="timeline-title">${esc(x.title)}</div>
      ${x.meta ? `<div class="timeline-desc">${esc(x.meta)}</div>` : ''}
    </div>`).join('')}</div>` : '<div class="empty">暂无时间线记录</div>';
  }
  if (tab === 'quotes') {
    return myQuotes.length ? `<table class="data-table"><thead><tr><th>报价单号</th><th>项目</th><th>金额</th><th>折合 CNY</th><th>状态</th><th>有效期</th></tr></thead><tbody>${myQuotes.map((q) => `<tr>
      <td><span class="quote-no mono">${esc(q.quoteNo || '-')}</span></td>
      <td>${esc(q.projectName || '-')}</td>
      <td class="amount">${qtTotalOf(q).toLocaleString()} ${esc(q.currency || '')}</td>
      <td class="amount cny">${toCNY(qtTotalOf(q), q.currency) != null ? fmtMoney(toCNY(qtTotalOf(q), q.currency)) : '—'}</td>
      <td>${qtStatusTag(q.status)}</td>
      <td class="date">${esc(q.validUntil || '-')}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无报价单</div>';
  }
  if (tab === 'orders') {
    return myOrders.length ? `<table class="data-table"><thead><tr><th>订单号</th><th>金额</th><th>折合 CNY</th><th>状态</th><th>下单日期</th><th>交期</th></tr></thead><tbody>${myOrders.map((o) => `<tr>
      <td><button type="button" class="sales-link" data-client-order="${esc(o.id)}">${esc(o.orderNo || '-')}</button></td>
      <td class="amount">${(Number(o.amount) || 0).toLocaleString()} ${esc(o.currency || '')}</td>
      <td class="amount cny">${toCNY(Number(o.amount) || 0, o.currency) != null ? fmtMoney(toCNY(Number(o.amount) || 0, o.currency)) : '—'}</td>
      <td>${orderStatusTag(o.status)}</td>
      <td class="date">${esc(o.orderDate || '-')}</td>
      <td class="date">${esc(o.deliveryDate || '-')}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无订单</div>';
  }
  if (tab === 'comms') {
    return myComms.length ? `<div class="timeline">${myComms.map((x) => `<div class="timeline-item">
      <div class="timeline-dot chat"></div>
      <div class="timeline-date">${esc(x.date || '')}</div>
      <div class="timeline-title">${esc(x.summary || '沟通记录')}</div>
      <div class="timeline-desc">${esc(x.content || '')}</div>
    </div>`).join('')}</div>` : '<div class="empty">暂无沟通记录</div>';
  }
  if (tab === 'contacts') {
    return consAll.length ? `<table class="data-table"><thead><tr><th>姓名</th><th>职位</th><th>邮箱</th><th>电话</th></tr></thead><tbody>${consAll.map((x) => `<tr>
      <td>${esc(x.name || '-')}${x.isPrimary ? ' <span class="status-tag status-confirmed">主联系人</span>' : ''}</td>
      <td>${esc(x.title || x.role || '-')}</td>
      <td>${esc(x.email || '-')}</td>
      <td>${esc(x.phone || '-')}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无联系人</div>';
  }
  return '';
}

function fmtDateShort(ts) {
  if (!ts) return '';
  try { return new Date(ts).toISOString().slice(0, 10); } catch { return String(ts).slice(0, 10); }
}

function qtStatusTag(st) {
  const map = { '草稿': 'draft', '已发送': 'sent', '客户确认': 'confirmed', '客户拒绝': 'rejected', '已过期': 'expired', '已转订单': 'ordered' };
  return `<span class="status-tag status-${map[st] || 'draft'}">${esc(st || '草稿')}</span>`;
}

function orderStatusTag(st) {
  const map = { '待确认': 'pending', '已确认': 'confirmed', '生产中': 'producing', '已发货': 'shipped', '已收款': 'paid', '已完成': 'completed', '已取消': 'cancelled' };
  return `<span class="status-tag status-${map[st] || 'pending'}">${esc(st || '待确认')}</span>`;
}

// ---------- 客户表格（勾选批量编辑） ----------
let clientSelected = new Set();
let orderSelected = new Set();
let clientFilter = { country: '', source: '', grade: '', deal: '', tag: '', follow: '' };

// 计算客户最近一次跟进日期：取该客户名下询盘的最后跟进/接收日期与客户自身记录的最近跟进日期中最新的一条
function lastFollowOf(c) {
  const dates = [];
  if (c.lastFollowAt) dates.push(c.lastFollowAt);
  if (window.getAllInquiries) {
    const inqs = window.getAllInquiries() || [];
    inqs.forEach((iq) => {
      const hit = (iq.clientName || '').trim() && (iq.clientName || '').trim() === (c.company || '').trim();
      if (!hit) return;
      if (iq.lastFollowAt) dates.push(iq.lastFollowAt);
      if (iq.receivedAt) dates.push(String(iq.receivedAt).slice(0, 10));
    });
  }
  if (!dates.length) return '';
  return dates.sort().filter(Boolean).pop();
}
// 客户是否「超30天未跟进」：有最近跟进日期则看距今；从未跟进则看创建距今
function isStaleClient(c) {
  const last = lastFollowOf(c);
  const base = last || (c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '');
  if (!base) return false;
  const d = new Date(base); if (isNaN(+d)) return false;
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  return d < d30;
}
// ================= 客户与线索（新版界面 v20260824a） =================
const CLIENT_PHASES = ['未补充', '线索', '初步接触', '报价中', '谈判', '成交', '流失'];
const _OLD_PHASE_MAP = { '潜在': '线索', '跟进中': '初步接触', '报价': '报价中', '样品': '谈判', '成交': '成交', '流失': '流失' };
let clientStageFilter = '';   // 阶段页签
let clientCatFilter = '';     // 客户分类 chip（取 tags）
let clientEditMode = false;   // 编辑模式：显示批量栏 + 行内改级别
const revealedPhones = new Set(); // 已点「显示」的手机号（仅当前会话）

// ===== 在途询盘 × 客户阶段联动（v20260902d 询盘×客户关联批次）=====
// 在途 = 仍处于成交前的询盘状态
const ACTIVE_INQ_STATUSES = ['新询盘', '已报价', '等回复', '谈判中'];
// 询盘状态 → 客户阶段 映射（看板阶段与客户阶段两套词汇的桥）
const _INQ_PHASE_MAP = { '新询盘': '初步接触', '已报价': '报价中', '等回复': '报价中', '谈判中': '谈判' };
// 询盘与客户的匹配：clientId 优先，无则公司名 trim+lowercase 宽松匹配（兼容历史数据只存名字）
function inqMatchesClient(iq, c) {
  if (!iq || !c) return false;
  if (iq.clientId && c.id && String(iq.clientId) === String(c.id)) return true;
  const a = String(iq.clientName || '').trim().toLowerCase();
  const b = String(c.company || '').trim().toLowerCase();
  return !!a && !!b && a === b;
}
// 客户名下的在途询盘（决策点A：按最近更新倒序，徽标取第一条）
function activeInquiriesOf(c) {
  if (!window.getAllInquiries) return [];
  return (window.getAllInquiries() || [])
    .filter((iq) => ACTIVE_INQ_STATUSES.includes(iq.status || '新询盘') && inqMatchesClient(iq, c))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
// 客户阶段推导（不落盘）：手工 phase > 在途询盘映射 > 历史stage映射 > 有单=成交 > 未补充
// 决策点B：客户档案明确设置过的 phase 永远优先于自动推导
function phaseOf(c) {
  if (c.phase && CLIENT_PHASES.includes(c.phase)) return c.phase;
  const act = activeInquiriesOf(c);
  if (act.length && _INQ_PHASE_MAP[act[0].status || '新询盘']) return _INQ_PHASE_MAP[act[0].status || '新询盘'];
  if (_OLD_PHASE_MAP[c.stage]) return _OLD_PHASE_MAP[c.stage];
  if (clientHasOrder(c)) return '成交';
  return '未补充';
}
// 客户编号：由创建时间生成 YYMMDD（与询盘编号风格一致）
function clientCode(c) {
  const t = c.createdAt || c.updatedAt;
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(+d)) return '';
  return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
// 最新报价：取该客户最近一张报价单
function latestQuoteOf(c) {
  if (!window.getAllQuotations) return null;
  const qs = (window.getAllQuotations() || []).filter((q) => (q.clientName || '').trim() === (c.company || '').trim());
  if (!qs.length) return null;
  qs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return qs[0];
}
function fmtQuote(q) {
  if (!q) return '-';
  const sym = { USD: '$', CNY: '¥', EUR: '€', GBP: '£' }[q.currency] || (q.currency ? q.currency + ' ' : '$');
  const n = Number(q.totalAmount != null ? q.totalAmount : q.amount) || 0;
  return sym + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
// 产品兴趣：客户字段优先，其次取最近询盘的产品
function productInterestOf(c) {
  if (c.productInterest) return c.productInterest;
  if (window.getAllInquiries) {
    const iqs = (window.getAllInquiries() || []).filter((iq) => (iq.clientName || '').trim() === (c.company || '').trim() && iq.product);
    if (iqs.length) {
      iqs.sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
      return iqs[0].product;
    }
  }
  return '';
}
// 最新沟通进展（沟通记录模块）
function latestCommOf(c) {
  if (!window.getAllComms) return null;
  const cs = (window.getAllComms() || []).filter((x) => (x.clientName || '').trim() === (c.company || '').trim() && (x.content || '').trim());
  if (!cs.length) return null;
  cs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return cs[0];
}
// 跟进健康度 0-100：距今越久未跟进分越低；成交客户保底 60
function healthScoreOf(c) {
  const last = lastFollowOf(c);
  const base = last || (c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '');
  let score = 30;
  if (base) {
    const days = Math.floor((Date.now() - new Date(base).getTime()) / 86400000);
    if (!isNaN(days)) score = Math.max(5, 100 - Math.max(0, days) * 3);
  }
  if (clientHasOrder(c)) score = Math.max(score, 60);
  return Math.min(100, Math.round(score));
}
function healthClass(s) { return s >= 80 ? 'h-high' : (s >= 50 ? 'h-mid' : 'h-low'); }
// 手机号脱敏：前3 + **** + 后4
function maskPhone(p) {
  const s = String(p || '').replace(/\s+/g, '');
  if (!s) return '-';
  if (s.length <= 7) return s.slice(0, 2) + '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
}
// 最后跟进的相对时间标签
function relDayOf(dateStr) {
  if (!dateStr) return { label: '-', cls: '' };
  const today = todayStr();
  if (dateStr === today) return { label: '今天', cls: 'rf-today' };
  const diff = Math.floor((new Date(today) - new Date(dateStr)) / 86400000);
  if (diff === 1) return { label: '昨天', cls: 'rf-soon' };
  if (diff > 1 && diff <= 7) return { label: diff + ' 天前', cls: 'rf-soon' };
  if (diff > 7 && diff <= 30) return { label: diff + ' 天前', cls: 'rf-mid' };
  return { label: dateStr.slice(5).replace('-', '/'), cls: 'rf-old' };
}

// 阶段页签（含数量）
function renderClientStageTabs(base) {
  const el = $('#clientStageTabs');
  if (!el) return;
  const counts = {};
  base.forEach((c) => { const p = phaseOf(c); counts[p] = (counts[p] || 0) + 1; });
  const tabs = [''].concat(CLIENT_PHASES);
  el.innerHTML = tabs.map((p) => {
    const label = p || '全部';
    return `<button class="cl-tab ${clientStageFilter === p ? 'active' : ''}" data-stage="${esc(p)}">${esc(label)}</button>`;
  }).join('');
  el.querySelectorAll('.cl-tab').forEach((b) => b.addEventListener('click', () => {
    clientStageFilter = b.dataset.stage;
    renderClients();
  }));
}
// 客户分类 chips（取 tags，按数量降序）
function renderClientCatChips(base) {
  const el = $('#clientCatChips');
  if (!el) return;
  const counts = new Map();
  base.forEach((c) => (c.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const tags = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  el.innerHTML = `<button class="cl-chip ${!clientCatFilter ? 'active' : ''}" data-cat="">全部</button>`
    + tags.map((t) => `<button class="cl-chip ${clientCatFilter === t ? 'active' : ''}" data-cat="${esc(t)}">${esc(t)} <span class="cl-chip-n">(${counts.get(t)})</span></button>`).join('');
  el.querySelectorAll('.cl-chip').forEach((b) => b.addEventListener('click', () => {
    clientCatFilter = b.dataset.cat;
    renderClients();
  }));
}

async function updateClientField(id, patch, okMsg) {
  const r = await api('/api/clients/' + id, { method: 'PUT', body: JSON.stringify(patch) });
  if (!r.ok) { toast('保存失败'); return; }
  const c = clients.find((x) => x.id === id);
  if (c) Object.assign(c, patch);
  if (okMsg) toast(okMsg);
  renderClients();
}

// ===== 界面偏好：列顺序 / 列设置，本地 + 服务端双写（2026-08-31）=====
// 背景：原来只写 localStorage，换浏览器、清缓存、或从别的地址（localhost / IP）打开就会丢。
// 现在同时写服务端 settings.json 的 uiPrefs[用户ID]，同一账号在任何设备登录后自动同步。
const UI_COLS_KEY = 'ftw_table_cols_v1';
function uiPrefUid() { return (currentUser && (currentUser.id || currentUser.username)) || ''; }
async function loadUiPrefs() {
  const uid = uiPrefUid();
  if (!uid) return;
  try {
    const r = await api('/api/settings');
    if (!r || !r.ok) return;
    const s = (await r.json().catch(() => ({}))) || {};
    const mine = (s.uiPrefs || {})[uid] || null;
    window.__uiPrefs = mine || {};
    if (!mine) return;
    // 服务端为准：覆盖本地，保证同一账号在多台电脑上一致
    if (Array.isArray(mine.clientColOrder) && mine.clientColOrder.length) {
      try { localStorage.setItem(CLIENT_COL_ORDER_KEY, JSON.stringify(mine.clientColOrder)); } catch (e) {}
    }
    if (mine.clientColWidths && typeof mine.clientColWidths === 'object' && Object.keys(mine.clientColWidths).length) {
      try { localStorage.setItem(CLIENT_COL_WIDTH_KEY, JSON.stringify(mine.clientColWidths)); } catch (e) {}
      clWidthsCache = null; // 服务端为准，重置缓存让下次应用时重新读取
    }
    if (mine.tableCols && typeof mine.tableCols === 'object') {
      try { localStorage.setItem(UI_COLS_KEY, JSON.stringify(mine.tableCols)); } catch (e) {}
    }
  } catch (e) { /* 读不到服务端偏好就用本地配置，不影响使用 */ }
}
function saveUiPref(patch) {
  const uid = uiPrefUid();
  if (!uid) return;
  (async () => {
    try {
      const r = await api('/api/settings');
      const s = (r && r.ok) ? ((await r.json().catch(() => ({}))) || {}) : {};
      const all = s.uiPrefs || {};
      all[uid] = Object.assign({}, all[uid] || {}, patch);
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ uiPrefs: all }) });
    } catch (e) { console.warn('界面偏好保存失败', e); }
  })();
}

// ===== 客户列表列顺序：拖拽表头调整，本地 + 服务端持久化 =====
const CLIENT_COL_ORDER_KEY = 'ftw_client_col_order';
let clDragColKey = null;
let clResizing = false;
function clColDefaults() {
  const tr = document.querySelector('.cl-table thead tr');
  if (!tr) return [];
  if (!tr.__defaultColOrder) tr.__defaultColOrder = Array.from(tr.cells).filter(th => th.dataset.col).map(th => th.dataset.col);
  return tr.__defaultColOrder.slice();
}
function clColOrder() {
  const defaults = clColDefaults();
  try {
    const saved = JSON.parse(localStorage.getItem(CLIENT_COL_ORDER_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      const order = saved.filter((k) => defaults.includes(k));
      defaults.forEach((k) => { if (!order.includes(k)) { if(k==='contact'||k==='owner')order.splice(Math.max(0,order.indexOf(k==='owner'?'contact':'name')+1),0,k);else order.push(k); } });
      return order;
    }
  } catch (e) {}
  return defaults;
}
// 保存列顺序：本地立即生效 + 后台同步到服务端（换设备/清缓存也不丢）
function saveClientColOrder(order, notify) {
  try { localStorage.setItem(CLIENT_COL_ORDER_KEY, JSON.stringify(order)); } catch (err) {}
  applyClientColOrder();
  saveUiPref({ clientColOrder: order });
  if (notify) toast('列顺序已保存（同一账号换电脑也生效）');
}
window.getClientColOrder = clColOrder;
window.saveClientColOrder = saveClientColOrder;
function applyClientColOrder() {
  const tr = document.querySelector('.cl-table thead tr');
  const tbody = document.getElementById('clientBody');
  if (!tr) return;
  const ths = Array.from(tr.cells);
  if (ths.length < 3) return;
  const order = clColOrder();
  const idxByKey = {};
  ths.forEach((th, i) => { if (th.dataset.col) idxByKey[th.dataset.col] = i; });
  // 首列勾选、末列操作固定，中间列按保存顺序重排（去重 + 跳过首尾，防止脏 order 把固定列移走）
  const newOldIdx = [0];
  order.forEach((k) => {
    const i = idxByKey[k];
    if (i === undefined || i === 0 || i === ths.length - 1) return;
    if (!newOldIdx.includes(i)) newOldIdx.push(i);
  });
  newOldIdx.push(ths.length - 1);
  newOldIdx.forEach((i) => tr.appendChild(ths[i]));
  // tbody 必须按 data-col key 匹配重排：thead 常残留自定义顺序，而 tbody 刚被重绘成默认顺序，
  // 此时按 thead 当前位置索引重排会退化成 identity 映射，导致 td 永久错位（v20260902e 修复）
  const keySeq = newOldIdx.map((i) => ths[i].dataset.col);
  if (tbody) {
    Array.from(tbody.rows).forEach((row) => {
      const cells = Array.from(row.cells);
      if (cells.length !== ths.length) return;
      const byKey = {};
      cells.forEach((td) => { if (td.dataset.col) byKey[td.dataset.col] = td; });
      const seq = keySeq.map((k) => byKey[k]).filter(Boolean);
      if (seq.length === ths.length) seq.forEach((td) => row.appendChild(td));
      else newOldIdx.forEach((i) => row.appendChild(cells[i])); // 旧缓存 td 无 data-col 时退回位置重排
    });
  }
  clApplyWidths();
}

// ===== 列宽自由调整：拖动表头右缘手柄，宽度按列持久化（本地 + 服务端 uiPrefs） =====
const CLIENT_COL_WIDTH_KEY = 'ftw_client_col_widths';
let clWidthsCache = null;
function clLoadWidths() {
  if (clWidthsCache) return clWidthsCache;
  let w = {};
  try { w = JSON.parse(localStorage.getItem(CLIENT_COL_WIDTH_KEY) || '{}') || {}; } catch (e) {}
  clWidthsCache = w;
  return w;
}
// 列 key：优先 data-col（勾选/操作列已在表头静态打 check/ops，不会被位置索引污染）
function clColKeyOf(th, i) { return th.dataset.col || (i === 0 ? 'check' : 'ops'); }
function clSaveWidths(w, notify) {
  clWidthsCache = w;
  try { localStorage.setItem(CLIENT_COL_WIDTH_KEY, JSON.stringify(w)); } catch (err) {}
  saveUiPref({ clientColWidths: w });
  if (notify) toast('列宽已保存（同一账号换电脑也生效）');
}
// 自愈：固定布局下未设定宽度的列可能被挤成一条线（如取消隐藏、或只调过部分列），
// 给这些列补一个默认宽度，避免出现「看不见的极窄列」
let clHealTimer = null;
// 【已废弃 v20260911g】自愈逻辑已被 clFitWidths 的「列宽下限 + 容器适配」取代：
// 现在每列都有明确宽度且不低于内容下限，不会再出现「被挤扁的列」。
// 保留函数仅为兼容旧调用点，不要再从这里写入用户列宽配置。
function clHealSqueezed() {
  const table = document.querySelector('.cl-table');
  if (!table || !table.tHead || !table.tHead.rows[0]) return;
  const tr = table.tHead.rows[0];
  const widths = clLoadWidths();
  let changed = false;
  Array.from(tr.cells).forEach((th, i) => {
    const k = clColKeyOf(th, i);
    if (widths[k]) return;
    const wpx = Math.round(th.getBoundingClientRect().width);
    if (wpx > 0 && wpx < 60) { widths[k] = 120; changed = true; } // 隐藏列实测 0，跳过
  });
  if (changed) { clSaveWidths(widths, false); clApplyWidths(); }
}

// 可见列：display:none 的列不参与表格布局，必须整列排除，
// 否则 colgroup 会多出 col，导致后面所有列的宽度整体错位
function clVisibleCells(tr) {
  return Array.from(tr.cells).filter((th) => getComputedStyle(th).display !== 'none');
}
// ===== 客户列表列宽（v20260911d 重构：表格永远适配容器宽度）=====
// 之前的问题链：
//   1) colgroup 的 <col> 数量 ≠ 可见列数 → 隐藏列之后所有列宽整体错位（健康度/AI 被压成 0 宽）；
//   2) 各列宽度之和 > 容器宽度 → 表格横向溢出，而「操作」列是 position:sticky 固定列，
//      初始位置正好盖住「创建时间」，用户根本看不到这一列（这就是「展示问题」的主因）；
//   3) 列被拖窄后内容被截断（2026-09-11 需要 89px，却只有 81px）。
// 各列「装得下内容」的真实下限（实测 scrollWidth 得出）：
//   操作 3 个图标需 125px、健康度徽标 74px、AI 按钮 70px、创建时间 2026-09-11 需 89px、
//   联系方式（掩码+「显示」）141px、来源最长「朋友介绍」74px。
// 名称列允许折行（.cl-name-cell 是 white-space:normal），所以它当「可伸缩列」，下限放到 150，
// 由它吃掉/让出富余宽度，其余列保内容不截断。
const CL_COL_MIN_W = {
  check: 48, star: 56, name: 150, contact: 120, owner: 96, country: 84, phase: 88, grade: 64, source: 84,
  phone: 140, prod: 120, comm: 150, health: 74, ai: 70, created: 92, rel: 76, ops: 126,
};
function clColMinW(k) { return CL_COL_MIN_W[k] || 50; }

// 拖动时的总宽同步：只累加各列（含下限），不动其它列，让被拖的列真正变宽
function clSyncTableWidth(table, widths) {
  if (!table || !table.tHead || !table.tHead.rows[0]) return;
  const tr = table.tHead.rows[0];
  const all = Array.from(tr.cells);
  let total = 0;
  clVisibleCells(tr).forEach((th) => {
    const k = clColKeyOf(th, all.indexOf(th));
    total += Math.max(Number(widths[k]) || 0, clColMinW(k));
  });
  if (!total) return;
  table.style.width = total + 'px';
  table.style.minWidth = total + 'px';
}

// 计算适配容器的最终列宽；返回 { keys, widths, total }
function clFitWidths(table, widths) {
  const tr = table && table.tHead && table.tHead.rows[0];
  if (!tr) return null;
  const all = Array.from(tr.cells);
  const keys = clVisibleCells(tr).map((th) => clColKeyOf(th, all.indexOf(th)));
  if (!keys.length) return null;
  const minW = keys.map((k) => clColMinW(k));
  const minSum = minW.reduce((a, b) => a + b, 0);
  const ideal = keys.map((k, i) => Math.max(Number(widths[k]) || 0, minW[i]));
  const total = ideal.reduce((a, b) => a + b, 0);
  const wrap = table.parentElement;
  const avail = Math.round(wrap ? wrap.clientWidth : 0);
  // 目标总宽：塞得下就铺满容器；连下限之和都塞不下才退回下限之和（此时才横向滚动）
  const target = (avail > 120) ? Math.max(avail, minSum) : total;
  let out = ideal.slice();
  if (total > target) {
    const slack = ideal.map((w, i) => w - minW[i]);
    const slackSum = slack.reduce((a, b) => a + b, 0);
    const over = Math.min(total - target, slackSum);
    if (over > 0) out = ideal.map((w, i) => w - Math.round(slack[i] * over / slackSum));
  } else if (total < target) {
    const grow = target - total;
    out = ideal.map((w) => w + Math.round(grow * w / total));
  }
  // 修正四舍五入误差，使总和精确等于目标宽度
  let diff = target - out.reduce((a, b) => a + b, 0);
  for (let i = out.length - 1; i >= 0 && diff !== 0; i--) {
    const d = diff > 0 ? 1 : -1;
    if (out[i] + d >= minW[i]) { out[i] += d; diff -= d; }
  }
  return { keys, widths: out, total: out.reduce((a, b) => a + b, 0) };
}

// 列显隐变化后必须重建 colgroup：<col> 数量必须等于「可见列数」。
// 浏览器只把前 N 个 <col> 按可见列顺序映射（N = 可见列数），
// 一旦 colgroup 里混进了隐藏列，隐藏列之后的所有列宽都会整体错位——
// 典型症状：健康度/AI 被压成 0 宽看不见，创建时间/操作列拿到上一列的宽度。
function clSyncColgroupIfVisChanged(table) {
  if (!table || !table.tHead || !table.tHead.rows[0]) return false;
  const tr = table.tHead.rows[0];
  const all = Array.from(tr.cells);
  const visSig = clVisibleCells(tr).map((th) => clColKeyOf(th, all.indexOf(th))).join('|');
  if (table.dataset.clVisSig === visSig) return false;
  table.dataset.clVisSig = visSig;
  clApplyWidths();
  return true;
}

// 应用列宽：始终 fixed 布局 + colgroup（每个可见列一个 <col>），并适配容器宽度
function clApplyWidths() {
  const table = document.querySelector('.cl-table');
  if (!table || !table.tHead || !table.tHead.rows[0]) return null;
  const tr = table.tHead.rows[0];
  const widths = clLoadWidths();
  // 清掉历史脏 key（列设置曾生成过 c0/c14 等，与 check/ops 并存会让多列共用同一宽度）
  const all = Array.from(tr.cells);
  const validKeys = new Set(all.map(clColKeyOf));
  const stale = Object.keys(widths).filter((k) => !validKeys.has(k));
  if (stale.length) { stale.forEach((k) => { delete widths[k]; }); clSaveWidths(widths, false); }
  const fit = clFitWidths(table, widths);
  if (!fit) return null;
  table.classList.add('cl-fixed');
  table.style.width = fit.total + 'px';
  table.style.minWidth = fit.total + 'px';
  const cg = document.createElement('colgroup');
  fit.keys.forEach((k, i) => {
    const col = document.createElement('col');
    col.style.width = fit.widths[i] + 'px';
    cg.appendChild(col);
  });
  const oldCg = table.querySelector('colgroup');
  if (oldCg) oldCg.replaceWith(cg); else table.insertBefore(cg, table.tHead);
  table.dataset.clWidthSig = fit.keys.join('|') + '#' + fit.total;
  return fit;
}

// 列在可见列中的位置：colgroup 只含可见列，取 col 必须用这个下标
function clVisIndexOf(th) {
  const tr = th.parentElement;
  if (!tr) return -1;
  return clVisibleCells(tr).indexOf(th);
}

function wireClientColDrag() {
  const tr = document.querySelector('.cl-table thead tr');
  if (!tr || tr.dataset.colWired) return;
  tr.dataset.colWired = '1';
  const cells = Array.from(tr.cells);
  const table = tr.closest('table');
  // 吸附操作列覆盖带判定：操作列表头 sticky（z5）压在滚动内容上，其背景已 pointer-events:none
  // 透传事件；鼠标实际落在操作列矩形内时，不响应列排序/恢复默认，避免点操作列背景误触
  const overOpsBand = (e) => {
    const last = tr.lastElementChild;
    if (!last || last === e.currentTarget) return false;
    const r = last.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  cells.forEach((th, thIdx) => {
    const colKey = th.dataset.col;
    if (colKey) {
      th.draggable = true;
      th.title = '拖拽调整列顺序 · 拖右缘手柄调列宽 · 双击恢复默认';
      th.addEventListener('dragstart', (e) => {
        if (clResizing || overOpsBand(e)) { e.preventDefault(); return; }
        clDragColKey = colKey;
        th.classList.add('cl-col-dragging');
        try { e.dataTransfer.setData('text/plain', colKey); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
      });
      th.addEventListener('dragend', () => { th.classList.remove('cl-col-dragging'); clDragColKey = null; });
      th.addEventListener('dblclick', (e) => {
        if (overOpsBand(e)) { e.preventDefault(); return; }
        try { localStorage.removeItem(CLIENT_COL_ORDER_KEY); } catch (err) {}
        saveUiPref({ clientColOrder: null });
        applyClientColOrder();
        toast('已恢复默认列顺序');
      });
    }
    // 所有单元格都能作为落点：拖到最左的勾选列 = 排到第一列，拖到最右的操作列 = 排到最后
    th.addEventListener('dragover', (e) => { if (clDragColKey) { e.preventDefault(); th.classList.add('cl-col-over'); } });
    th.addEventListener('dragleave', () => th.classList.remove('cl-col-over'));
    th.addEventListener('drop', (e) => {
      e.preventDefault();
      th.classList.remove('cl-col-over');
      let key = clDragColKey;
      if (!key && e.dataTransfer) { try { key = e.dataTransfer.getData('text/plain'); } catch (err) {} }
      if (!key || key === colKey) return;
      const order = clColOrder();
      const from = order.indexOf(key);
      if (from < 0) return;
      order.splice(from, 1);
      if (!colKey) {
        const isFirst = cells.indexOf(th) === 0;
        order.splice(isFirst ? 0 : order.length, 0, key);
      } else {
        const to = order.indexOf(colKey);
        if (to < 0) return;
        order.splice(to, 0, key);
      }
      saveClientColOrder(order, true);
    });
    // 列宽拖拽手柄：跳过首列（勾选列）
    if (thIdx > 0 && !th.querySelector('.cl-resizer')) {
      const res = document.createElement('div');
      res.className = 'cl-resizer';
      res.title = '拖动调整列宽 · 双击恢复本列默认宽度';
      th.appendChild(res);
      res.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const idx = Array.from(tr.cells).indexOf(th);
        if (idx < 0) return;
        const key = clColKeyOf(th, idx);
        clResizing = true;
        // 首次调整：把当前渲染宽度快照为全列宽，切 fixed 布局，避免跳动
        // 注意：被隐藏的列实测宽度为 0，不能记进配置（否则以后取消隐藏会拿到 0 宽）
        if (!table.classList.contains('cl-fixed')) {
          const w = Object.assign({}, clLoadWidths());
          Array.from(tr.cells).forEach((t2, i2) => {
            const k = clColKeyOf(t2, i2);
            const measured = Math.round(t2.getBoundingClientRect().width);
            if (!w[k] && measured > 0) w[k] = measured;
          });
          clSaveWidths(w, false);
          clApplyWidths();
        }
        const cg = table.querySelector('colgroup');
        // colgroup 只含可见列，必须用可见列下标取 col（用原始下标会错位到隐藏列上）
        const col = cg && cg.children[clVisIndexOf(th)];
        if (!col) { clResizing = false; return; }
        res.classList.add('active');
        document.body.classList.add('cl-resizing'); // 拖拽期间锁定光标、禁止选中文字
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;
        const move = (ev) => {
          // 下限保护：不允许把列拖到装不下内容（否则又会出现截断/看不见）
          const wpx = Math.max(clColMinW(key), Math.min(1600, Math.round(startW + ev.clientX - startX)));
          col.style.width = wpx + 'px';
          clWidthsCache[key] = wpx;
          clSyncTableWidth(table, clWidthsCache); // 拖动过程中同步总宽，避免其他列被压缩
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          res.classList.remove('active');
          document.body.classList.remove('cl-resizing');
          clResizing = false;
          // 松手后按容器宽度重新适配（保住刚拖的比例），并把「适配后的宽度」落盘，
          // 这样下次打开/换电脑看到的是同一个版式，不会出现「拖完又跳回去」
          const fit = clApplyWidths();
          if (fit) {
            const m = {};
            fit.keys.forEach((k, i) => { m[k] = fit.widths[i]; });
            clSaveWidths(m, true);
          } else {
            clSaveWidths(Object.assign({}, clWidthsCache), true);
          }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      res.addEventListener('dblclick', (e) => {
        e.preventDefault(); e.stopPropagation();
        const idx = Array.from(tr.cells).indexOf(th);
        const key = clColKeyOf(th, idx);
        const w = Object.assign({}, clLoadWidths());
        delete w[key];
        clSaveWidths(w, false);
        clApplyWidths();
        if (!Object.keys(w).length) toast('已恢复默认列宽');
      });
    }
  });
}

function clientOwnerLabel(client) {
  const assigned = (allUsers || []).find(user => String(user.id) === String(client.owner));
  return (assigned && (assigned.name || assigned.username)) || client.ownerName || '未分配';
}
function populateClientFilters(){
 for(const [id,key,label] of [['cfOwner','owner','全部负责人'],['cfCountry','country','全部国家'],['cfSource','source','全部来源']]){
 const el=$('#'+id);if(!el)continue;const old=el.value;
 const values=[...new Set(clients.map(c=>String(c[key]||'')))].sort();
 el.innerHTML='<option value="">'+label+'</option>'+values.map(v=>'<option value="'+esc(v||'__empty__')+'">'+esc(v?(key==='owner'?clientOwnerLabel({owner:v}):v):'未填写')+'</option>').join('');el.value=old;
 }
}
let clientScope = 'all';
function renderClientSummary() {
  const now = Date.now(), since = now - 30 * 86400000;
  const counts = {csAll:clients.length, csStar:clients.filter(c=>c.star).length,
    csNew:clients.filter(c=>{const d=new Date(c.createdAt).getTime();return d>=since && d<=now;}).length,
    csDue:clients.filter(c=>c.nextFollowUp && c.nextFollowUp<=todayStr()).length};
  Object.entries(counts).forEach(([id,n])=>{const el=document.getElementById(id);if(el)el.textContent=n.toLocaleString('zh-CN');});
  document.querySelectorAll('[data-client-scope]').forEach(button=>{
    const active=button.dataset.clientScope===clientScope;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
}
document.querySelectorAll('[data-client-scope]').forEach(button=>button.addEventListener('click',()=>{
  clientScope=button.dataset.clientScope;clientFollowFilter=false;clientSelected.clear();renderClients();
}));
// Close secondary actions after selection; Esc also dismisses the menu.
document.addEventListener('click',event=>{
  const menu=document.querySelector('.cl-more');
  if(menu?.open && (!menu.contains(event.target) || event.target.closest('.cl-more-menu button')))menu.open=false;
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=document.querySelector('.cl-more');if(menu?.open){menu.open=false;menu.querySelector('summary').focus();}}});
function filteredClientBase(){
 const q=($('#clientSearch')?.value||'').trim().toLowerCase(),val=id=>$('#'+id)?.value||'';
 return clients.filter(c=>{
 if(clientScope==='mine' && String(c.owner)!==String(currentUser?.id))return false;
 if(clientScope==='star' && !c.star)return false;
 if(clientScope==='due' && !(c.nextFollowUp && c.nextFollowUp<=todayStr()))return false;
 if(q&&![c.company,c.contactName,c.contactPhone,c.contactEmail,c.country,c.source,c.productInterest].some(v=>String(v||'').toLowerCase().includes(q)))return false;
 for(const [id,key] of [['cfOwner','owner'],['cfCountry','country'],['cfSource','source']]){const v=val(id);if(v&&String(c[key]||'')!==(v==='__empty__'?'':v))return false;}
 const follow=val('cfFollow');if(follow==='due'&&!(c.nextFollowUp&&c.nextFollowUp<=todayStr()))return false;if(follow==='missing'&&c.nextFollowUp)return false;if(follow==='stale'&&!isStaleClient(c))return false;
 const date=c.createdAt?new Date(c.createdAt):null,day=date&&!isNaN(date)?date.toISOString().slice(0,10):'';
 if(val('cfFrom')&&(!day||day<val('cfFrom')))return false;if(val('cfTo')&&(!day||day>val('cfTo')))return false;
 return true;
 });
}
function renderClients() {
  const searchEl = $('#clientSearch');
  const q = ((searchEl && searchEl.value) || '').toLowerCase();
  const body = $('#clientBody');
  if (!body) return;
  renderClientSummary();
  if (searchEl) searchEl.oninput = () => { clientFollowFilter = false; renderClients(); };
  wireClientColDrag();
  // 默认按登记时间倒序（最新登记在前），服务端不保证顺序
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  populateClientFilters();
  const base = filteredClientBase().sort(newestRecords);
  let list = base;
  if (clientFollowFilter) {
    const today = todayStr();
    list = list.filter((c) => c.nextFollowUp && c.nextFollowUp <= today);
  }
  if (clientStageFilter) list = list.filter((c) => phaseOf(c) === clientStageFilter);
  if (clientCatFilter) list = list.filter((c) => (c.tags || []).includes(clientCatFilter));

  // 列表 meta
  const clientMeta = $('#clientMeta');
  if (clientMeta) clientMeta.textContent = '共 ' + list.length + ' 个客户';

  renderClientStageTabs(base);
  renderClientCatChips(base);

  const listIds = new Set(list.map((c) => c.id));
  for (const id of clientSelected) { if (!listIds.has(id)) clientSelected.delete(id); }
  if (!list.length) { body.innerHTML = '<tr><td colspan="17" class="empty">'+(clients.length ? '没有符合条件的客户，请调整搜索或筛选条件' : '暂无客户，点击右上角「新增客户」开始录入')+'</td></tr>'; renderClientBatchBar(); applyClientColOrder(); return; }
  body.innerHTML = list.map((c, i) => {
    const grade = gradeOf(c.stage);
    const gradeClass = 'tag-' + String(grade).toLowerCase().replace(/\+/g, 'plus');
    const createdStr = c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '-';
    const cat = (c.tags || [])[0] || '';
    const prod = productInterestOf(c);
    const comm = latestCommOf(c);
    const lastFollow = lastFollowOf(c);
    const score = healthScoreOf(c);
    const rel = relDayOf(lastFollow);
    const phoneRaw = c.contactPhone || '';
    const revealed = revealedPhones.has(c.id);
    const phoneShown = phoneRaw ? (revealed ? esc(phoneRaw) : esc(maskPhone(phoneRaw))) : '-';
    const gradeOpts = GRADES.map((g) => `<option ${g === grade ? 'selected' : ''}>${g}</option>`).join('');
    // 在途（未成交）询盘数：列内容按 Joe 2026-09-02 要求改为数量徽标，点击跳询盘看板按该客户过滤
    const actInq = activeInquiriesOf(c);
    const inqBadge = actInq.length
      ? `<a class="inq-badge ib-${esc(actInq[0].status || '新询盘')}" data-ibadge-c="${esc(c.id)}" title="未成交询盘 ${actInq.length} 条 · 最近「${esc(actInq[0].status || '新询盘')}」，点击在询盘看板查看">${actInq.length} 条在途</a>`
      : '';
    return `<tr class="${clientSelected.has(c.id) ? 'sel' : ''}">
      <td data-col="check"><input type="checkbox" class="cb-client" data-cid="${esc(c.id)}" ${clientSelected.has(c.id) ? 'checked' : ''} /></td>
      <td class="cl-col-star" data-col="star"><span class="cl-star ${c.star ? 'on' : ''}" data-star-c="${esc(c.id)}" title="星标">★</span></td>
      <td class="cl-name-cell" data-col="name">
        <button type="button" class="cl-name" data-detail-c="${esc(c.id)}">
          <div class="cl-name-l1">${esc(c.company || '未命名')}</div>
          ${cat ? `<span class="cl-cat">${esc(cat)}</span>` : ''}
        </button>
      </td>
      <td data-col="contact">${esc(c.contactName || '—')}</td>
      <td data-col="owner" title="${esc(clientOwnerLabel(c))}">${esc(clientOwnerLabel(c))}</td>
      <td data-col="country">${esc(c.country || '-')}</td>
      <td class="cl-phase-cell" data-col="phase">${inqBadge || '<span class="muted">—</span>'}</td>
      <td data-col="grade">${clientEditMode ? `<select class="cl-grade-sel" data-grade-c="${esc(c.id)}">${gradeOpts}</select>` : `<span class="tag ${gradeClass}">${esc(grade)}</span>`}</td>
      <td data-col="source">${esc(c.source || '-')}</td>
      <td class="cl-phone" data-col="phone">${phoneShown}${phoneRaw ? ` <a class="cl-reveal" data-reveal-c="${esc(c.id)}">${revealed ? '隐藏' : '显示'}</a>` : ''}</td>
      <td class="cl-prod" data-col="prod">${esc(prod || '-')}</td>
      <td class="cl-comm" data-col="comm">${comm ? `<div class="cl-comm-txt" title="${esc(comm.content)}">${esc(comm.content)}</div><div class="cl-comm-date">🕐 ${esc(comm.date || '')}</div>` : '<span class="muted">—</span>'}</td>
      <td data-col="health"><span class="cl-health ${healthClass(score)}" title="跟进健康度（按最近跟进时间计算）">${score}</span></td>
      <td data-col="ai"><button class="cl-ai" data-ai-c="${esc(c.id)}" title="AI 跟进建议">✨</button></td>
      <td class="cl-created" data-col="created">${esc(createdStr)}</td>
      <td data-col="rel"><span class="cl-rel ${rel.cls}">${esc(rel.label)}</span></td>
      <td class="text-center" data-col="ops">
        <button class="action-btn" data-peek-c="${esc(c.id)}" title="速览（侧板）">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="action-btn" data-edit-c="${esc(c.id)}" title="编辑">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="action-btn" data-del-c="${esc(c.id)}" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>`; }).join('');
  body.querySelectorAll('[data-peek-c]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openClientDrawer(b.dataset.peekC); }));
  body.querySelectorAll('[data-detail-c]').forEach((b) => b.addEventListener('click', () => viewClientDetail(b.dataset.detailC)));
  body.querySelectorAll('[data-edit-c]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openClientModal(b.dataset.editC); }));
  body.querySelectorAll('[data-del-c]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('确认删除该客户？')) { await api('/api/clients/' + b.dataset.delC, { method: 'DELETE' }); toast('已删除'); loadAll(); }
  }));
  body.querySelectorAll('.cb-client').forEach((cb) => cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (cb.checked) clientSelected.add(cb.dataset.cid); else clientSelected.delete(cb.dataset.cid);
    renderClientBatchBar();
  }));
  // 星标
  body.querySelectorAll('[data-star-c]').forEach((s) => s.addEventListener('click', async (e) => {
    e.stopPropagation();
    const c = clients.find((x) => x.id === s.dataset.starC);
    if (!c) return;
    c.star = !c.star;
    s.classList.toggle('on', !!c.star);
    try {
      const response=await api('/api/clients/' + c.id, {method:'PUT',body:JSON.stringify({star:!!c.star})});
      if(!response.ok)throw new Error('save failed');
    } catch { c.star=!c.star;toast('星标保存失败，请重试'); }
    renderClients();
  }));
  // 在途询盘徽标 → 跳询盘商机界面并按该客户过滤（v20260902d；阶段列已改为在途询盘数，行内阶段下拉移除）
  body.querySelectorAll('[data-ibadge-c]').forEach((a) => a.addEventListener('click', (e) => {
    e.stopPropagation();
    const cc = clients.find((x) => x.id === a.dataset.ibadgeC);
    if (!cc) return;
    window.inqClientFilter = cc.company || '';
    const nav = document.querySelector('.nav-item[data-view="enquiry"]');
    if (nav) nav.click();
    // 导航切换不触发询盘重载时也要立即生效（loadInquiries 异步回来后会再覆盖）
    if (typeof renderInqBoard === 'function') renderInqBoard();
    if (typeof renderInqList === 'function') renderInqList();
    toast('询盘已按「' + (cc.company || '') + '」过滤');
  }));
  // 编辑模式下行内变更级别
  body.querySelectorAll('[data-grade-c]').forEach((sel) => sel.addEventListener('change', async (e) => {
    e.stopPropagation();
    await updateClientField(sel.dataset.gradeC, { stage: sel.value }, '级别已更新为 ' + sel.value);
  }));
  // 手机号 显示/隐藏
  body.querySelectorAll('[data-reveal-c]').forEach((a) => a.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = a.dataset.revealC;
    if (revealedPhones.has(id)) revealedPhones.delete(id); else revealedPhones.add(id);
    renderClients();
  }));
  // 行内 AI 建议
  body.querySelectorAll('[data-ai-c]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openAiClientAdvice(b.dataset.aiC);
  }));
  renderClientBatchBar();
  if (searchEl) searchEl.oninput = () => { clientFollowFilter = false; renderClients(); };
  applyClientColOrder();
}
document.getElementById('cbClientAll').addEventListener('change', () => {
  const cbs = document.querySelectorAll('#clientBody .cb-client');
  if (document.getElementById('cbClientAll').checked) cbs.forEach((cb) => clientSelected.add(cb.dataset.cid));
  else cbs.forEach((cb) => clientSelected.delete(cb.dataset.cid));
  renderClients();
});
// 勾选状态只更新顶部「批量编辑 / 批量删除」按钮的计数与高亮，实际编辑走弹窗
function renderClientBatchBar() {
  const n = clientSelected.size;
  const bar = document.getElementById('clientBatchBar');
  if (bar) bar.classList.toggle('hidden', !(clientEditMode || n > 0));
  const info = document.getElementById('clientBatchInfo');
  if (info) info.textContent = '已选 ' + n + ' 个客户';
  const edit = document.getElementById('clientBatchEdit');
  if (edit) {
    edit.textContent = n ? '✏️ 批量编辑 (' + n + ')' : '✏️ 批量编辑';
    edit.classList.toggle('btn-mini--active', n > 0);
    edit.title = n ? '修改选中的 ' + n + ' 位客户' : '先勾选左侧复选框，再点此批量修改';
  }
  const del = document.getElementById('clientBatchDelete');
  if (del) {
    del.textContent = n ? '🗑️ 批量删除 (' + n + ')' : '🗑️ 批量删除';
    del.classList.toggle('btn-mini--active', n > 0);
    del.title = n ? '删除选中的 ' + n + ' 位客户（不可恢复）' : '先勾选左侧复选框，再点此批量删除';
  }
  const all = document.getElementById('cbClientAll');
  if (all) {
    const total = document.querySelectorAll('#clientBody .cb-client').length;
    all.checked = total > 0 && n >= total;
    all.indeterminate = n > 0 && n < total;
  }
}

// ---------- 客户工具栏：一键建任务 / 去重检查 / AI 功能 ----------

// 一键建任务：为勾选的客户批量创建跟进任务
async function quickTaskForClients() {
  const ids = [...clientSelected];
  if (!ids.length) { toast('请先勾选左侧复选框选择客户'); return; }
  let ok = 0;
  for (const id of ids) {
    const c = clients.find((x) => x.id === id);
    if (!c) continue;
    try {
      const r = await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: '跟进客户：' + (c.company || ''),
          type: '跟进',
          dueDate: c.nextFollowUp || todayStr(),
          status: '待办',
          notes: '由客户列表「一键建任务」创建',
        }),
      });
      if (r.ok) ok++;
    } catch { /* 单条失败继续 */ }
  }
  toast('已创建 ' + ok + ' 条跟进任务');
  clientSelected.clear();
  renderClients();
}

// 去重检查：按 公司名 / 电话 / 邮箱 归并查找重复客户
function openClientDedup() {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.,，。()（）+]/g, '');
  // 并查集归并重复簇
  const parent = new Map(clients.map((c) => [c.id, c.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  const keyOwner = new Map();
  clients.forEach((c) => {
    const keys = [];
    if (norm(c.company)) keys.push('co:' + norm(c.company));
    if (c.contactPhone) keys.push('ph:' + norm(c.contactPhone));
    if (c.contactEmail) keys.push('em:' + norm(c.contactEmail));
    keys.forEach((k) => {
      if (keyOwner.has(k)) union(keyOwner.get(k), c.id); else keyOwner.set(k, c.id);
    });
  });
  const clusters = new Map();
  clients.forEach((c) => {
    const root = find(c.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(c);
  });
  const dups = [...clusters.values()].filter((g) => g.length > 1);
  if (!dups.length) { openModal('去重检查', '<div class="batch-note">未发现重复客户（按公司名 / 电话 / 邮箱比对）</div>', { plain: true, noFooter: true }); return; }
  const html = '<div class="batch-note danger-note">发现 <b>' + dups.length + '</b> 组疑似重复客户，请逐组确认处理（勾选要移除的记录，未勾选的保留）：</div>'
    + dups.map((g, gi) => {
      g.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const rows = g.map((c, i) => `<div class="dedup-row keep">
          <label><input type="checkbox" data-dedup-remove="${esc(c.id)}" /> 移除</label>
          <b>${esc(c.company || '未命名')}</b>
          <span class="muted">${esc(c.country || '-')} · ${esc(clientOwnerLabel(c))} · ${esc(c.contactName||'')}<br>${esc(c.contactPhone||'无电话')} · ${esc(c.contactEmail||'无邮箱')}<br>登记：${esc(c.createdAt?new Date(c.createdAt).toLocaleDateString('zh-CN'):'未填写')}</span>
        </div>`).join('');
      return `<div class="dedup-group">${rows}
        ${currentUser?.role==='admin'?`<label>合并后保留<select data-no-combo data-dedup-keep>${g.map(c=>`<option value="${esc(c.id)}">${esc(c.company)} · ${esc(clientOwnerLabel(c))} · ${esc(c.contactEmail||c.contactPhone||c.id)}</option>`).join('')}</select></label><button type="button" class="btn-mini" data-dedup-merge="${gi}">合并本组至所选客户</button>`:''}
        <button type="button" class="btn-mini btn-mini--danger" data-dedup-g="${gi}">移除本组勾选记录</button></div>`;
    }).join('');
  openModal('去重检查（共 ' + dups.length + ' 组）', html, { plain: true, noFooter: true });
  $('#modalForm').querySelectorAll('[data-dedup-merge]').forEach(b=>b.onclick=async()=>{
    const g=dups[Number(b.dataset.dedupMerge)],keepId=b.closest('.dedup-group').querySelector('[data-dedup-keep]').value,removeIds=g.filter(c=>c.id!==keepId).map(c=>c.id);
    if(!confirm('合并本组 '+g.length+' 条客户？保留所选客户及其负责人，空白资料自动补齐，冲突资料写入备注，关联业务同步转移。此操作将移除其余客户记录。'))return;
    b.disabled=true;
    try{const r=await api('/api/clients/merge',{method:'POST',body:JSON.stringify({keepId,removeIds})});const data=await r.json();if(!r.ok)throw Error(data.error||'合并失败');closeModal();await loadAll();toast('客户已合并，关联信息已同步');}catch(e){toast(e.message);b.disabled=false;}
  });
  $('#modalForm').querySelectorAll('[data-dedup-g]').forEach((b) => b.addEventListener('click', async () => {
    const g = dups[Number(b.dataset.dedupG)];
    if (!g) return;
    const selected=new Set([...b.closest('.dedup-group').querySelectorAll('[data-dedup-remove]:checked')].map(x=>x.dataset.dedupRemove));
    const extras=g.filter(c=>selected.has(String(c.id)));
    if(!extras.length)return toast('请勾选要移除的记录');
    if(extras.length===g.length)return toast('每组至少保留一条记录');
    b.disabled = true;
    await batchDeleteRecords(extras.map((c) => c.id), (id) => '/api/clients/' + id, '客户');
    closeModal();
    loadAll();
  }));
}

// AI：单客户跟进建议
function aiClientContext(c) {
  return ['客户：' + (c.company || ''), '国家：' + (c.country || '-'), '阶段：' + phaseOf(c),
    '级别：' + gradeOf(c.stage), '来源：' + (c.source || '-'), '产品兴趣：' + (productInterestOf(c) || '-'),
    '最近跟进：' + (lastFollowOf(c) || '无'), '下次跟进：' + (c.nextFollowUp || '-'),
    '备注：' + (c.notes || '无')].join('\n');
}
function showAiModal(title, loading) {
  openModal(title, '<div class="ai-loading">' + esc(loading || '正在生成，请稍候…') + '</div>', { plain: true, noFooter: true });
}
function fillAiModal(text) {
  const f = $('#modalForm');
  if (f) f.innerHTML = '<div class="ai-result">' + esc(text).replace(/\n/g, '<br>') + '</div>';
}
function openAiClientAdvice(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return;
  const run = async () => {
    showAiModal('AI 跟进建议 · ' + (c.company || ''));
    try {
      const r = await aiChat([{ role: 'user', content: '你是外贸销售助手。根据以下客户信息给出 3-5 条具体可执行的跟进建议（中文，简明扼要，逐条列出）：\n' + aiClientContext(c) }]);
      fillAiModal(r.content || '（无内容）');
    } catch (e) { fillAiModal('AI 调用失败：' + (e.message || e)); }
  };
  if (typeof withAiGuard === 'function') withAiGuard('AI 跟进建议', run); else run();
}
// AI 批量建议：选中客户优先，未选中则取当前列表前 10 个
function currentClientList() {
  let list = filteredClientBase();
  if(clientFollowFilter)list=list.filter(c=>c.nextFollowUp&&c.nextFollowUp<=todayStr());
  if (clientStageFilter) list = list.filter((c) => phaseOf(c) === clientStageFilter);
  if (clientCatFilter) list = list.filter((c) => (c.tags || []).includes(clientCatFilter));
  return list;
}
function openAiBatchAdvice() {
  let targets = [...clientSelected].map((id) => clients.find((x) => x.id === id)).filter(Boolean);
  if (!targets.length) targets = currentClientList().slice(0, 10);
  if (!targets.length) { toast('当前列表没有客户'); return; }
  const run = async () => {
    showAiModal('AI 批量建议（' + targets.length + ' 个客户）');
    try {
      const ctx = targets.map((c, i) => '【' + (i + 1) + '】' + aiClientContext(c)).join('\n\n');
      const r = await aiChat([{ role: 'user', content: '你是外贸销售主管。逐个客户给出一句最关键的下一步动作建议（格式：序号. 客户名 — 建议），最后给一句整体优先级提示：\n' + ctx }]);
      fillAiModal(r.content || '（无内容）');
    } catch (e) { fillAiModal('AI 调用失败：' + (e.message || e)); }
  };
  if (typeof withAiGuard === 'function') withAiGuard('AI 批量建议', run); else run();
}
// AI 摘要：总结当前筛选出的客户列表
function openAiSummary() {
  const list = currentClientList();
  if (!list.length) { toast('当前列表没有客户'); return; }
  const byPhase = {};
  list.forEach((c) => { const p = phaseOf(c); byPhase[p] = (byPhase[p] || 0) + 1; });
  const byCountry = {};
  list.forEach((c) => { const k = c.country || '未知'; byCountry[k] = (byCountry[k] || 0) + 1; });
  const stale = list.filter((c) => isStaleClient(c)).length;
  const dealt = list.filter((c) => clientHasOrder(c)).length;
  const topCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + '×' + v).join('，');
  const run = async () => {
    showAiModal('AI 摘要 · 当前 ' + list.length + ' 个客户');
    try {
      const stats = '客户总数：' + list.length + '\n阶段分布：' + Object.entries(byPhase).map(([k, v]) => k + '×' + v).join('，')
        + '\n国家分布（前8）：' + topCountries + '\n已成交：' + dealt + ' 个\n超30天未跟进：' + stale + ' 个';
      const r = await aiChat([{ role: 'user', content: '你是外贸销售主管。根据以下客户列表统计数据，输出一段 100 字左右的经营摘要 + 3 条管理建议（中文）：\n' + stats }]);
      fillAiModal('【统计】\n' + stats + '\n\n【AI 摘要】\n' + (r.content || '（无内容）'));
    } catch (e) { fillAiModal('AI 调用失败：' + (e.message || e)); }
  };
  if (typeof withAiGuard === 'function') withAiGuard('AI 摘要', run); else run();
}
// AI 跟进建议：针对待跟进 / 超期未跟进客户给出优先级计划
function openAiFollowPlan() {
  const today = todayStr();
  const due = clients.filter((c) => (c.nextFollowUp && c.nextFollowUp <= today) || isStaleClient(c));
  if (!due.length) { toast('今天没有待跟进或超期未跟进的客户'); return; }
  const targets = due.slice(0, 15);
  const run = async () => {
    showAiModal('AI 跟进建议 · 待跟进 ' + due.length + ' 个客户');
    try {
      const ctx = targets.map((c, i) => '【' + (i + 1) + '】' + aiClientContext(c)).join('\n\n');
      const r = await aiChat([{ role: 'user', content: '你是外贸销售主管。以下是待跟进/超期未跟进客户，请按优先级排序给出今日跟进计划（每个客户一句具体动作，标注高/中/低优先级）：\n' + ctx }]);
      fillAiModal(r.content || '（无内容）');
    } catch (e) { fillAiModal('AI 调用失败：' + (e.message || e)); }
  };
  if (typeof withAiGuard === 'function') withAiGuard('AI 跟进建议', run); else run();
}

// 新版客户页工具栏事件绑定
(function bindClientToolbar() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('clientEditMode', () => {
    clientEditMode = !clientEditMode;
    const b = document.getElementById('clientEditMode');
    if (b) b.classList.toggle('on', clientEditMode);
    renderClients();
  });
  ['cfOwner','cfCountry','cfSource','cfFollow','cfFrom','cfTo'].forEach(id=>$('#'+id)?.addEventListener('change',renderClients));
  on('cfReset',()=>{['cfOwner','cfCountry','cfSource','cfFollow','cfFrom','cfTo','clientSearch'].forEach(id=>{$('#'+id).value='';});clientStageFilter='';clientCatFilter='';clientFollowFilter=false;clientScope='all';renderClients();});
  on('clientSearchBtn', () => renderClients());
  on('clientSearchClear', () => { const s = $('#clientSearch'); if (s) { s.value = ''; renderClients(); } });
  on('clientQuickTask', quickTaskForClients);
  on('clientDedup', openClientDedup);
  on('clientColCfg', () => { if (window.openColumnCfg) window.openColumnCfg('clientBody'); });
  on('clientAiBatch', openAiBatchAdvice);
  on('clientAiSummary', openAiSummary);
  on('clientAiFollow', openAiFollowPlan);
})();

function renderOrderBatchBar() {
  const n = orderSelected.size;
  const edit = document.getElementById('orderBatchEdit');
  if (edit) {
    edit.textContent = n ? '✏️ 批量编辑 (' + n + ')' : '✏️ 批量编辑';
    edit.classList.toggle('btn-mini--active', n > 0);
    edit.title = n ? '修改选中的 ' + n + ' 笔订单' : '先勾选左侧复选框，再点此批量修改';
  }
  const del = document.getElementById('orderBatchDelete');
  if (del) {
    del.textContent = n ? '🗑️ 批量删除 (' + n + ')' : '🗑️ 批量删除';
    del.classList.toggle('btn-mini--active', n > 0);
    del.title = n ? '删除选中的 ' + n + ' 笔订单（不可恢复）' : '先勾选左侧复选框，再点此批量删除';
  }
  const all = document.getElementById('cbOrderAll');
  if (all) {
    const total = document.querySelectorAll('#orderBody .cb-order').length;
    all.checked = total > 0 && n >= total;
    all.indeterminate = n > 0 && n < total;
  }
}

// 批量删除通用逻辑：逐条 DELETE；服务器按权限拦截（客户有 owner 校验，询盘团队共享）。
// api() 基于 fetch，4xx 不会抛异常，需自行判断 res.ok / res.status。
async function batchDeleteRecords(ids, urlFor, noun) {
  let ok = 0, denied = 0, fail = 0;
  for (const id of ids) {
    try {
      const res = await api(urlFor(id), { method: 'DELETE' });
      if (res.ok) ok++;
      else if (res.status === 403) denied++;
      else fail++;
    } catch { fail++; }
  }
  let note = '已删除 ' + ok + ' 个' + noun;
  if (denied) note += '；' + denied + ' 个无权限（仅管理员或归属人可删）';
  if (fail) note += '；' + fail + ' 个删除失败';
  toast(note);
}

// 批量删除客户 —— 危险操作，二次确认
function openClientBatchDelete() {
  const ids = [...clientSelected];
  if (!ids.length) { toast('请先勾选左侧复选框选择要删除的客户'); return; }
  openModal('批量删除客户', ''
    + '<div class="batch-note danger-note">即将删除选中的 <b>' + ids.length + '</b> 位客户，此操作<b>不可恢复</b>！</div>'
    + '<div class="batch-note">注意：删除客户不会自动删除其名下的订单与询盘，相关记录将变为「无归属客户」，请先确认后再操作。</div>'
    + '<div class="modal-foot"><button type="button" class="btn-ghost" id="bmCancel">取消</button>'
    + '<button type="submit" class="btn-danger" id="bmDelete">确认删除 ' + ids.length + ' 位</button></div>',
    { plain: true, noFooter: true });
  document.getElementById('bmCancel').onclick = closeModal;
  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    document.getElementById('bmCancel').disabled = true;
    document.getElementById('bmDelete').disabled = true;
    await batchDeleteRecords(ids, (id) => '/api/clients/' + id, '客户');
    clientSelected.clear();
    closeModal();
    loadAll();
  };
}

function openOrderBatchDelete() {
  const ids = [...orderSelected];
  if (!ids.length) { toast('请先勾选左侧复选框选择要删除的订单'); return; }
  openModal('批量删除订单', ''
    + '<div class="batch-note danger-note">即将删除选中的 <b>' + ids.length + '</b> 笔订单，此操作<b>不可恢复</b>！</div>'
    + '<div class="modal-foot"><button type="button" class="btn-ghost" id="bmCancel">取消</button>'
    + '<button type="submit" class="btn-danger" id="bmDelete">确认删除 ' + ids.length + ' 笔</button></div>',
    { plain: true, noFooter: true });
  document.getElementById('bmCancel').onclick = closeModal;
  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    document.getElementById('bmCancel').disabled = true;
    document.getElementById('bmDelete').disabled = true;
    await batchDeleteRecords(ids, (id) => '/api/orders/' + id, '订单');
    orderSelected.clear();
    closeModal();
    loadAll();
  };
}

// 批量编辑客户 —— 右侧滑入弹窗
function openClientBatchEdit() {
  const ids = [...clientSelected];
  if (!ids.length) { toast('请先勾选左侧复选框选择要修改的客户'); return; }
  const uOpts = assignableUsers().map((u) => '<option value="' + u.id + '">' + esc(u.name || u.username) + '</option>').join('');
  const gOpts = ['S', 'A', 'B', 'C', 'D'].map((g) => '<option>' + g + '</option>').join('');
  openModal('批量编辑客户', ''
    + '<div class="batch-note">已选中 <b>' + ids.length + '</b> 位客户，将统一修改下面选择的字段</div>'
    + '<div class="field"><label>修改字段</label><select id="bmField"><option value="stage">等级</option><option value="owner">跟进人</option><option value="tags">标签</option></select></div>'
    + '<div class="field" id="bmGradeWrap"><label>新等级</label><select id="bmGrade">' + gOpts + '</select></div>'
    + '<div class="field hidden" id="bmOwnerWrap"><label>新跟进人</label><select id="bmOwner">' + uOpts + '</select></div>'
    + '<div class="field hidden" id="bmTagWrap"><label>新标签</label><input id="bmTags" placeholder="多个用逗号分隔；留空=清除所选客户现有标签" /></div>'
    + '<div class="modal-foot"><button type="button" class="btn-ghost" id="bmCancel">取消</button>'
    + '<button type="submit" class="btn-save">应用到 ' + ids.length + ' 位客户</button></div>',
    { plain: true, noFooter: true });
  const fld = document.getElementById('bmField');
  fld.onchange = () => {
    document.getElementById('bmGradeWrap').classList.toggle('hidden', fld.value !== 'stage');
    document.getElementById('bmOwnerWrap').classList.toggle('hidden', fld.value !== 'owner');
    document.getElementById('bmTagWrap').classList.toggle('hidden', fld.value !== 'tags');
  };
  document.getElementById('bmCancel').onclick = closeModal;
  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const field = fld.value;
    let payload;
    if (field === 'owner') {
      const value = document.getElementById('bmOwner').value;
      if (!value) { toast('请选择跟进人'); return; }
      payload = { owner: value, ownerName: ((allUsers || []).find((u) => u.id === value) || {}).name || '' };
    } else if (field === 'tags') {
      const raw = String(document.getElementById('bmTags').value || '').split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
      payload = { tags: [...new Set(raw)] };
    } else {
      payload = { stage: document.getElementById('bmGrade').value };
    }
    let ok = 0;
    for (const id of ids) {
      try { await api('/api/clients/' + id, { method: 'PUT', body: JSON.stringify(payload) }); ok++; } catch {}
    }
    toast('已更新 ' + ok + ' 位客户');
    clientSelected.clear();
    closeModal();
    loadAll();
  };
}
function openOrderBatchEdit() {
  const ids = [...orderSelected];
  if (!ids.length) { toast('请先勾选左侧复选框选择要修改的订单'); return; }
  const uOpts = assignableUsers().map((u) => '<option value="' + u.id + '">' + esc(u.name || u.username) + '</option>').join('');
  const sOpts = ['待确认', '已确认', '生产中', '已发货', '已收款', '已完成', '已取消'].map((s) => '<option>' + s + '</option>').join('');
  openModal('批量编辑订单', ''
    + '<div class="batch-note">已选中 <b>' + ids.length + '</b> 笔订单，将统一修改下面选择的字段</div>'
    + '<div class="field"><label>修改字段</label><select id="bmField"><option value="status">订单状态</option><option value="owner">业务员</option></select></div>'
    + '<div class="field" id="bmStatusWrap"><label>新状态</label><select id="bmStatus">' + sOpts + '</select></div>'
    + '<div class="field hidden" id="bmOwnerWrap"><label>新业务员</label><select id="bmOwner">' + uOpts + '</select></div>'
    + '<div id="bmResult" class="field full" role="status"></div>'
    + '<div class="modal-foot"><button type="button" class="btn-ghost" id="bmCancel">取消</button>'
    + '<button type="submit" class="btn-save">应用到 ' + ids.length + ' 笔订单</button></div>',
    { plain: true, noFooter: true });
  const fld = document.getElementById('bmField');
  fld.onchange = () => {
    document.getElementById('bmStatusWrap').classList.toggle('hidden', fld.value !== 'status');
    document.getElementById('bmOwnerWrap').classList.toggle('hidden', fld.value !== 'owner');
  };
  document.getElementById('bmCancel').onclick = closeModal;
  let pendingIds=ids.slice(),submitting=false;
  const batchForm=$('#modalForm');
  batchForm.onsubmit = async (e) => {
    e.preventDefault();
    if(submitting)return;
    const field = fld.value;
    let payload;
    if (field === 'owner') {
      const value = document.getElementById('bmOwner').value;
      if (!value) { toast('请选择业务员'); return; }
      payload = { owner: value, ownerName: ((allUsers || []).find((u) => u.id === value) || {}).name || '' };
    } else {
      payload = { status: document.getElementById('bmStatus').value };
    }
    submitting=true;
    const controls=[...batchForm.querySelectorAll('button,input,select')];controls.forEach(el=>el.disabled=true);
    const result=batchForm.querySelector('#bmResult'),failures=[],succeeded=[];
    try {
      result.textContent='正在批量保存 '+pendingIds.length+' 笔订单…';
      try {
        const response=await api('/api/orders/batch',{method:'PATCH',body:JSON.stringify({ids:pendingIds,patch:payload})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(response.status===404?'批量接口尚未启用，请重启 CRM 服务':data.error||('服务器返回 '+response.status));
        if(!Array.isArray(data.succeeded)||!Array.isArray(data.failed))throw Error('服务器返回格式异常');
        for(const id of pendingIds){
          if(data.succeeded.includes(id)){
            succeeded.push(id);
            const row=orders.find(o=>o.id===id);if(row)Object.assign(row,data.patch||payload);
          }else failures.push({id,reason:data.failed.find(f=>f.id===id)?.reason||'服务器未确认更新'});
        }
      }catch(err){pendingIds.forEach(id=>failures.push({id,reason:err.message||'网络错误，可重试'}));}
      succeeded.forEach(id=>orderSelected.delete(id));
      renderOrders();
      pendingIds=failures.map(x=>x.id);
      if(!failures.length){toast('已更新 '+succeeded.length+' 笔订单');if(document.getElementById('bmResult')===result)closeModal();}
      else {
        const label=id=>(orders.find(o=>o.id===id)?.orderNo)||id;
        result.innerHTML='<p>成功 '+succeeded.length+' 笔；失败 '+failures.length+' 笔。失败订单已保留，可重试。</p><ul>'+failures.map(f=>'<li>'+esc(label(f.id))+'：'+esc(f.reason)+'</li>').join('')+'</ul>';
        const submit=result.isConnected?batchForm.querySelector('[type="submit"]'):null;if(submit)submit.textContent='重试 '+failures.length+' 笔失败订单';
      }
    }finally{submitting=false;controls.forEach(el=>el.disabled=false);}

  };
}
// 客户筛选：按国家 / 来源 / 等级 / 是否成交
function clientHasOrder(c) {
  return orders.some((o) => (o.clientName || '') === (c.company || '') && ['已收款', '已发货'].includes(o.status || ''));
}
function initClientFilters() {
  const cf = document.getElementById('cfCountry');
  const sf = document.getElementById('cfSource');
  const gf = document.getElementById('cfGrade');
  const df = document.getElementById('cfDeal');
  const tf = document.getElementById('cfTag');
  const of = document.getElementById('cfFollow');
  if (!cf || !sf || !gf || !df || !tf || !of) return;
  const countries = [...new Set(clients.map((c) => c.country).filter(Boolean))].sort();
  const sources = [...new Set(clients.map((c) => c.source).filter(Boolean))].sort();
  const tags = [...new Set(clients.flatMap((c) => c.tags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  cf.innerHTML = '<option value="">全部国家</option>' + countries.map((v) => `<option ${v === clientFilter.country ? 'selected' : ''}>${esc(v)}</option>`).join('');
  sf.innerHTML = '<option value="">全部来源</option>' + sources.map((v) => `<option ${v === clientFilter.source ? 'selected' : ''}>${esc(v)}</option>`).join('');
  gf.innerHTML = '<option value="">全部等级</option>' + GRADES.map((g) => `<option ${g === clientFilter.grade ? 'selected' : ''}>${esc(g)}</option>`).join('');
  df.innerHTML = '<option value="">成交状态</option>'
    + '<option value="deal" ' + (clientFilter.deal === 'deal' ? 'selected' : '') + '>已成交</option>'
    + '<option value="nodeal" ' + (clientFilter.deal === 'nodeal' ? 'selected' : '') + '>未成交</option>';
  tf.innerHTML = '<option value="">全部标签</option>' + tags.map((v) => `<option value="${esc(v)}" ${v === clientFilter.tag ? 'selected' : ''}>${esc(v)}</option>`).join('');
  of.value = clientFilter.follow;
  cf.onchange = () => { clientFilter.country = cf.value; renderClients(); };
  sf.onchange = () => { clientFilter.source = sf.value; renderClients(); };
  gf.onchange = () => { clientFilter.grade = gf.value; renderClients(); };
  df.onchange = () => { clientFilter.deal = df.value; renderClients(); };
  tf.onchange = () => { clientFilter.tag = tf.value; renderClients(); };
  of.onchange = () => { clientFilter.follow = of.value; renderClients(); };
  const rb = document.getElementById('cfReset');
  if (rb) rb.onclick = () => {
    clientFilter = { country: '', source: '', grade: '', deal: '', tag: '', follow: '' };
    cf.value = ''; sf.value = ''; gf.value = ''; df.value = ''; tf.value = ''; of.value = '';
    renderClients();
  };
}

// 老客户缺 createdAt 时，用 updatedAt 兜底并回写，保证「创建日期」有值
let _backfilledCreated = false;
function backfillClientCreated() {
  if (_backfilledCreated) return;
  _backfilledCreated = true;
  clients.forEach((c) => {
    if (!c.createdAt) {
      const v = c.updatedAt || Date.now();
      try { api('/api/clients/' + c.id, { method: 'PUT', body: JSON.stringify({ createdAt: v }) }); } catch {}
    }
  });
}

(function () {
  const b = document.getElementById('clientBatchEdit');
  if (b) b.addEventListener('click', openClientBatchEdit);
  const d = document.getElementById('clientBatchDelete');
  if (d) d.addEventListener('click', openClientBatchDelete);
})();

(function () {
  const all = document.getElementById('cbOrderAll');
  if (all) all.addEventListener('change', () => {
    const cbs = document.querySelectorAll('#orderBody .cb-order');
    if (all.checked) cbs.forEach((cb) => orderSelected.add(cb.dataset.oid));
    else cbs.forEach((cb) => orderSelected.delete(cb.dataset.oid));
    renderOrders();
  });
  const b = document.getElementById('orderBatchEdit');
  if (b) b.addEventListener('click', openOrderBatchEdit);
  const d = document.getElementById('orderBatchDelete');
  if (d) d.addEventListener('click', openOrderBatchDelete);
})();

// ---------- 订单表格 ----------
function orderOwnerKey(o) {
  return o.owner ? 'id:' + String(o.owner) : o.ownerName ? 'name:' + o.ownerName.trim() : 'unassigned';
}
function orderSortDate(o){const s=String(o.orderDate||'').trim();const d=new Date(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(d)&&d.toISOString().slice(0,10)===s?s:'';}
function orderDateValue(o) {
  if (String(o.orderDate || '').trim()) return String(o.orderDate).trim();
  if (!o.createdAt) return '';
  const d = new Date(o.createdAt);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function renderOrders() {
  const ids=['orderStatusFilter','orderClientFilter','orderOwnerFilter','orderYearFilter','orderMonthFilter'];
  // Bind before the empty-result return, so filters always recover from zero matches.
  ids.forEach(id => { $('#'+id).onchange = renderOrders; });
  $('#orderFilterReset').onclick = () => { ids.forEach(id => { $('#'+id).value=''; }); renderOrders(); };
  const f = $('#orderStatusFilter').value, fc = $('#orderClientFilter').value, fo = $('#orderOwnerFilter').value;
  const fy = $('#orderYearFilter').value, fm = $('#orderMonthFilter').value;
  const body = $('#orderBody');
  function fillFilter(id,placeholder,options,value) {
    if (value && !options.some(o=>o.value===value)) options.push({value,label:value});
    const html = `<option value="">${placeholder}</option>` + options.map(o=>`<option value="${esc(o.value)}" ${o.value===value?'selected':''}>${esc(o.label)}</option>`).join('');
    if ($('#'+id).innerHTML!==html) $('#'+id).innerHTML=html;
  }
  fillFilter('orderClientFilter','全部客户',[...new Set(orders.map(o=>(o.clientName||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh')).map(value=>({value,label:value})),fc);
  const owners = new Map();
  orders.forEach(o=>owners.set(orderOwnerKey(o),clientOwnerLabel(o)));
  const ownerOptions=[...owners].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,'zh'));
  for (const option of ownerOptions) {
    if ([...owners.values()].filter(label=>label===option.label).length>1) {
      const user=allUsers.find(u=>'id:'+u.id===option.value);
      option.label += `（${user?.username || option.value.replace(/^[^:]+:/,'')}）`;
    }
  }
  fillFilter('orderOwnerFilter','全部负责人',ownerOptions,fo);
  fillFilter('orderYearFilter','全部年份',[...new Set(orders.map(o=>orderDateValue(o).slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort().reverse().map(value=>({value,label:value+' 年'})),fy);
  // 默认下单日期倒序，缺失日期放最后，同日按单号排序
  let list = orders.filter((o) => !f || o.status === f).sort((a,b)=>orderSortDate(b).localeCompare(orderSortDate(a))||byDocNo('orderNo')(a,b));
  if (fc) list = list.filter((o) => (o.clientName || '').trim() === fc);
  if (fo) list = list.filter(o => orderOwnerKey(o) === fo);
  if (fy) list = list.filter(o => orderDateValue(o).slice(0,4) === fy);
  if (fm) list = list.filter(o => orderDateValue(o).slice(5,7) === fm);

  const okTotal = $('#okTotal'); if (okTotal) okTotal.textContent = list.length;
  const okPending = $('#okPending'); if (okPending) okPending.textContent = list.filter((o) => o.status === '待确认').length;
  const okShipped = $('#okShipped'); if (okShipped) okShipped.textContent = list.filter((o) => o.status === '已发货').length;
  const moneyTotal=rows=>{
    let sum=0;for(const o of rows){const amount=Number(o.amount)||0;const value=o.currency==='CNY'?amount:toCNY(amount,o.currency);if(value==null&&amount)return '汇率暂不可用';sum+=value||0;}return fmtMoney(sum);
  };
  const okAmount=$('#okAmount');if(okAmount)okAmount.textContent=moneyTotal(list.filter(o=>['待确认','已确认','生产中','已发货'].includes(o.status)));
  const paid=$('#okPaidAmount');if(paid)paid.textContent=moneyTotal(list.filter(o=>['已收款','已完成'].includes(o.status)));
  const monthAmount=$('#okMonthAmount');if(monthAmount)monthAmount.textContent=moneyTotal(list.filter(o=>!['已取消','Cancelled'].includes(o.status)));


  const orderMeta = $('#orderMeta');
  if (orderMeta) orderMeta.textContent = '共 ' + list.length + ' 笔订单';

  if (!list.length) { body.innerHTML = '<tr><td colspan="11" class="empty">暂无符合筛选条件的订单</td></tr>'; return; }
  body.innerHTML = list.map((o) => {
    const cny = toCNY(Number(o.amount) || 0, o.currency);
    const hasShipment = typeof orderHasShipment === 'function' && orderHasShipment(o.orderNo);
    const orderDate = orderDateValue(o);
    return `<tr>
      <td data-col="c0"><input type="checkbox" class="cb-order" data-oid="${esc(o.id)}" ${orderSelected.has(o.id) ? 'checked' : ''} /></td>
      <td data-col="c1"><span class="mono">${esc(o.orderNo || '-')}</span></td>
      <td data-col="c2"><button type="button" class="order-detail-link" data-detail-o="${esc(o.id)}" title="查看订单详情">${esc(o.clientName || '未填写客户 · 查看订单')}</button></td>
      <td data-col="owner">${esc(clientOwnerLabel(o))}</td>
      <td data-col="c3">${esc(o.country || '-')}</td>
      <td data-col="c4" class="amount text-right">${(Number(o.amount) || 0).toLocaleString()} ${esc(o.currency || '')}</td>
      <td data-col="c5" class="amount cny text-right">${cny != null ? fmtMoney(cny) : '—'}</td>
      <td data-col="c6">${orderStatusTag(o.status)}</td>
      <td data-col="c7" class="date">${esc(orderDate || '-')}</td>
      <td data-col="c8" class="date">${esc(o.deliveryDate || '-')}</td>
      <td data-col="c9" class="text-center order-actions">
        <button class="action-btn" data-edit-o="${esc(o.id)}" title="编辑">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${!hasShipment ? `<button class="action-btn" data-ship-o="${esc(o.id)}" title="${o.status === '已发货' ? '补录出货' : '发货'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 20 19 16 19 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        </button>` : ''}
        <button class="action-btn" data-del-o="${esc(o.id)}" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.cb-order').forEach((cb) => cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (cb.checked) orderSelected.add(cb.dataset.oid); else orderSelected.delete(cb.dataset.oid);
    renderOrderBatchBar();
  }));
  renderOrderBatchBar();
  body.querySelectorAll('[data-detail-o]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openOrderDetail(b.dataset.detailO); }));
  body.querySelectorAll('[data-edit-o]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openOrderModal(b.dataset.editO); }));
  body.querySelectorAll('[data-ship-o]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const o = orders.find((x) => x.id === b.dataset.shipO);
    if (o && typeof quickShip === 'function') quickShip(o);
  }));
  body.querySelectorAll('[data-del-o]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('确认删除该订单？')) { await api('/api/orders/' + b.dataset.delO, { method: 'DELETE' }); toast('已删除'); loadAll(); }
  }));
  $('#orderStatusFilter').onchange = renderOrders;
  $('#orderClientFilter').onchange = renderOrders;
  $('#orderOwnerFilter').onchange = renderOrders;
}

// ================= 弹窗（客户/订单） =================
const modal = $('#modal');
let modalDrag = { dx: 0, dy: 0, startX: 0, startY: 0, active: false };
function resetModalDrag() {
  modalDrag = { dx: 0, dy: 0, startX: 0, startY: 0, active: false };
  const box = document.querySelector('.modal-box');
  if (box) { box.style.transform = ''; box.classList.remove('is-dragging'); }
}
function onDragStart(e) {
  if (e.target.closest('.x')) return;
  const box = document.querySelector('.modal-box');
  if (!box || !modal.classList.contains('showing')) return;
  modalDrag.active = true;
  const p = e.touches ? e.touches[0] : e;
  modalDrag.startX = p.clientX; modalDrag.startY = p.clientY;
  box.classList.add('is-dragging');
}
function onDragMove(e) {
  if (!modalDrag.active) return;
  e.preventDefault();
  const p = e.touches ? e.touches[0] : e;
  modalDrag.dx = p.clientX - modalDrag.startX;
  modalDrag.dy = p.clientY - modalDrag.startY;
  const box = document.querySelector('.modal-box');
  if (box) box.style.transform = `translate(${modalDrag.dx}px, ${modalDrag.dy}px) scale(1)`;
}
function onDragEnd() {
  if (!modalDrag.active) return;
  modalDrag.active = false;
  const box = document.querySelector('.modal-box');
  if (box) box.classList.remove('is-dragging');
}
const modalHead = document.querySelector('.modal-head');
if (modalHead) {
  modalHead.addEventListener('mousedown', onDragStart);
  modalHead.addEventListener('touchstart', onDragStart, { passive: true });
}
window.addEventListener('mousemove', onDragMove);
window.addEventListener('touchmove', onDragMove, { passive: false });
window.addEventListener('mouseup', onDragEnd);
window.addEventListener('touchend', onDragEnd);
function checkModalScroll() {
  const form = document.getElementById('modalForm');
  if (!form) return;
  // 仅用于显示底部渐变阴影：弹窗顶到 95vh 时 form 才会真的出现滚动条
  form.classList.toggle('can-scroll', form.scrollHeight > form.clientHeight + 2);
}

function openModal(title, html, opts = {}) {
  document.dispatchEvent(new Event('ftw:modal-replace'));
  resetModalDrag();
  $('#modalTitle').textContent = title;
  const box = document.querySelector('.modal-box');
  box.className = 'modal-box' + (opts.wide ? ' modal-box--wide' : '');
  const form = $('#modalForm');
  form.className = 'modal-form' + (opts.plain ? ' modal-form--plain' : '');
  form.onsubmit = null; // 清除上一个弹窗残留的提交处理，避免串台
  form.innerHTML = html;
  // 页脚移到表单外、固定在弹窗底部（始终可见，不被长表单滚动遮住）
  const footEl = document.getElementById('modalFoot');
  if (footEl) footEl.innerHTML = opts.noFooter ? '' :
    '<button type="button" class="btn-ghost" id="mCancel">取消</button>' +
    '<button type="submit" form="modalForm" class="btn-save">保存</button>';
  modal.classList.add('open'); // 先 display:flex
  // 下一帧再触发动画（双 rAF 确保浏览器提交了 display 变化）
  requestAnimationFrame(() => requestAnimationFrame(() => {
    modal.classList.add('showing');
  }));
  if (!opts.noFooter && footEl) { const c = document.getElementById('mCancel'); if (c) c.onclick = closeModal; }
  setTimeout(checkModalScroll, 120);
}
function closeModal() {
  document.dispatchEvent(new Event('ftw:modal-close'));
  resetModalDrag();
  modal.classList.remove('showing');
  setTimeout(() => { modal.classList.remove('open'); }, 250);
}
$('#modalClose').onclick = closeModal;
let modalBackdropStart=null;
modal.addEventListener('pointerdown',e=>{modalBackdropStart=e.target===modal?{x:e.clientX,y:e.clientY,id:e.pointerId}:null;});
modal.addEventListener('pointercancel',()=>{modalBackdropStart=null;});
modal.addEventListener('click',e=>{const start=modalBackdropStart;modalBackdropStart=null;if(e.target===modal&&start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<6)closeModal();});

const field = (label, name, val, type = 'text', opts = '') =>
  `<div class="field"><label>${label}</label><input name="${name}" value="${esc(val)}" type="${type}" ${opts}/></div>`;
const selectField = (label, name, val, options) =>
  `<div class="field"><label>${label}</label><select name="${name}">${options.map((o) => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;

// ===== 国家下拉选项（中文显示）：常用外贸国家 + 自动并入已有客户数据里的国家，避免老值丢失 =====
// 国家和地区：补齐 ISO 地区清单，保留已有业务名称兼容历史记录。
const COMMON_COUNTRIES_CN = [
  "中国",
  "美国",
  "加拿大",
  "墨西哥",
  "巴西",
  "智利",
  "阿根廷",
  "秘鲁",
  "哥伦比亚",
  "委内瑞拉",
  "英国",
  "德国",
  "法国",
  "意大利",
  "西班牙",
  "葡萄牙",
  "荷兰",
  "比利时",
  "瑞士",
  "瑞典",
  "挪威",
  "丹麦",
  "芬兰",
  "波兰",
  "捷克",
  "匈牙利",
  "希腊",
  "奥地利",
  "爱尔兰",
  "土耳其",
  "俄罗斯",
  "乌克兰",
  "白俄罗斯",
  "拉脱维亚",
  "立陶宛",
  "爱沙尼亚",
  "罗马尼亚",
  "保加利亚",
  "塞尔维亚",
  "斯洛伐克",
  "斯洛文尼亚",
  "克罗地亚",
  "冰岛",
  "以色列",
  "沙特阿拉伯",
  "阿联酋",
  "卡塔尔",
  "科威特",
  "阿曼",
  "约旦",
  "黎巴嫩",
  "伊拉克",
  "伊朗",
  "巴基斯坦",
  "印度",
  "孟加拉国",
  "斯里兰卡",
  "尼泊尔",
  "马尔代夫",
  "阿富汗",
  "哈萨克斯坦",
  "乌兹别克斯坦",
  "土库曼斯坦",
  "吉尔吉斯斯坦",
  "塔吉克斯坦",
  "蒙古",
  "印度尼西亚",
  "马来西亚",
  "新加坡",
  "泰国",
  "越南",
  "老挝",
  "柬埔寨",
  "缅甸",
  "菲律宾",
  "文莱",
  "韩国",
  "朝鲜",
  "日本",
  "澳大利亚",
  "新西兰",
  "埃及",
  "利比亚",
  "突尼斯",
  "阿尔及利亚",
  "摩洛哥",
  "苏丹",
  "埃塞俄比亚",
  "肯尼亚",
  "乌干达",
  "坦桑尼亚",
  "卢旺达",
  "尼日利亚",
  "加纳",
  "科特迪瓦",
  "塞内加尔",
  "喀麦隆",
  "安哥拉",
  "赞比亚",
  "津巴布韦",
  "莫桑比克",
  "马达加斯加",
  "毛里求斯",
  "南非",
  "纳米比亚",
  "博茨瓦纳",
  "中国香港",
  "中国澳门",
  "中国台湾",
  "安道尔",
  "阿拉伯联合酋长国",
  "安提瓜和巴布达",
  "安圭拉",
  "阿尔巴尼亚",
  "亚美尼亚",
  "南极洲",
  "美属萨摩亚",
  "阿鲁巴",
  "奥兰群岛",
  "阿塞拜疆",
  "波斯尼亚和黑塞哥维那",
  "巴巴多斯",
  "布基纳法索",
  "巴林",
  "布隆迪",
  "贝宁",
  "圣巴泰勒米",
  "百慕大",
  "玻利维亚",
  "荷属加勒比区",
  "巴哈马",
  "不丹",
  "布韦岛",
  "伯利兹",
  "科科斯（基林）群岛",
  "刚果（金）",
  "中非共和国",
  "刚果（布）",
  "库克群岛",
  "哥斯达黎加",
  "古巴",
  "佛得角",
  "库拉索",
  "圣诞岛",
  "塞浦路斯",
  "吉布提",
  "多米尼克",
  "多米尼加共和国",
  "厄瓜多尔",
  "西撒哈拉",
  "厄立特里亚",
  "斐济",
  "福克兰群岛",
  "密克罗尼西亚",
  "法罗群岛",
  "加蓬",
  "格林纳达",
  "格鲁吉亚",
  "法属圭亚那",
  "根西岛",
  "直布罗陀",
  "格陵兰",
  "冈比亚",
  "几内亚",
  "瓜德罗普",
  "赤道几内亚",
  "南乔治亚和南桑威奇群岛",
  "危地马拉",
  "关岛",
  "几内亚比绍",
  "圭亚那",
  "赫德岛和麦克唐纳群岛",
  "洪都拉斯",
  "海地",
  "马恩岛",
  "英属印度洋领地",
  "泽西岛",
  "牙买加",
  "基里巴斯",
  "科摩罗",
  "圣基茨和尼维斯",
  "开曼群岛",
  "圣卢西亚",
  "列支敦士登",
  "利比里亚",
  "莱索托",
  "卢森堡",
  "摩纳哥",
  "摩尔多瓦",
  "黑山",
  "法属圣马丁",
  "马绍尔群岛",
  "北马其顿",
  "马里",
  "北马里亚纳群岛",
  "马提尼克",
  "毛里塔尼亚",
  "蒙特塞拉特",
  "马耳他",
  "马拉维",
  "新喀里多尼亚",
  "尼日尔",
  "诺福克岛",
  "尼加拉瓜",
  "瑙鲁",
  "纽埃",
  "巴拿马",
  "法属波利尼西亚",
  "巴布亚新几内亚",
  "圣皮埃尔和密克隆群岛",
  "皮特凯恩群岛",
  "波多黎各",
  "巴勒斯坦领土",
  "帕劳",
  "巴拉圭",
  "留尼汪",
  "所罗门群岛",
  "塞舌尔",
  "圣赫勒拿",
  "斯瓦尔巴和扬马延",
  "塞拉利昂",
  "圣马力诺",
  "索马里",
  "苏里南",
  "南苏丹",
  "圣多美和普林西比",
  "萨尔瓦多",
  "荷属圣马丁",
  "叙利亚",
  "斯威士兰",
  "特克斯和凯科斯群岛",
  "乍得",
  "法属南部领地",
  "多哥",
  "托克劳",
  "东帝汶",
  "汤加",
  "特立尼达和多巴哥",
  "图瓦卢",
  "美国本土外小岛屿",
  "乌拉圭",
  "梵蒂冈",
  "圣文森特和格林纳丁斯",
  "英属维尔京群岛",
  "美属维尔京群岛",
  "瓦努阿图",
  "瓦利斯和富图纳",
  "萨摩亚",
  "也门",
  "马约特"
];
window.countryOptionsHtml = (sel) => {
  const all = new Set(COMMON_COUNTRIES_CN);
  // 并入现有数据里的国家（含历史英文值），保证编辑老客户不丢值
  try {
    (typeof clients !== 'undefined' ? clients : []).forEach((c) => { if (c.country && c.country.trim()) all.add(c.country.trim()); });
  } catch {}
  // 并入当前值：AI 解析/邮箱推断出的国家可能不在预设表里，不并入会被 select 吞掉
  if (sel && String(sel).trim()) all.add(String(sel).trim());
  const opts = ['<option value="">— 未填 —</option>',
    ...[...all].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).map((o) => `<option value="${esc(o)}" ${o === sel ? 'selected' : ''}>${esc(o)}</option>`)];
  return opts.join('');
};
const countryField = (label, name, sel) =>
  `<div class="field"><label>${label}</label><select name="${name}">${window.countryOptionsHtml(sel)}</select></div>`;

// 主联系人同步回客户档案的单联系人字段（供 WhatsApp/邮件等旧模块继续按 c.contactName 工作）
window.updateClientLegacyContact = async (clientId, fields) => {
  const c = clients.find((x) => x.id === clientId);
  if (c) Object.assign(c, fields);
  try { await api('/api/clients/' + clientId, { method: 'PUT', body: JSON.stringify(fields) }); } catch {}
};

function clientDefaultFollowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function openClientModal(id, prefill, onSaved) {
  const c = (id ? clients.find((x) => x.id === id) : prefill) || {};
  // 跟进人：默认当前登录用户，可改派给其他业务员（与订单/询盘同一套下拉）
  const ownerVal = c.owner || (currentUser ? currentUser.id : '');
  const ownerOpts = ['<option value="">— 未指定 —</option>',
    ...assignableUsers().map((u) => `<option value="${u.id}" ${u.id === ownerVal ? 'selected' : ''}>${esc(u.name || u.username)}</option>`)].join('');
  openModal(id ? '编辑客户' : '新增客户', `
    ${field('公司名 *', 'company', c.company, 'text', 'required')}
    ${countryField('国家', 'country', c.country)}
    ${field('联系人', 'contactName', c.contactName)}
    ${selectField('等级', 'stage', gradeOf(c.stage), GRADES)}
    ${field('邮箱', 'contactEmail', c.contactEmail, 'email')}
    ${field('电话', 'contactPhone', c.contactPhone)}
    ${window.waFieldHtml ? window.waFieldHtml(c) : ''}
    ${field('来源', 'source', c.source)}
    ${field('产品兴趣', 'productInterest', c.productInterest, 'text', 'placeholder="如：链板输送机 / 整线"')}
    ${field('标签', 'tags', (c.tags || []).join('，'), 'text', 'placeholder="多个用逗号分隔，如：重点客户，返单"')}
    ${field('下次跟进日期', 'nextFollowUp', c.nextFollowUp || clientDefaultFollowDate(), 'date')}
    <div class="field"><label>跟进人</label><select name="owner">${ownerOpts}</select></div>
    <div class="field full"><label>备注</label><textarea name="notes">${esc(c.notes)}</textarea></div>
  `);
  // 填国家时自动预选区号（仅在区号还空着时，不覆盖已选）
  const cf = $('#modalForm');
  const ctryEl = cf.querySelector('[name="country"]');
  const dialEl = cf.querySelector('[name="waDial"]');
  if (ctryEl && dialEl && window.waDialOf) {
    ctryEl.addEventListener('change', () => {
      if (dialEl.value) return;
      const d = window.waDialOf({ country: ctryEl.value });
      if (d) { dialEl.value = d; dialEl.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  cf.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const ownerId = fd.owner || (currentUser ? currentUser.id : '');
    const ownerUser = allUsers.find((u) => u.id === ownerId);
    // 标签：逗号/顿号/空白 分隔成数组，去空去重
    const rawTags = String(fd.tags || '').split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    fd.tags = [...new Set(rawTags)];
    const body = { ...fd, owner: ownerId, ownerName: ownerUser ? (ownerUser.name || ownerUser.username) : (currentUser ? currentUser.name : ''), createdAt: id ? (c.createdAt || Date.now()) : Date.now() };
    // 「阶段」不再由弹窗填写：始终交给 phaseOf(c) 自动推导（在途询盘 → 历史映射 → 有单成交），
    // 只在档案里显式存过 phase 时才保留原值（v20260911c 减负：客户弹窗字段 15 → 14）
    delete body.phase;
    const url = id ? '/api/clients/' + id : '/api/clients';
    const m = id ? 'PUT' : 'POST';
    const r = await api(url, { method: m, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || ('HTTP ' + r.status))); return; }
    // 同步关联询盘的跟进人
    if (body.company && ownerId) {
      try {
        const inqs = window.getAllInquiries ? window.getAllInquiries() : [];
        const matched = inqs.filter((iq) => (iq.clientName || '').trim() === body.company.trim());
        for (const iq of matched) {
          await api('/api/inquiries/' + iq.id, { method: 'PUT', body: JSON.stringify({ owner: ownerId, ownerName: body.ownerName }) });
        }
      } catch { /* 非关键操作 */ }
    }
    if (typeof onSaved === 'function') {
      const savedClient = await r.json();
      await onSaved(savedClient);
      return;
    }
    toast('已保存'); closeModal(); loadAll();
  };
}
function openOrderModal(id, prefill) {
  const o = (id && orders.find((x) => x.id === id)) || prefill || {};
  const clientOpts = [...new Set(['', ...clients.map((c) => c.company), ...(o.clientName ? [o.clientName] : [])])];
  const ownerVal = o.owner || (currentUser ? currentUser.id : '');
  const ownerOpts = ['<option value="">— 未指定 —</option>',
    ...assignableUsers().map((u) => `<option value="${u.id}" ${u.id === ownerVal ? 'selected' : ''}>${esc(u.name || u.username)}</option>`)].join('');
  openModal(id ? '编辑订单' : '新增订单', `
    ${field('订单号 *', 'orderNo', o.orderNo, 'text', 'required')}
    ${selectField('客户', 'clientName', o.clientName || '', clientOpts)}
    <div id="orderClientPreview" class="field full client-preview hidden"></div>
    ${field('国家', 'country', o.country)}
    ${field('金额', 'amount', o.amount, 'number', 'step="0.01"')}
    ${selectField('币种', 'currency', o.currency || 'USD', CURRENCIES)}
    ${selectField('状态', 'status', o.status || '待确认', STATUSES)}
    ${selectField('商机阶段', 'stage', o.stage || '初步接触', OPPTY_STAGES)}
    ${field('成交概率(%)', 'probability', o.probability != null ? o.probability : 20, 'number', 'min="0" max="100"')}
    ${field('下单日期', 'orderDate', o.orderDate, 'date')}
    ${field('交期', 'deliveryDate', o.deliveryDate, 'date')}
    ${field('付款方式', 'paymentTerms', o.paymentTerms)}
    ${salesOrderFields(o)}
    <div class="field"><label>责任人</label><select name="owner">${ownerOpts}</select></div>
    <section class="field full order-items-editor"><div class="items-head"><b>产品明细</b><button type="button" class="btn-mini" id="oiAdd">+ 添加产品</button></div><div id="oiRows"></div><div class="items-head"><span id="oiTotal"></span><button type="button" class="btn-mini" id="oiUseTotal">用明细合计填入订单金额</button></div></section>
    <div class="field full"><label>备注</label><textarea name="notes">${esc(o.notes)}</textarea></div>
  `, {wide:true});
  bindSalesPercentControls($('#modalForm'));
  const itemEditor = bindOrderItems(o);
  // 选中客户后，自动从客户档案填充所有可对应的订单字段，并展示联系方式供确认
  const form = $('#modalForm');
  const clientSel = form.querySelector('select[name="clientName"]');
  const countryEl = form.querySelector('input[name="country"]');
  const ownerSel = form.querySelector('select[name="owner"]');
  const currencySel = form.querySelector('select[name="currency"]');
  const paymentEl = form.querySelector('input[name="paymentTerms"]');
  const preview = form.querySelector('#orderClientPreview');
  const initialOrder = { ...o };
  function fillFromClient(name) {
    const linked = clients.find((c) => (c.company || '').trim() === (name || '').trim());
    if (!linked) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }
    // 新增订单只填空白项；编辑订单保留订单已有值，避免选择客户时覆盖用户修改。
    if (countryEl && !initialOrder.country && linked.country) countryEl.value = linked.country;
    if (ownerSel && !initialOrder.owner && linked.owner) ownerSel.value = linked.owner;
    // 客户档案若有常用币种/付款方式，也同步到订单；兼容旧数据字段名。
    const clientCurrency = linked.currency || linked.preferredCurrency || linked.defaultCurrency;
    const clientPayment = linked.paymentTerms || linked.paymentMethod || linked.payment;
    if (currencySel && !initialOrder.currency && clientCurrency && [...currencySel.options].some((x) => x.value === clientCurrency)) currencySel.value = clientCurrency;
    if (paymentEl && !initialOrder.paymentTerms && clientPayment) paymentEl.value = clientPayment;
    const lines = [];
    if (linked.contactName) lines.push(`<b>👤 ${esc(linked.contactName)}</b>`);
    if (linked.contactPhone) lines.push(`☎ ${esc(linked.contactPhone)}`);
    if (linked.contactEmail) lines.push(`✉ ${esc(linked.contactEmail)}`);
    if (linked.stage) lines.push(`<span class="cp-stage st-${esc(linked.stage)}">${esc(linked.stage)}</span>`);
    const matched = [linked.country ? '国家' : '', linked.owner ? '责任人' : '', clientCurrency ? '币种' : '', clientPayment ? '付款方式' : ''].filter(Boolean);
    preview.innerHTML = lines.length || matched.length
      ? `<div class="cp-card"><b>${esc(linked.company || '')}</b> · ${esc(linked.country || '未填')}<div class="cp-meta">${lines.join(' · ') || '暂无联系人资料'}${matched.length ? `<span class="cp-filled">已自动匹配：${matched.join('、')}</span>` : ''}</div></div>`
      : '';
    preview.classList.toggle('hidden', !(lines.length || matched.length));
  }
  if (clientSel) {
    clientSel.addEventListener('change', (e) => fillFromClient(e.target.value));
    if (o.clientName) fillFromClient(o.clientName); // 编辑时回填预览
  }
  let orderSaving = false;
  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    if (orderSaving) return;
    const items=itemEditor();
    if(items.some(it=>!it.name.trim() || !Number.isFinite(it.qty) || it.qty<=0 || !Number.isFinite(it.unitPrice) || it.unitPrice<0))return toast('请填写产品名称、有效数量和单价');
    if(items.length && !await orderItemsReady())return;
    if(items.some(it=>it.lineAmount!=null && (!Number.isFinite(it.lineAmount)||it.lineAmount<0)))return toast('请输入有效的产品金额');
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const ownerId = fd.owner || (currentUser ? currentUser.id : '');
    const ownerName = (allUsers.find((u) => u.id === ownerId) || {}).name || (currentUser ? currentUser.name : '');
    const linkedClient = clients.find((c) => (c.company || '').trim() === (fd.clientName || '').trim());
    const body = { ...fd, ...salesPercentValues($('#modalForm'),['productionProgress','depositPercent','paidPercent']), items, clientId: linkedClient ? linkedClient.id : (o.clientId || null), owner: ownerId, ownerName, probability: Number(fd.probability) || 0 };
    const url = id ? '/api/orders/' + id : '/api/orders';
    const m = id ? 'PUT' : 'POST';
    orderSaving = true;
    const saveButton=e.target.querySelector('[type="submit"]');
    if(saveButton)saveButton.disabled=true;
    try {
      const r = await api(url, { method: m, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || ('HTTP ' + r.status))); return; }
      toast('已保存'); closeModal(); loadAll();
    } catch (error) {
      toast('保存未确认，填写内容已保留。请核对订单后重试：'+error.message);
    } finally {
      orderSaving=false;
      if(saveButton)saveButton.disabled=false;
    }
  };
}
$('#clientAdd').onclick = () => openClientModal();
$('#orderColumns').onclick = () => window.openColumnCfg('orderBody');
$('#orderAdd').onclick = () => openOrderModal();
$('#orderAiAdd').onclick = () => { if (typeof openAiOrderRegister === 'function') openAiOrderRegister(); else toast('AI 模块未加载'); };

// ================= 客户详情页 =================
function renderCommBlock(inq) {
  const log = (inq.chatLog || '').trim();
  const attachments = (inq.attachments || []).map((a) => `<a href="${esc(a.url)}" target="_blank" class="attach-link">📎 ${esc(a.name)}</a>`).join(' ');
  return `<div class="cd-comm">
    <div class="cd-comm-h">
      <b>${esc(inq.product || '未指定产品')}</b>
      <span class="stage">${esc(inq.status || '新询盘')}</span>
      <span class="muted">${esc(inq.receivedAt || '')} · ${inq.expectedAmount ? Number(inq.expectedAmount).toLocaleString() + ' ' + esc(inq.currency || 'USD') : ''}</span>
    </div>
    ${attachments ? `<div class="cd-comm-attach">${attachments}</div>` : ''}
    ${log
      ? `<pre class="cd-comm-body">${esc(log)}</pre>`
      : '<div class="muted" style="font-size:12px">（未填写沟通记录）</div>'}
  </div>`;
}

function openClientDetail(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return;
  const myOrders = orders.filter((o) => o.clientId === c.id || (o.clientName || '') === (c.company || ''));
  const myQuotes = (window.getAllQuotations ? window.getAllQuotations().filter((x) => x.clientId === c.id || (x.clientName || '') === (c.company || '')) : [])
    .slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const myInqs = (window.getAllInquiries ? window.getAllInquiries().filter((x) => x.clientId === c.id || (x.clientName || '') === (c.company || '')) : [])
    .slice().sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  const myComms = (window.getAllComms ? window.getAllComms() : []).filter((x) => (x.clientName || '').trim().toLowerCase() === (c.company || '').trim().toLowerCase()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const myChats = (window.getAllChats ? window.getAllChats() : []).filter((x) => (x.clientName || '').trim().toLowerCase() === (c.company || '').trim().toLowerCase()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const qtTotalOf = (q) => (q.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const timeline = [
    ...myInqs.map((x) => ({ date: x.receivedAt || '', type: '询盘', title: x.product || '新询盘', meta: x.status || '' })),
    ...myQuotes.map((x) => ({ date: x.validUntil || (x.createdAt ? new Date(x.createdAt).toISOString().slice(0, 10) : ''), type: '报价', title: (x.quoteNo || '报价') + ' · ' + (x.projectName || ''), meta: (x.status || '草稿') + ' · ' + qtTotalOf(x).toLocaleString() + ' ' + (x.currency || 'USD') })),
    ...myOrders.map((x) => ({ date: x.orderDate || (x.createdAt ? new Date(x.createdAt).toISOString().slice(0, 10) : ''), type: '订单', title: x.orderNo || '订单', meta: x.status || '' })), 
    ...myComms.map((x) => ({ date: x.date || '', type: x.channel || '沟通', title: x.summary || '沟通记录', meta: (x.content || '').slice(0, 80) })),
    ...myChats.map((x) => ({ date: fmtDateShort(x.createdAt), type: '聊天', title: x.title || '聊天记录', meta: (x.raw || '').slice(0, 80) })),
  ].filter((x) => x.date).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20);
  const timelineHtml = timeline.length ? timeline.map((x) => `<div class="cd-timeline-row"><span class="cd-timeline-date">${esc(x.date)}</span><span class="cd-timeline-type">${esc(x.type)}</span><div><b>${esc(x.title)}</b><div class="muted">${esc(x.meta)}</div></div></div>`).join('') : '<div class="muted">暂无统一时间线记录</div>';
  const ordersHtml = myOrders.length ? `<table class="cd-table">
      <thead><tr><th>订单号</th><th>金额</th><th>折合 CNY</th><th>状态</th><th>下单日期</th><th>交期</th><th></th></tr></thead>
      <tbody>${myOrders.map((o) => `<tr>
        <td>${esc(o.orderNo || '-')}</td>
        <td>${(Number(o.amount) || 0).toLocaleString()} ${esc(o.currency || '')}</td>
        <td>${toCNY(Number(o.amount) || 0, o.currency) != null ? fmtMoney(toCNY(Number(o.amount) || 0, o.currency)) : '—'}</td>
        <td><span class="stage st-${o.status || '待确认'}">${esc(o.status || '待确认')}</span></td>
        <td>${esc(o.orderDate || (o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : '-'))}</td>
        <td>${esc(o.deliveryDate || '-')}</td>
        <td><button class="link-btn" data-edit-o="${o.id}">查看</button></td>
      </tr>`).join('')}</tbody>
    </table>` : '<div class="muted">暂无订单</div>';
  // 派生字段：创建日期 / 上次成交 / 累计成交金额 / 当前联系人职位
  const myDealOrders = myOrders.filter((o) => ['已收款', '已发货'].includes(o.status || ''));
  const cumCNY = myDealOrders.reduce((s, o) => s + (toCNY(Number(o.amount) || 0, o.currency) || 0), 0);
  const dealDates = myDealOrders.map((o) => o.orderDate || o.deliveryDate || (o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : '')).filter(Boolean).sort();
  const lastDeal = dealDates.length ? dealDates[dealDates.length - 1] : '-';
  const createdAtStr = (c.createdAt || c.updatedAt) ? new Date(c.createdAt || c.updatedAt).toISOString().slice(0, 10) : '-';
  const consAll = (window.getContactsByClient ? window.getContactsByClient(c.id) : []);
  const prim = consAll.find((x) => x.isPrimary) || consAll[0];
  const contactNameTitle = prim ? (prim.name + (prim.title ? ' · ' + prim.title : (prim.role ? ' · ' + prim.role : ''))) : (c.contactName ? c.contactName + ' · （未设职位）' : '-');
  openModal(c.company + ' · 客户详情', `
    <div class="cd-head">
      <div class="cd-name">${esc(c.company)}</div>
      <div class="cd-sub">${esc(c.country || '未知国家')} · <span class="stage">${esc(gradeOf(c.stage))}</span></div>
      <div class="cd-actions">
        <button class="btn-primary btn-mini" type="button" id="cdNewInquiry">+ 新建询盘</button>
        <button class="btn-mini" type="button" id="cdNewTask">+ 新建任务</button>
        <button class="btn-mini" type="button" id="cdNewComm">+ 沟通记录</button>
      </div>
    </div>
    <div class="cd-grid">
      <div class="cd-info">
        <div class="cd-row"><span>联系人</span><b>${esc(c.contactName || '-')}</b></div>
        <div class="cd-row"><span>邮箱</span><b>${esc(c.contactEmail || '-')}</b></div>
        <div class="cd-row"><span>电话</span><b>${esc(c.contactPhone || '-')}</b></div>
        <div class="cd-row"><span>WhatsApp</span>${(window.waHasNumber && window.waHasNumber(c))
    ? `<span class="cd-wa">${window.waDetailHtml(c)} <button class="link-btn wa-mini" type="button" id="cdWa">🟢 一键发起</button> <button class="link-btn" type="button" id="cdWaEdit">✏️ 编辑</button></span>`
    : `<span class="cd-wa"><span class="muted">未填写</span> <button class="link-btn wa-mini" type="button" id="cdWa">➕ 填号码并发起</button></span>`}</div>
        <div class="cd-row"><span>来源</span><b>${esc(c.source || '-')}</b></div>
        <div class="cd-row"><span>下次跟进</span><b>${esc(c.nextFollowUp || '-')}</b></div>
        <div class="cd-row"><span>创建日期</span><b>${esc(createdAtStr)}</b></div>
        <div class="cd-row"><span>上次成交</span><b>${esc(lastDeal)}</b></div>
        <div class="cd-row"><span title="已收款、已发货订单按汇率折合人民币汇总">累计采购额（CNY）</span><b>${fmtMoney(cumCNY)}</b></div>
        <div class="cd-row"><span>当前联系人</span><b>${esc(contactNameTitle)}</b></div>
      </div>
      <div class="cd-impression">
        <label>我对他的印象 / 备注</label>
        <textarea id="cdNotes" rows="6" placeholder="记录你对这个客户的印象、偏好、关键人关系等…">${esc(c.notes)}</textarea>
        <button class="btn-mini" id="cdSaveNotes" type="button">💾 保存印象</button>
      </div>
    </div>
    <div class="cd-section">
      <div class="cd-sec-t">🕘 客户时间线（${timeline.length}）</div>
      <div class="cd-timeline">${timelineHtml}</div>
    </div>
    <div class="cd-section">
      <div class="cd-sec-t">📋 报价单（${myQuotes.length}） <button class="link-btn" id="cdNewQuote">+ 新建报价</button></div>
      ${myQuotes.length ? `<table class="cd-table">
        <thead><tr><th>报价单号</th><th>项目</th><th>金额</th><th>折合 CNY</th><th>状态</th><th>有效期</th><th></th></tr></thead>
        <tbody>${myQuotes.map((q) => `<tr>
          <td>${esc(q.quoteNo || '-')}</td>
          <td>${esc(q.projectName || '-')}</td>
          <td>${qtTotalOf(q).toLocaleString()} ${esc(q.currency || '')}</td>
          <td>${toCNY(qtTotalOf(q), q.currency) != null ? fmtMoney(toCNY(qtTotalOf(q), q.currency)) : '—'}</td>
          <td><span class="stage st-${(q.status || '草稿').replace(/[^\w\u4e00-\u9fa5]/g, '')}">${esc(q.status || '草稿')}</span></td>
          <td>${esc(q.validUntil || '-')}</td>
          <td><button class="link-btn" data-qt-edit="${q.id}">查看</button></td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="muted">暂无报价单</div>'}
    </div>
    <div class="cd-section">
      <div class="cd-sec-t">📦 订单（${myOrders.length}）</div>
      ${ordersHtml}
    </div>
    <div class="cd-section">
      <div class="cd-sec-t">💬 询盘与沟通（${myInqs.length} 条）</div>
      ${myInqs.length ? myInqs.map(renderCommBlock).join('') : '<div class="muted">暂无沟通记录（可在「询盘管理」里给询盘填沟通记录）</div>'}
    </div>
    <div class="cd-section">
      <div class="cd-sec-t">👥 联系人（${window.getContactsByClient ? window.getContactsByClient(c.id).length : 0}）</div>
      <div id="cdContacts"></div>
    </div>
  `, { plain: true, wide: true, noFooter: true });
  const idx = clients.findIndex((x) => x.id === id);
  $('#cdNewInquiry').onclick = () => { closeModal(); setTimeout(() => { if (typeof openInqModal === 'function') openInqModal({ clientId: c.id, clientName: c.company, country: c.country, contactName: c.contactName, currency: 'USD', receivedAt: todayStr(), status: '新询盘' }); }, 260); };
  $('#cdNewTask').onclick = () => { closeModal(); setTimeout(() => switchView('tasks'), 260); };
  $('#cdNewComm').onclick = () => { closeModal(); setTimeout(() => { if (typeof openCommModal === 'function') openCommModal(); }, 260); };
  $('#cdSaveNotes').onclick = async () => {
    const v = $('#cdNotes').value;
    if (idx >= 0) clients[idx].notes = v;
    await api('/api/clients/' + id, { method: 'PUT', body: JSON.stringify({ notes: v }) });
    toast('印象已保存');
  };
  const waBtn = $('#cdWa');
  if (waBtn) waBtn.onclick = () => {
    if (window.waHasNumber && window.waHasNumber(c)) {
      window.waQuick({ record: c, clientId: c.id, isClient: true, company: c.company, contactName: c.contactName, country: c.country });
    } else {
      closeModal();
      setTimeout(() => { if (window.openWaModal) window.openWaModal({ record: c, clientId: c.id, isClient: true, company: c.company, contactName: c.contactName, country: c.country }); }, 260);
    }
  };
  const waEdit = $('#cdWaEdit');
  if (waEdit) waEdit.onclick = () => {
    closeModal();
    setTimeout(() => { if (window.openWaModal) window.openWaModal({ record: c, clientId: c.id, isClient: true, company: c.company, contactName: c.contactName, country: c.country }); }, 260);
  };
  $('#modalForm').querySelectorAll('[data-edit-o]').forEach((b) => b.addEventListener('click', () => {
    closeModal();
    openOrderModal(b.dataset.editO);
  }));
  $('#modalForm').querySelectorAll('[data-qt-edit]').forEach((b) => b.addEventListener('click', () => {
    closeModal();
    setTimeout(() => { if (typeof openQuoteModal === 'function') openQuoteModal(b.dataset.qtEdit); }, 260);
  }));
  const cdNewQuote = $('#cdNewQuote');
  if (cdNewQuote) cdNewQuote.onclick = () => {
    closeModal();
    setTimeout(() => { if (typeof openQuoteModal === 'function') openQuoteModal(null, { clientName: c.company, clientId: c.id, contactName: c.contactName }); }, 260);
  };
  // 渲染联系人区块（多联系人 / 多角色）
  const cdC = document.getElementById('cdContacts');
  if (cdC && window.renderContactsInto) window.renderContactsInto(c.id, cdC);
}

// 从客户档案发起 WhatsApp（带上公司/联系人/国家等变量，允许回存号码）
function openWaForClient(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return toast('客户不存在');
  // 一键直达：有号码直接打开 WhatsApp，弹窗改为「编辑」路径（见客户详情里的 ✏️ 编辑）
  if (window.waQuick) {
    return window.waQuick({
      record: c, clientId: c.id, isClient: true,
      company: c.company, contactName: c.contactName, country: c.country,
    });
  }
  if (!window.openWaModal) return toast('WhatsApp 模块未加载');
  window.openWaModal({
    record: c, clientId: c.id, isClient: true,
    company: c.company, contactName: c.contactName, country: c.country,
  });
}

// 按客户名打开详情（用于询盘看板 / 分级清单里点客户名）
function openClientDetailByName(name) {
  if (!name) return;
  const key = (name || '').trim().toLowerCase();
  const c = clients.find((x) => (x.company || '').trim().toLowerCase() === key);
  if (c) { openClientDetail(c.id); return; }
  // 没有正式客户档案：按名字聚合询盘/订单并展示，可一键建档
  const myOrders = orders.filter((o) => (o.clientName || '').trim().toLowerCase() === key);
  const myInqs = (window.getInquiriesByClient ? window.getInquiriesByClient(name) : [])
    .slice().sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  const ordersHtml = myOrders.length ? `<table class="cd-table">
      <thead><tr><th>订单号</th><th>金额</th><th>折合 CNY</th><th>状态</th><th>下单日期</th><th>交期</th></tr></thead>
      <tbody>${myOrders.map((o) => `<tr>
        <td>${esc(o.orderNo || '-')}</td>
        <td>${(Number(o.amount) || 0).toLocaleString()} ${esc(o.currency || '')}</td>
        <td>${toCNY(Number(o.amount) || 0, o.currency) != null ? fmtMoney(toCNY(Number(o.amount) || 0, o.currency)) : '—'}</td>
        <td><span class="stage st-${o.status || '待确认'}">${esc(o.status || '待确认')}</span></td>
        <td>${esc(o.orderDate || (o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : '-'))}</td>
        <td>${esc(o.deliveryDate || '-')}</td>
      </tr>`).join('')}</tbody>
    </table>` : '<div class="muted">暂无订单</div>';
  openModal(name + ' · 客户详情（未建档）', `
    <div class="cd-head">
      <div class="cd-name">${esc(name)}</div>
      <div class="cd-sub muted">（尚未建档为客户，可保存印象后自动建档）</div>
    </div>
    <div class="cd-grid">
      <div class="cd-info"><div class="cd-row"><span>来源</span><b>询盘客户</b></div></div>
      <div class="cd-impression">
        <label>我对他的印象 / 备注</label>
        <textarea id="cdNotes" rows="6" placeholder="记录你对这个客户的印象、偏好、关键人关系等…"></textarea>
        <button class="btn-mini" id="cdSaveNotes" type="button">💾 保存印象并建档</button>
      </div>
    </div>
    <div class="cd-section">
      <div class="cd-sec-t">📦 订单（${myOrders.length}）</div>
      ${ordersHtml}
    </div>
    <div class="cd-section">
      <div class="cd-sec-t">💬 询盘与沟通（${myInqs.length} 条）</div>
      ${myInqs.length ? myInqs.map(renderCommBlock).join('') : '<div class="muted">暂无沟通记录（可在「询盘管理」里给询盘填沟通记录）</div>'}
    </div>
  `, { plain: true, wide: true, noFooter: true });
  $('#cdSaveNotes').onclick = async () => {
    const v = $('#cdNotes').value;
    // 从关联询盘中提取已有信息，预填到新建客户（国家、联系人、跟进人、来源）
    const best = myInqs.find((iq) => iq.country || iq.contactName) || myInqs.find((iq) => iq.chatLog) || myInqs[0] || {};
    try {
      const r = await api('/api/clients', { method: 'POST', body: JSON.stringify({
        company: name, notes: v,
        country: best.country || '',
        contactName: best.contactName || '',
        contactEmail: best.contactEmail || '',
        contactPhone: best.contactPhone || '',
        source: best.source || '',
        owner: best.owner || '',
        ownerName: best.ownerName || '',
        nextFollowUp: '',
      }) });
      const saved = await r.json();
      clients.push(saved);
      loadAll(); // 立即刷新客户列表，切回客户资料页显示新记录
      toast('已建档并保存印象');
      openClientDetail(saved.id);
    } catch (e) { toast('建档失败：' + e.message); }
  };
}

// ================= 启动 / 登录 =================
window.openClientDetail = openClientDetail;
window.openClientDetailByName = openClientDetailByName;
window.userOrders = userOrders;
window.loadCalcIfReady = null;
boot();

async function boot() {
  // 关键：无论 /api/me 是否可达，先立即绑定登录表单，保证「登录」按钮永远可用，
  // 彻底避免「表单事件未绑定 → 点登录变原生提交 → 页面反复刷新 → 一直转圈/无响应」。
  showLogin();
  // 后台尝试恢复已有会话（已登录则直接进入，失败不影响登录表单可用性）
  try {
    const r = await api('/api/me', { timeout: 8000 });
    if (r && r.ok) {
      currentUser = await r.json();
      if (currentUser.token) localStorage.setItem('ftw_token', currentUser.token);
      applyRoleUI();
      // 会话有效时主动隐藏登录遮罩（遮罩默认可见，仅靠登录提交或此处隐藏）
      $('#loginOverlay').classList.add('hidden');
      window.__ftwNoticeUser = { id: currentUser.id };
      document.dispatchEvent(new Event('ftw:session-change'));
      // enterApp 任何模块异常都不应把用户踢回登录页
      try { await enterApp(); }
      catch (e) { console.error('enterApp 失败:', e); toast('部分模块加载异常，刷新页面可恢复'); }
    } else if (r) {
      // 服务端明确拒绝（401）才清除本地 token
      localStorage.removeItem('ftw_token');
    }
  } catch { /* /api/me 不可达：保留登录表单，用户手动登录即可 */ }
}

function showLogin(message = '') {
  window.__ftwNoticeUser = null;
  document.dispatchEvent(new Event('ftw:session-change'));
  $('#loginOverlay').classList.remove('hidden');
  if (message) $('#loginErr').textContent = message;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const username = $('#loginUser').value.trim();
    const password = $('#loginPwd').value;
    const btn = e.target.querySelector('button[type=submit]');
    const oldText = btn ? btn.textContent : '登 录';
    // 点击后立即禁用按钮并显示「登录中…」，确保用户明确感知点击已响应（告别「点了没反应」的错觉）
    if (btn) { btn.disabled = true; btn.textContent = '登录中…'; }
    $('#loginErr').textContent = '';
    // 提交前先丢弃旧 token：登录请求不该携带过期 Bearer，
    // 也避免本地残留干扰登录成功后的首次数据加载
    localStorage.removeItem('ftw_token');
    try {
      const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      if (r.ok) {
        currentUser = await r.json();
        if (currentUser.token) localStorage.setItem('ftw_token', currentUser.token);
        applyRoleUI();
        $('#loginOverlay').classList.add('hidden');
        window.__ftwNoticeUser = { id: currentUser.id };
        document.dispatchEvent(new Event('ftw:session-change'));
        // 登录成功进入应用（按钮保持禁用态即可，遮罩已隐藏）
        try { await enterApp(); }
        catch (err) { console.error('enterApp 失败:', err); toast('部分模块加载异常，已尽量展示，刷新页面可恢复'); }
      } else {
        const j = await r.json().catch(() => ({}));
        $('#loginErr').textContent = j.error || '登录失败（账号或密码错误）';
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    } catch (err) {
      // 网络不通 / 请求超时：给出明确提示，避免页面"一直转圈"无任何反馈
      $('#loginErr').textContent = (err && err.message === '请求超时')
        ? '登录请求超时：浏览器连不上接口，请确认直接用 http://localhost:4173 打开（勿用代理/书签/外网地址）'
        : '网络连接失败：请检查能否访问 NAS 工作台服务';
      if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
  };
}

const safe = (fn) => { try { if (fn) fn(); } catch (e) { console.error('module loader', e); } };

async function enterApp() {
  // 每个步骤独立容错：任一模块加载/渲染失败都绝不影响其它模块，也不会闪退回登录页
  try { await loadUsers(); } catch (e) { console.error('loadUsers', e); }
  try { renderUserBar(); } catch (e) { console.error('renderUserBar', e); }
  try { renderTimezones(); } catch (e) { console.error('renderTimezones', e); }
  setInterval(tickTimezones, 1000);
  try { loadRates(); } catch (e) { console.error('loadRates', e); }
  setInterval(() => { try { loadRates(false); } catch (e) { console.error('loadRates', e); } }, 10 * 60 * 1000);
  // 先拉取服务端保存的界面偏好（列顺序 / 列设置），再加载数据，保证首屏就是用户的列顺序
  try { await loadUiPrefs(); } catch (e) { console.error('loadUiPrefs', e); }
  loadAll().catch((e) => console.error('loadAll', e));
  safe(window.refreshInquiries);
  safe(window.loadSales);
  safe(window.loadEmails);
  safe(window.loadProducts);
  safe(window.loadShipments);
  safe(window.loadSuppliers);
  safe(window.loadFinance);
  safe(window.loadComms);
  safe(window.loadChatLogs);
  safe(window.loadMail);
  safe(window.loadQuotations);
  try { bindDashboardActions(); } catch (e) { console.error('bindDashboardActions', e); }
  try { initNavGroups(); } catch (e) { console.error('initNavGroups', e); }
  try { bindTopbar(); } catch (e) { console.error('bindTopbar', e); }
  // 按地址栏 hash 激活对应页面（支持刷新后停留在原页面 / 收藏直达）
  // 不预设 dashLastReload：这样落在首页时会真的重新拉一次数据，而不是只重绘内存里的旧数据
  dashLastReload = 0;
  activateView(location.hash.replace(/^#\/?/, '') || 'dashboard');
}

async function loadUsers() {
  try { const r = await api('/api/users'); allUsers = r.ok ? await r.json() : []; } catch { allUsers = []; }
  window.allUsers = allUsers;
}

function renderUserBar() {
  const el = $('#userBar');
  if (!el || !currentUser) return;
  el.innerHTML = `<div class="ub-user">👤 ${esc(currentUser.name || currentUser.username)}</div>
    <div class="ub-actions">
      <button id="ubUsers" class="ub-btn" title="添加 / 管理业务员账号">👥 用户管理</button>
      <button id="ubLogout" class="ub-btn" title="退出登录">退出</button>
    </div>`;
  $('#ubLogout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    currentUser = null; allUsers = [];
    window.__ftwNoticeUser = null;
    document.dispatchEvent(new Event('ftw:session-change'));
    localStorage.removeItem('ftw_token');
    location.reload();
  };
  $('#ubUsers').onclick = () => openUserMgmt();
}

// ===================== 用户管理 =====================
const UM_ROLE_LABEL = { admin: '管理员', manager: '经理', sales: '业务员' };
const UM_ROLE_BADGE = { admin: 'danger', manager: 'warn', sales: 'info' };
const UM_ROLE_DESC = {
  admin: '可见全部数据，可管理成员与查看操作日志',
  manager: '可查看、编辑和删除全员业务数据',
  sales: '仅可查看、编辑和删除本人业务数据',
};
const umRoleLabel = (r) => UM_ROLE_LABEL[r] || '业务员';

// 打开用户管理弹窗。keepOpen: 重绘后自动展开的面板 {id, mode}
function openUserMgmt(keepOpen) {
  const isAdmin = !!(currentUser && currentUser.role === 'admin');
  const weight = { admin: 0, manager: 1, sales: 2 };
  const users = (allUsers || []).slice().sort((a, b) =>
    (weight[a.role] ?? 2) - (weight[b.role] ?? 2) ||
    String(a.name || a.username).localeCompare(String(b.name || b.username), 'zh'));
  const nameOf = (id) => { const u = users.find((x) => x.id === id); return u ? (u.name || u.username) : '已删除的账号'; };
  const roleOpts = (cur) => ['sales', 'manager', 'admin']
    .map((r) => `<option value="${r}"${r === (cur || 'sales') ? ' selected' : ''}>${UM_ROLE_LABEL[r]}</option>`).join('');
  const mgrOpts = (excludeId, cur) => ['<option value="">— 未指定上级 —</option>']
    .concat(users.filter((u) => u.id !== excludeId && (u.role === 'admin' || u.role === 'manager'))
      .map((u) => `<option value="${esc(u.id)}"${u.id === cur ? ' selected' : ''}>${esc(u.name || u.username)}（${umRoleLabel(u.role)}）</option>`)).join('');

  const rows = users.map((u) => {
    const self = !!(currentUser && u.id === currentUser.id);
    const canEdit = isAdmin || self;
    const subs = users.filter((x) => x.managerId === u.id).length;
    const role = u.role || 'sales';
    const meta = [];
    if (role !== 'admin') meta.push(u.managerId ? `上级：${esc(nameOf(u.managerId))}` : '上级：未指定');
    if (subs) meta.push(`下属 ${subs} 人`);
    return `<div class="um-row${self ? ' is-self' : ''}" data-uid="${esc(u.id)}">
      <div class="um-main">
        <div class="um-ava r-${role}">${esc(String(u.name || u.username || '?').slice(0, 1).toUpperCase())}</div>
        <div class="um-info">
          <div class="um-l1">
            <span class="um-name">${esc(u.name || u.username)}</span>
            <span class="um-login">@${esc(u.username)}</span>
            ${self ? '<span class="um-you">本人</span>' : ''}
          </div>
          <div class="um-l2">
            <span class="badge ${UM_ROLE_BADGE[role] || 'info'}">${umRoleLabel(role)}</span>
            ${meta.map((m) => `<span class="um-meta">${m}</span>`).join('')}
          </div>
        </div>
        <div class="um-btns">
          ${canEdit ? `<button type="button" class="link-btn" data-um-tab="edit" data-id="${esc(u.id)}">编辑</button>` : ''}
          ${canEdit ? `<button type="button" class="link-btn" data-um-tab="pw" data-id="${esc(u.id)}">改密</button>` : ''}
          ${isAdmin && !self ? `<button type="button" class="link-btn danger" data-um-del="${esc(u.id)}">删除</button>` : ''}
        </div>
      </div>
      ${canEdit ? `<div class="um-panel" data-panel="edit" data-id="${esc(u.id)}" hidden>
        <div class="um-grid">
          <div class="field"><label>姓名</label><input data-f="name" value="${esc(u.name || '')}" placeholder="用于显示与归属" /></div>
          <div class="field"><label>登录名</label><input value="${esc(u.username)}" disabled title="登录名创建后不可修改" /></div>
          <div class="field"><label>角色</label>
            <select data-f="role"${isAdmin && !self ? '' : ' disabled'}>${roleOpts(role)}</select>
            <span class="um-hint" data-hint="role">${self ? '不能修改自己的角色，请由其他管理员操作' : (isAdmin ? UM_ROLE_DESC[role] : '仅管理员可调整角色')}</span>
          </div>
          <div class="field"><label>上级</label>
            <select data-f="managerId"${isAdmin && role !== 'admin' ? '' : ' disabled'}>${mgrOpts(u.id, u.managerId)}</select>
            <span class="um-hint" data-hint="mgr">${role === 'admin' ? '管理员看全部数据，无需上级' : '用于组织架构展示；经理可管理全员业务数据'}</span>
          </div>
        </div>
        <div class="um-foot">
          <button type="button" class="btn-ghost" data-um-cancel>取消</button>
          <button type="button" class="btn-primary" data-um-save="${esc(u.id)}">保存修改</button>
        </div>
      </div>` : ''}
      ${canEdit ? `<div class="um-panel" data-panel="pw" data-id="${esc(u.id)}" hidden>
        <div class="um-grid">
          <div class="field"><label>新密码</label><input data-f="pw1" type="password" autocomplete="new-password" placeholder="至少 4 位" /></div>
          <div class="field"><label>确认新密码</label><input data-f="pw2" type="password" autocomplete="new-password" placeholder="再输入一次" /></div>
        </div>
        <div class="um-foot">
          <span class="um-hint">${self ? '修改后当前登录不受影响，下次登录使用新密码。' : '重置后请线下通知本人，并提醒其首次登录后自行修改。'}</span>
          <button type="button" class="btn-ghost" data-um-cancel>取消</button>
          <button type="button" class="btn-primary" data-um-savepw="${esc(u.id)}">重置密码</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('') || '<div class="empty">暂无账号</div>';

  const stat = ['admin', 'manager', 'sales'].map((r) => {
    const n = users.filter((u) => (u.role || 'sales') === r).length;
    return n ? `${UM_ROLE_LABEL[r]} ${n}` : '';
  }).filter(Boolean).join(' · ');

  const addHtml = isAdmin ? `
    <div class="um-add">
      <button type="button" class="btn-ghost um-add-toggle" id="umAddToggle">＋ 新增成员</button>
      <div class="um-panel um-add-panel" id="umAddPanel" hidden>
        <div class="um-grid">
          <div class="field"><label>登录名 <b class="req">*</b></label><input id="umNewUser" placeholder="英文，如 pan" autocomplete="off" /></div>
          <div class="field"><label>姓名</label><input id="umNewName" placeholder="如 示例用户" autocomplete="off" /></div>
          <div class="field"><label>初始密码 <b class="req">*</b></label><input id="umNewPwd" type="text" placeholder="至少 4 位，可线下告知本人" autocomplete="off" /></div>
          <div class="field"><label>角色</label><select id="umNewRole">${roleOpts('sales')}</select></div>
          <div class="field um-span2"><label>上级</label><select id="umNewMgr">${mgrOpts(null, null)}</select>
            <span class="um-hint" id="umNewHint">${UM_ROLE_DESC.sales}</span></div>
        </div>
        <div class="um-foot">
          <button type="button" class="btn-ghost" id="umAddCancel">取消</button>
          <button type="button" class="btn-primary" id="umAdd">创建账号</button>
        </div>
      </div>
    </div>` : '';

  const drawn = new Set();
  const orgNode = (u) => {
    if (drawn.has(u.id)) return '';
    drawn.add(u.id);
    const children = users.filter(x => x.managerId === u.id && !drawn.has(x.id));
    return `<li><button type="button" class="um-node" data-um-person="${esc(u.id)}">
      <span class="um-ava r-${esc(u.role || 'sales')}">${esc(String(u.name || u.username).slice(0, 1))}</span>
      <span><strong>${esc(u.name || u.username)}</strong><small>${umRoleLabel(u.role)} · @${esc(u.username)}</small></span>
      </button>${children.length ? `<ul>${children.map(orgNode).join('')}</ul>` : ''}</li>`;
  };
  const roots = users.filter(u => !u.managerId || !users.some(x => x.id === u.managerId));
  let tree = roots.map(orgNode).join('');
  tree += users.filter(u => !drawn.has(u.id)).map(orgNode).join('');
  openModal('用户管理', `
    <div class="um-head">
      <span class="um-count">共 ${users.length} 名成员</span>
      ${stat ? `<span class="um-stat">${stat}</span>` : ''}
      ${isAdmin ? '' : '<span class="um-hint">你可以修改本人的姓名与密码；角色调整请联系管理员。</span>'}
    </div>
    <div class="um-toolbar"><div class="um-views" role="group" aria-label="成员显示方式">
      <button type="button" data-um-view="list" aria-pressed="true">列表</button>
      <button type="button" data-um-view="org" aria-pressed="false">组织架构</button>
    </div><input id="umSearch" type="search" placeholder="搜索姓名或账号" aria-label="搜索成员" /></div>
    <div class="um-policy">经理：全员业务可查看和编辑　·　业务员：仅本人业务　·　成员权限：管理员管理</div>
    <div class="um-list">${rows}</div>
    <div class="um-org" hidden><p class="um-hint">按已设置的上级关系展示；未指定上级的成员独立排列。点击成员查看详情。</p><ul>${tree}</ul></div>
    <div class="um-no-results" hidden>没有匹配的成员</div>
    ${addHtml}
  `, { noFooter: true, wide: true });

  const form = $('#modalForm');
  form.classList.add('um-layout');
  form.closest('.modal-box').classList.add('modal-box--users');
  const filterMembers = () => {
    const query = $('#umSearch').value.trim().toLowerCase();
    let count = 0;
    form.querySelectorAll('.um-row').forEach(row => {
      const u = users.find(x => x.id === row.dataset.uid);
      row.hidden = !!query && !`${u.name} ${u.username}`.toLowerCase().includes(query);
      if (!row.hidden) count++;
    });
    form.querySelector('.um-no-results').hidden = count > 0;
    form.querySelectorAll('.um-node').forEach(node => {
      const u = users.find(x => x.id === node.dataset.umPerson);
      node.classList.toggle('um-dim', !!query && !`${u.name} ${u.username}`.toLowerCase().includes(query));
    });
  };
  const switchView = view => {
    form.querySelector('.um-list').hidden = view !== 'list';
    form.querySelector('.um-org').hidden = view !== 'org';
    form.querySelectorAll('[data-um-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.umView === view)));
  };
  form.querySelectorAll('[data-um-view]').forEach(b => b.onclick = () => switchView(b.dataset.umView));
  $('#umSearch').oninput = filterMembers;
  form.querySelectorAll('[data-um-person]').forEach(b => b.onclick = () => {
    switchView('list'); $('#umSearch').value = ''; filterMembers();
    const row = [...form.querySelectorAll('.um-row')].find(x => x.dataset.uid === b.dataset.umPerson);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (isAdmin || b.dataset.umPerson === currentUser.id) openPanel(b.dataset.umPerson, 'edit');
  });
  const closeAll = () => form.querySelectorAll('.um-panel[data-panel]').forEach((p) => { p.hidden = true; });
  const openPanel = (id, mode) => {
    closeAll();
    const p = form.querySelector(`.um-panel[data-panel="${mode}"][data-id="${id}"]`);
    if (!p) return;
    p.hidden = false;
    const first = p.querySelector('input:not([disabled]),select:not([disabled])');
    if (first) first.focus();
  };

  form.querySelectorAll('[data-um-tab]').forEach((b) => {
    b.onclick = () => openPanel(b.dataset.id, b.dataset.umTab);
  });
  form.querySelectorAll('[data-um-cancel]').forEach((b) => {
    b.onclick = () => { const p = b.closest('.um-panel'); if (p) p.hidden = true; };
  });

  // 角色改为管理员时自动禁用上级选择
  form.querySelectorAll('.um-panel[data-panel="edit"]').forEach((p) => {
    const rs = p.querySelector('[data-f="role"]');
    const ms = p.querySelector('[data-f="managerId"]');
    if (!rs || !ms) return;
    rs.onchange = () => {
      const isAdm = rs.value === 'admin';
      ms.disabled = isAdm || !isAdmin;
      if (isAdm) ms.value = '';
      const h = p.querySelector('[data-hint="role"]');
      if (h) h.textContent = UM_ROLE_DESC[rs.value] || '';
      const hm = p.querySelector('[data-hint="mgr"]');
      if (hm) hm.textContent = isAdm ? '管理员看全部数据，无需上级' : '用于组织架构展示；经理可管理全员业务数据';
    };
  });

  // 保存资料（姓名 / 角色 / 上级）
  form.querySelectorAll('[data-um-save]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.umSave;
      const p = b.closest('.um-panel');
      const payload = { name: p.querySelector('[data-f="name"]').value.trim() };
      if (!payload.name) return toast('姓名不能为空');
      const rs = p.querySelector('[data-f="role"]');
      const ms = p.querySelector('[data-f="managerId"]');
      if (rs && !rs.disabled) payload.role = rs.value;
      if (ms && !ms.disabled) payload.managerId = ms.value || null;
      b.disabled = true;
      const r = await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify(payload) });
      b.disabled = false;
      if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || '保存失败'); }
      toast('已保存');
      await loadUsers();
      if (currentUser && id === currentUser.id) {
        // 改的是自己，同步顶栏与本地会话信息
        try { const me = await api('/api/me'); if (me.ok) { currentUser = await me.json(); renderUserBar(); applyRoleUI(); } } catch { /* ignore */ }
      }
      openUserMgmt();
    };
  });

  // 重置密码
  form.querySelectorAll('[data-um-savepw]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.umSavepw;
      const p = b.closest('.um-panel');
      const p1 = p.querySelector('[data-f="pw1"]').value;
      const p2 = p.querySelector('[data-f="pw2"]').value;
      if (!p1 || p1.length < 4) return toast('密码至少 4 位');
      if (p1 !== p2) return toast('两次输入的密码不一致');
      b.disabled = true;
      const r = await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ password: p1 }) });
      b.disabled = false;
      if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || '重置失败'); }
      toast('密码已更新');
      p.hidden = true;
      p.querySelector('[data-f="pw1"]').value = '';
      p.querySelector('[data-f="pw2"]').value = '';
    };
  });

  // 删除
  form.querySelectorAll('[data-um-del]').forEach((b) => {
    b.onclick = async () => {
      const u = users.find((x) => x.id === b.dataset.umDel) || {};
      const subs = users.filter((x) => x.managerId === b.dataset.umDel).length;
      const warn = subs ? `\n注意：该成员名下有 ${subs} 名下属，删除后他们的上级会被清空。` : '';
      if (!confirm(`确认删除账号「${u.name || u.username}」？\n其名下的客户/订单将保留，但会变成无归属。${warn}`)) return;
      const r = await api('/api/users/' + b.dataset.umDel, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || '删除失败'); }
      toast('已删除');
      await loadUsers();
      openUserMgmt();
    };
  });

  // 新增成员
  const tog = $('#umAddToggle');
  if (tog) {
    tog.onclick = () => {
      const panel = $('#umAddPanel');
      panel.hidden = !panel.hidden;
      tog.textContent = panel.hidden ? '＋ 新增成员' : '收起';
      if (!panel.hidden) $('#umNewUser').focus();
    };
    $('#umAddCancel').onclick = () => { $('#umAddPanel').hidden = true; tog.textContent = '＋ 新增成员'; };
    $('#umNewRole').onchange = () => {
      const v = $('#umNewRole').value;
      const m = $('#umNewMgr');
      m.disabled = v === 'admin';
      if (v === 'admin') m.value = '';
      $('#umNewHint').textContent = UM_ROLE_DESC[v] || '';
    };
    $('#umAdd').onclick = async () => {
      const username = $('#umNewUser').value.trim();
      const name = $('#umNewName').value.trim() || username;
      const password = $('#umNewPwd').value;
      const role = $('#umNewRole').value;
      const managerId = role === 'admin' ? null : ($('#umNewMgr').value || null);
      if (!username) return toast('登录名必填');
      if (!password || password.length < 4) return toast('初始密码至少 4 位');
      const r = await api('/api/users', { method: 'POST', body: JSON.stringify({ username, name, password, role, managerId }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || '添加失败'); }
      toast('账号已创建');
      await loadUsers();
      openUserMgmt();
    };
  }

  if (keepOpen && keepOpen.id) openPanel(keepOpen.id, keepOpen.mode || 'edit');
}

// ================= 通用表头排序（所有 table.data-table 自动生效） =================
(function initTableSort() {
  // 表头文本含这些词的列不参与排序（操作/批量按钮列）
  const SKIP_HEAD = ['操作', '选择'];
  // 表头含交互控件的列不参与排序（如全选 checkbox）
  const isSortableTh = (th) => {
    if (!th || th.querySelector('input,button,select')) return false;
    const t = (th.textContent || '').trim();
    return !!t && !SKIP_HEAD.some((s) => t.includes(s));
  };

  // 单元格值分类：单号 / 日期 / 数字（含 ¥、$, 千分位）/ 文本 / 空
  const cellValue = (td, isDocNo) => {
    const t = (td ? td.textContent || '' : '').trim();
    if (!t || t === '-') return { type: 'empty', v: '' };
    // 单号列：按尾部数字的后 6 位做数值比较，与列表默认排序一致
    if (isDocNo) {
      const k = docNoKey(t);
      if (k !== null) return { type: 'num', v: k };
    }
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t)) return { type: 'date', v: t.replace(/\//g, '-') };
    const num = parseFloat(t.replace(/[¥￥$,\s]/g, ''));
    if (!isNaN(num)) return { type: 'num', v: num };
    return { type: 'text', v: String(t).toLowerCase() };
  };

  const cmp = (a, b) => {
    if (a.type === 'empty' && b.type === 'empty') return 0;
    if (a.type === 'empty') return 1; // 空值永远排最后
    if (b.type === 'empty') return -1;
    if (a.type === 'num' && b.type === 'num') return a.v - b.v;
    if (a.type === 'date' && b.type === 'date') return a.v < b.v ? -1 : (a.v > b.v ? 1 : 0);
    if (a.type === 'text' && b.type === 'text') return a.v < b.v ? -1 : (a.v > b.v ? 1 : 0);
    return String(a.v).localeCompare(String(b.v), 'zh-Hans-CN');
  };

  // 按指定列和方向排序；dir: 'asc' | 'desc' | null（null = 清除排序）
  function applySort(table, th, dir) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = Array.from(tbody.rows).filter((r) => r.cells.length > 1 && !(r.cells[0].textContent || '').includes('暂无'));
    if (rows.length <= 1) return;
    const idx = Array.from(th.parentElement.children).indexOf(th);
    // 表头含「单号」的列按单号规则比较（与列表默认排序保持一致）
    const isDocNo = /单号/.test((th.textContent || '').trim());
    // 清除本表所有列的排序状态
    table.querySelectorAll('thead th[data-sort]').forEach((x) => { delete x.dataset.sort; x.classList.remove('sort-asc', 'sort-desc'); });
    if (!dir) return;
    th.dataset.sort = dir;
    th.classList.toggle('sort-asc', dir === 'asc');
    th.classList.toggle('sort-desc', dir === 'desc');
    // 首次排序记录原始行序（行内标记 si），供取消排序时还原
    if (!tbody.dataset.origOrder) {
      rows.forEach((r, i) => { if (r.dataset.si == null) r.dataset.si = i; });
      tbody.dataset.origOrder = '1';
    }
    const keyed = rows.map((r) => ({ r, si: Number(r.dataset.si) || 0, v: cellValue(r.cells[idx], isDocNo) }));
    keyed.sort((a, b) => {
      const c = cmp(a.v, b.v);
      if (c !== 0) return dir === 'asc' ? c : -c;
      return a.si - b.si; // 稳定：同值保持原相对顺序
    });
    // 关键：只有顺序真的变化才移动 DOM。
    // 否则每次 appendChild 都会触发 MutationObserver → reapply → 无限循环，
    // 导致行每 60ms 被挪动一次，用户点按钮的瞬间落点变了，click 不触发。
    let changed = keyed.length !== rows.length;
    if (!changed) {
      for (let i = 0; i < keyed.length; i++) {
        if (tbody.rows[i] !== keyed[i].r) { changed = true; break; }
      }
    }
    if (changed) keyed.forEach((k) => tbody.appendChild(k.r));
  }

  function onThClick(e) {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const table = th.closest('table.data-table');
    if (!table) return;
    const cur = th.dataset.sort;
    const next = cur === 'asc' ? 'desc' : (cur === 'desc' ? null : 'asc');
    applySort(table, th, next);
    if (!next) { // 恢复原始顺序
      const tbody = table.tBodies[0];
      if (tbody) {
        const rows = Array.from(tbody.rows);
        rows.forEach((r) => { if (r.dataset.si == null) r.dataset.si = 0; });
        rows.sort((a, b) => (Number(a.dataset.si) || 0) - (Number(b.dataset.si) || 0));
        // 同样：顺序没变就不动 DOM，避免触发 MutationObserver 循环
        let changed = false;
        for (let i = 0; i < rows.length; i++) {
          if (tbody.rows[i] !== rows[i]) { changed = true; break; }
        }
        if (changed) rows.forEach((r) => tbody.appendChild(r));
        delete tbody.dataset.origOrder;
      }
    }
  }

  function scan() {
    document.querySelectorAll('table.data-table thead th').forEach((th) => {
      if (isSortableTh(th)) th.classList.add('sortable');
      else th.classList.remove('sortable');
    });
  }

  // 渲染（tbody 被重写）后自动恢复当前排序列的状态，避免筛选/翻页后排序丢失
  let reapplyTimer = null;
  function reapply() {
    clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(() => {
      document.querySelectorAll('table.data-table').forEach((table) => {
        const active = table.querySelector('thead th[data-sort]');
        if (active && table.tBodies[0] && table.tBodies[0].rows.length) applySort(table, active, active.dataset.sort);
      });
    }, 60);
  }

  document.addEventListener('click', onThClick);
  scan();
  new MutationObserver((muts) => {
    let needScan = false, needReapply = false;
    for (const m of muts) {
      if (m.type !== 'childList') continue;
      if (m.target.nodeType === 1 && (m.target.matches && m.target.matches('table.data-table thead, table.data-table tbody'))) {
        if (m.target.matches('thead')) needScan = true;
        else needReapply = true;
      } else if (m.target.nodeType === 1 && m.target.closest && m.target.closest('table.data-table')) {
        needReapply = true;
      }
    }
    if (needScan) scan();
    if (needReapply) reapply();
  }).observe(document.body, { childList: true, subtree: true });
})();

// ================= 通用列设置（每个列表可自定义表头显隐 + 表头名称） =================
(function initTableCols() {
  const CFG_KEY = 'ftw_table_cols_v1';
  const SKIP_COLS = ['操作', '选择']; // 这些列不允许隐藏，避免功能丢失

  // 表格标识：优先 tbody id（clientBody / orderBody / inqListBody …），否则用 table 在 DOM 中的序号
  function tableKey(table) {
    const tb = table.tBodies[0];
    if (tb && tb.id) return tb.id;
    const all = Array.from(document.querySelectorAll('table.data-table'));
    return 'table_' + all.indexOf(table);
  }
  function loadCfg(key) {
    try {
      const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}')[key] || null;
      // Pre-key settings refer to the old 16 columns; adding owner must not shift them.
      if (key === 'clientBody' && cfg && (!cfg.hiddenKeys || !cfg.labelKeys)) {
        const oldKeys = ['check','star','name','contact','country','phase','grade','source','phone','prod','comm','health','ai','created','rel','ops'];
        const saved = JSON.parse(localStorage.getItem(CLIENT_COL_ORDER_KEY) || 'null');
        const middle = Array.isArray(saved) ? saved.filter(k => oldKeys.includes(k) && k !== 'check' && k !== 'ops') : oldKeys.slice(1,-1);
        oldKeys.slice(1,-1).forEach(k => { if (!middle.includes(k)) middle.push(k); });
        const keys = ['check', ...middle, 'ops'];
        if (!cfg.hiddenKeys) cfg.hiddenKeys = (cfg.hidden || []).map(i => keys[i]).filter(Boolean);
        if (!cfg.labelKeys) cfg.labelKeys = Object.fromEntries(Object.entries(cfg.labels || {}).map(([i,v]) => [keys[i],v]).filter(([k]) => k));
      }
      if (key === 'qtBody' && cfg && cfg.schemaVersion !== 2) {
        // Legacy keys referred to the pre-redesign fields, not today's positions.
        const legacy = ['quoteNo','clientName','projectName',null,'amount',null,'validUntil','status','owner','ops'];
        const keyOf = key => /^c\d+$/.test(String(key)) ? legacy[Number(String(key).slice(1))] : key;
        cfg.hiddenKeys = (cfg.hiddenKeys || (cfg.hidden || []).map(i => 'c'+i)).map(keyOf).filter(Boolean);
        cfg.labelKeys = Object.fromEntries(Object.entries(cfg.labelKeys || Object.fromEntries(Object.entries(cfg.labels || {}).map(([i,v])=>['c'+i,v]))).map(([k,v])=>[keyOf(k),v]).filter(([k])=>k));
        cfg.orderKeys = [...new Set((cfg.orderKeys || (cfg.order || []).map(i=>'c'+i)).map(keyOf).filter(Boolean))];
        delete cfg.hidden; delete cfg.labels; delete cfg.order;
        cfg.schemaVersion = 2;
      }
      if (key === 'orderBody' && cfg) {
        const oldKeys=Array.from({length:10},(_,i)=>'c'+i);
        if (!cfg.hiddenKeys) cfg.hiddenKeys=(cfg.hidden||[]).map(i=>oldKeys[i]).filter(Boolean);
        if (!cfg.labelKeys) cfg.labelKeys=Object.fromEntries(Object.entries(cfg.labels||{}).map(([i,v])=>[oldKeys[i],v]).filter(([k])=>k));
        if (!cfg.orderKeys && cfg.order) cfg.orderKeys=cfg.order.map(i=>oldKeys[i]).filter(Boolean);
      }
      if(key==='clientBody' && !cfg)return {hiddenKeys:['phone','prod','comm','health','ai','created','source'],labelKeys:{}};
      return cfg;
    } catch { return null; }
  }
  function saveCfg(key, cfg) {
    const all = {};
    try { Object.assign(all, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch {}
    all[key] = cfg;
    localStorage.setItem(CFG_KEY, JSON.stringify(all));
  }

  const isClientTable = (table) => !!(table.tBodies[0] && table.tBodies[0].id === 'clientBody');

  // 稳定列 key：首次扫描到某张表时（此刻表头必为默认顺序）给每个 th 打上 data-col。
  // 之后列顺序 / 显隐 / 改名一律按 key 记录，不再用「第几列」这种位置索引——
  // 位置索引在表格重绘（改数据、切筛选、新增记录）后会被反复套用，导致顺序来回跳、看起来像没保存。
  function colKeysOf(table) {
    if (!table.__colKeys || !table.__colKeys.length) {
      const ths = Array.from(table.querySelectorAll('thead th'));
      if (!ths.length) return [];
      table.__colKeys = ths.map((th, i) => th.dataset.col || ('c' + i));
      ths.forEach((th, i) => { if (!th.dataset.col) th.dataset.col = table.__colKeys[i]; th.dataset.defaultLabel = (th.textContent || '').trim(); });
    }
    return table.__colKeys;
  }

  // 隐藏判定：优先按 data-col key（列顺序调整后不会跟错列），无 key 的表退回索引
  function hiddenAt(cfg, ths, i) {
    if (!cfg) return false;
    if (cfg.hiddenKeys && ths[i] && ths[i].dataset.col) return cfg.hiddenKeys.includes(ths[i].dataset.col);
    return !!(cfg.hidden && cfg.hidden.includes(i));
  }
  function labelAt(cfg, ths, i) {
    if (!cfg) return '';
    if (cfg.labelKeys && ths[i] && ths[i].dataset.col) return cfg.labelKeys[ths[i].dataset.col] || '';
    return (cfg.labels && cfg.labels[i]) || '';
  }

  // 列顺序：一律返回「稳定列 key」数组（旧的位置索引配置会自动迁移成 key）
  function orderOf(table) {
    const keys = colKeysOf(table);
    if (!keys.length) return [];
    const cfg = loadCfg(tableKey(table)) || {};
    let saved = null;
    if (Array.isArray(cfg.orderKeys) && cfg.orderKeys.length) saved = cfg.orderKeys;
    else if (Array.isArray(cfg.order) && cfg.order.length) saved = cfg.order.map((i) => keys[Number(i)]).filter(Boolean);
    if (saved && saved.length) {
      const ord = [...new Set(saved.filter((k) => keys.includes(k)))];
      keys.forEach((k) => {
        if (ord.includes(k)) return;
        if (tableKey(table)==='orderBody' && k==='owner') ord.splice(Math.max(0,ord.indexOf('c2')+1),0,k);
        else ord.push(k);
      });
      return ord;
    }
    return keys.slice();
  }
  function applyTableOrder(table) {
    if (isClientTable(table)) return; // 客户表由 applyClientColOrder 负责，避免两套逻辑打架
    const tr = table.querySelector('thead tr');
    if (!tr) return;
    const ths = Array.from(tr.cells);
    if (ths.length < 2) return;
    colKeysOf(table);
    const order = orderOf(table);
    // Assign stable identities once, then move cells only when the desired order differs.
    function placeCells(row, fallbackKeys) {
      const cells = Array.from(row.cells);
      if (cells.length !== keys.length) return;
      cells.forEach((cell, i) => { if (!cell.dataset.col) cell.dataset.col = fallbackKeys[i]; });
      const byKey = new Map(cells.map(cell => [cell.dataset.col, cell]));
      const desired = order.map(key => byKey.get(key));
      if (desired.some(cell => !cell)) return;
      desired.forEach((cell, i) => { if (row.cells[i] !== cell) row.insertBefore(cell, row.cells[i] || null); });
    }
    const keys = colKeysOf(table);
    placeCells(tr, keys);
    const tb = table.tBodies[0];
    if (tb) Array.from(tb.rows).forEach(row => placeCells(row, keys));
  }

  // 应用列配置：隐藏列（th/td 加 col-hidden） + 替换表头名称 + 应用列顺序
  function applyCols(table) {
    applyTableOrder(table);
    const key = tableKey(table);
    const cfg = loadCfg(key);
    const ths = Array.from(table.querySelectorAll('thead th'));
    const tbody = table.tBodies[0];
    ths.forEach((th, i) => {
      // 表头名称（跳过含 checkbox 的列，避免破坏全选）
      const lab = labelAt(cfg, ths, i) || (key === 'qtBody' ? th.dataset.defaultLabel : '');
      if (lab && !th.querySelector('input')) {
        if (th.textContent.trim() !== String(lab).trim()) th.textContent = lab;
      }
      // 显隐
      const hidden = hiddenAt(cfg, ths, i);
      th.classList.toggle('col-hidden', hidden && !th.querySelector('input[type=checkbox]') && !['check','ops'].includes(th.dataset.col) && !SKIP_COLS.some((s) => (th.textContent || '').includes(s)));
    });
    if (tbody) {
      Array.from(tbody.rows).forEach((tr) => {
        Array.from(tr.cells).forEach((td, i) => {
          const th = ths[i];
          const skip = ['check','ops'].includes(td.dataset.col) || (th && (th.querySelector('input[type=checkbox]') || SKIP_COLS.some((s) => (th.textContent || '').includes(s))));
          // 显隐判定（v20260902d）：td 带稳定列 key（data-col）时按 key 匹配 hiddenKeys，
          // 与 thead 当前排序解耦 —— 否则 thead 已按自定义顺序重排、tbody 刚重绘还是默认
          // 顺序的瞬间，位置 i 会把 col-hidden 加到错位的列上（客户列表列错位根因）。
          let hidden;
          if (td.dataset.col && Array.isArray(cfg?.hiddenKeys)) hidden = cfg.hiddenKeys.includes(td.dataset.col);
          else hidden = hiddenAt(cfg, ths, i);
          td.classList.toggle('col-hidden', hidden && !skip);
        });
      });
    }
    // 客户列表：显隐变化后重建 colgroup（否则隐藏列之后的列宽整体错位，见 clSyncColgroupIfVisChanged）
    if (isClientTable(table)) { try { clSyncColgroupIfVisChanged(table); } catch (e) { console.warn('clSyncColgroupIfVisChanged', e); } }
  }

  // 保存配置：除客户表外，其它表同样把「第几列」翻译成稳定 key，
  // 这样调过列顺序之后再隐藏列 / 改表头名也不会跟错列；同时同步到服务端（同账号跨设备生效）
  function persistCfg(table, cfg) {
    const key = tableKey(table);
    const ths = Array.from(table.querySelectorAll('thead th'));
    colKeysOf(table);
    if (Array.isArray(cfg.hidden)) {
      cfg.hiddenKeys = cfg.hidden.map((i) => ths[i] && ths[i].dataset.col).filter(Boolean);
    }
    if (cfg.labels && typeof cfg.labels === 'object') {
      const lk = {};
      Object.keys(cfg.labels).forEach((i) => {
        const th = ths[Number(i)];
        if (th && th.dataset.col) lk[th.dataset.col] = cfg.labels[i];
      });
      cfg.labelKeys = lk;
    }
    if (Array.isArray(cfg.order)) {
      const ok = cfg.order.map((i) => ths[i] && ths[i].dataset.col).filter(Boolean);
      if (ok.length) { cfg.orderKeys = ok; delete cfg.order; }
    }
    saveCfg(key, cfg);
    try { saveUiPref({ tableCols: JSON.parse(localStorage.getItem('ftw_table_cols_v1') || '{}') }); } catch (e) {}
  }

  // 注入 ⚙ 按钮（每个 table-wrap 一个；客户资料页改用工具栏固定按钮，不注入）
  function injectBtn(table) {
    const wrap = table.closest('.table-wrap');
    if (!wrap || wrap.querySelector('.col-cfg-btn')) return;
    if (table.tBodies[0] && ['clientBody','orderBody'].includes(table.tBodies[0].id)) return;
    const btn = document.createElement('button');
    btn.className = 'col-cfg-btn';
    btn.title = '列设置：显示/隐藏列、自定义表头';
    btn.textContent = '⚙';
    btn.addEventListener('click', (e) => { e.stopPropagation(); openColCfg(table); });
    wrap.appendChild(btn);
  }

  // 供页面工具栏按钮调用（按 tbody id 定位表格）
  window.openColumnCfg = (tbodyId) => {
    const tb = document.getElementById(tbodyId);
    const table = tb && tb.closest('table');
    if (table) openColCfg(table);
  };

  // 读取面板当前输入（显隐 + 表头改名）
  function collectCfgFromPanel(ths) {
    const hidden = [];
    const labels = {};
    ths.forEach((th, i) => {
      const skip = !!th.querySelector('input[type=checkbox]') || ['check','ops'].includes(th.dataset.col) || SKIP_COLS.some((s) => (th.textContent || '').includes(s));
      const cb = document.getElementById('ccb_' + i);
      const inp = document.getElementById('cct_' + i);
      if (cb && !cb.checked && !skip) hidden.push(i);
      if (inp && !skip) {
        const v = inp.value.trim();
        if (v) labels[i] = v;
      }
    });
    return { hidden, labels };
  }

  // 上移 / 下移：立即保存并应用，随后重开面板刷新显示顺序
  function moveCol(table, ths, i, delta) {
    const to = i + delta;
    if (to < 0 || to >= ths.length) return;
    const key = tableKey(table);
    const base = loadCfg(key) || {};
    persistCfg(table, Object.assign({}, base, collectCfgFromPanel(ths))); // 先保住未保存的显隐/改名
    if (isClientTable(table)) {
      const colKey = ths[i].dataset.col;
      if (!colKey) return;
      const ord = (window.getClientColOrder ? window.getClientColOrder() : []).slice();
      const pos = ord.indexOf(colKey);
      const np = pos + delta;
      if (pos < 0 || np < 0 || np >= ord.length) return;
      ord.splice(pos, 1);
      ord.splice(np, 0, colKey);
      if (window.saveClientColOrder) window.saveClientColOrder(ord, false);
    } else {
      const cfg = loadCfg(key) || {};
      const ord = orderOf(table);
      const a = ord[i], b = ord[to];
      if (a === undefined || b === undefined) return;
      ord[i] = b; ord[to] = a;
      cfg.orderKeys = ord;
      delete cfg.order; // 旧的「按位置索引」配置作废，避免新旧两套并存互相打架
      persistCfg(table, cfg);
      applyTableOrder(table);
    }
    openColCfg(table);
  }

  function openColCfg(table) {
    const key = tableKey(table);
    const cfg = loadCfg(key) || {};
    const ths = Array.from(table.querySelectorAll('thead th'));
    const client = isClientTable(table);
    const rows = ths.map((th, i) => {
      const skip = !!th.querySelector('input[type=checkbox]') || ['check','ops'].includes(th.dataset.col) || SKIP_COLS.some(name => (th.textContent || '').includes(name));
      if (skip) return ''; // 固定选择/操作列不占用设置列表空间
      const label = (th.textContent || '').trim() || '选择';
      const canMoveTo = next => !skip && next >= 0 && next < ths.length && !ths[next].querySelector('input[type=checkbox]') && !['check','ops'].includes(ths[next].dataset.col) && !SKIP_COLS.some(name => (ths[next].textContent || '').includes(name));
      return `<div class="col-cfg-row" data-col-key="${esc(th.dataset.col || String(i))}">
        <label class="col-cfg-choice" for="ccb_${i}"><input type="checkbox" id="ccb_${i}" ${skip || !hiddenAt(cfg, ths, i) ? 'checked' : ''} ${skip ? 'disabled' : ''} /><span class="col-cfg-name" title="${esc(label)}">${esc(label)}</span></label>
        ${skip ? '<span class="col-cfg-fixed">固定</span>' : `<span class="col-cfg-mv"><button type="button" data-mv="-1" data-i="${i}" ${canMoveTo(i-1) ? '' : 'disabled'} aria-label="前移${esc(label)}" title="前移">↑</button><button type="button" data-mv="1" data-i="${i}" ${canMoveTo(i+1) ? '' : 'disabled'} aria-label="后移${esc(label)}" title="后移">↓</button></span>`}
        <input class="col-cfg-rename" type="text" id="cct_${i}" aria-label="${esc(label)}的显示名称" value="${esc(labelAt(cfg, ths, i) || label)}" ${skip ? 'disabled' : ''} />
      </div>`;
    }).join('');
    const tableName = client ? '客户列表' : tableKey(table) === 'orderBody' ? '订单列表' : '表格';
    openModal('列设置 · ' + tableName, `
      <div class="col-cfg-toolbar"><span class="col-cfg-summary">勾选显示 · 箭头调整顺序</span><button type="button" id="colRenameToggle" aria-pressed="false">修改列名</button></div>
      <div class="col-cfg-list col-cfg-compact">${rows}</div>
      <p class="col-cfg-hint">选择、操作列固定。顺序即时保存，其余点击「保存」。</p>
    `, { plain: true });
    document.querySelector('#modal .modal-box').classList.add('modal-box--columns');
    document.getElementById('colRenameToggle').onclick = event => {
      const list = document.querySelector('.col-cfg-compact');
      const expanded = list.classList.toggle('col-cfg-edit-labels');
      event.currentTarget.setAttribute('aria-pressed', String(expanded));
      event.currentTarget.textContent = expanded ? '收起列名' : '修改列名';
    };
    // openModal 会清空 modalForm，绑定提交
    $('#modalForm').onsubmit = (e) => { e.preventDefault(); saveCols(); };
    const list = document.querySelector('.col-cfg-list');
    if (list) {
      list.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        moveCol(table, ths, Number(b.dataset.i), Number(b.dataset.mv));
      }));
    }
    function saveCols() {
      persistCfg(table, Object.assign({}, cfg, collectCfgFromPanel(ths)));
      applyCols(table);
      toast('列设置已保存');
      closeModal();
    }
    // 底部按钮
    const foot = document.getElementById('modalFoot');
    if (foot) {
      foot.innerHTML = '<button type="button" class="btn-ghost" id="colReset">恢复默认</button>' +
        '<button type="button" class="btn-ghost" id="colCancel">取消</button>' +
        '<button type="button" class="btn-save" id="colSave">保存</button>';
      document.getElementById('colReset').onclick = () => {
        const all = {};
        try { Object.assign(all, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch {}
        delete all[key];
        ths.forEach(th => { if (!th.querySelector('input') && th.dataset.defaultLabel != null) th.textContent = th.dataset.defaultLabel; });
        localStorage.setItem(CFG_KEY, JSON.stringify(all));
        // 客户表：同时清掉列顺序（本地 + 服务端），否则表头顺序不会被重置
        if (isClientTable(table)) {
          try { localStorage.removeItem('ftw_client_col_order'); } catch (e) {}
          if (typeof saveUiPref === 'function') saveUiPref({ clientColOrder: null });
          if (typeof applyClientColOrder === 'function') applyClientColOrder();
        }
        try { saveUiPref({ tableCols: all }); } catch (e) {}
        applyCols(table);
        toast('已恢复默认列'); closeModal();
      };
      document.getElementById('colCancel').onclick = closeModal;
      document.getElementById('colSave').onclick = saveCols;
    }
  }

  function scanAll() {
    document.querySelectorAll('table.data-table').forEach((t) => { injectBtn(t); applyCols(t); });
  }
  scanAll();
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scanAll, 120);
  }).observe(document.body, { childList: true, subtree: true });
})();



// Order read-only view; editing and customer registration are explicit actions.
function orderLinkedClient(o) {
  const idHit = o.clientId && clients.find(c => String(c.id) === String(o.clientId));
  if (idHit) return idHit;
  const name = String(o.clientName || '').trim().toLowerCase();
  const matches = name ? clients.filter(c => String(c.company || '').trim().toLowerCase() === name) : [];
  return matches.length === 1 ? matches[0] : null;
}
function openOrderDetail(id) {
  if(!orders.some(o=>String(o.id)===String(id)))return toast('订单已不存在，请刷新列表');
  closeModal();window.salesSelectedOrder=String(id);salesOrderTab='overview';switchView('order-detail?id='+encodeURIComponent(id));
}

function registerOrderClient(id) {
  const o=orders.find(x=>String(x.id)===String(id));if(!o)return toast('订单已不存在');
  const linked=orderLinkedClient(o);if(linked)return openClientDetail(linked.id);
  const prefill={company:o.clientName||'',country:o.country||'',contactName:o.contactName||'',contactEmail:o.contactEmail||'',contactPhone:o.contactPhone||'',source:o.source||'',stage:'C',owner:o.owner||'',notes:'由订单 '+(o.orderNo||'')+' 补充客户档案'};
  openClientModal(null,prefill,async saved=>{
    if(!clients.some(c=>c.id===saved.id))clients.push(saved);
    try {
      const r=await api('/api/orders/'+encodeURIComponent(o.id),{method:'PUT',body:JSON.stringify({clientId:saved.id,clientName:saved.company})});
      if(!r.ok)throw Error('关联失败');
      o.clientId=saved.id;o.clientName=saved.company;
      toast('客户已建档，并已关联该订单');
    } catch { toast('客户已建档，但订单关联失败；请在编辑订单中重新选择客户'); }
    renderOrders();openOrderDetail(o.id);
  });
}

async function orderItemsReady(){
  try {const r=await api('/api/order-capabilities');const data=r.ok?await r.json():{};if(data.items===true)return true;}catch{}
  toast('产品明细保存功能等待 CRM 服务重启，请先保留当前填写内容');return false;
}
function orderItemSource(o){
  if(Array.isArray(o.items))return o.items;
  const q=window.getAllQuotations?.().find(q=>q.id===o.quoteId);
  return Array.isArray(q?.items)?q.items:[];
}
function normalizedOrderItems(o){return orderItemSource(o).map(it=>({...it,name:it.name||it.productName||it.product||'',description:it.description||it.desc||it.parameters||'',qty:it.qty==null?'':Number(it.qty),unit:it.unit||'SET',unitPrice:it.unitPrice==null?'':Number(it.unitPrice)}));}
function orderItemAmount(it){return it.lineAmount!=null && it.lineAmount!=='' ? Number(it.lineAmount) : Math.round(Number(it.qty)*Number(it.unitPrice)*100)/100;}
function orderItemsDetail(o){
  const items=normalizedOrderItems(o);if(!items.length)return '<section class="order-detail-notes"><h3>产品明细</h3><p class="muted">此订单尚未登记产品明细，可在编辑订单中补充。</p></section>';
  const total=items.reduce((s,it)=>s+orderItemAmount(it),0);
  return `<section class="order-detail-notes"><h3>产品明细</h3>${!Array.isArray(o.items)?'<p class="muted">以下来自关联报价，保存订单后保留独立明细。</p>':''}<div class="oi-detail-table"><table><thead><tr><th>产品 / 规格</th><th>数量</th><th>单位</th><th>单价</th><th>小计</th></tr></thead><tbody>${items.map(it=>`<tr><td><b>${esc(it.name)}</b><div class="oi-description">${esc(it.description)}</div></td><td>${esc(it.qty)}</td><td>${esc(it.unit)}</td><td>${it.unitPrice.toLocaleString('zh-CN',{minimumFractionDigits:2})}</td><td>${orderItemAmount(it).toLocaleString('zh-CN',{minimumFractionDigits:2})}</td></tr>`).join('')}</tbody></table></div><p>明细合计：${total.toLocaleString('zh-CN',{minimumFractionDigits:2})} ${esc(o.currency||'')}</p></section>`;
}
function bindOrderItems(o){
  let items=normalizedOrderItems(o);const wrap=$('#oiRows');
  function read(){return [...wrap.querySelectorAll('.oi-row')].map((row,i)=>{const it={...items[i]};row.querySelectorAll('[data-oi]').forEach(el=>{it[el.dataset.oi]=el.dataset.oi==='lineAmount'?(el.value===''?null:Number(el.value)):['qty','unitPrice'].includes(el.dataset.oi)?(el.value===''?NaN:Number(el.value)):el.value;});return it;});}
  function total(){const value=read().reduce((s,it)=>s+(orderItemAmount(it)||0),0);$('#oiTotal').textContent='明细合计：'+value.toLocaleString('zh-CN',{minimumFractionDigits:2})+' '+($('#modalForm [name="currency"]').value||'');return value;}
  function draw(){wrap.innerHTML=items.map((it,i)=>`<div class="oi-row"><label class="oi-wide">产品名称 *<input data-oi="name" value="${esc(it.name)}" required /></label><label>数量 *<input type="number" min="0.000001" step="any" data-oi="qty" value="${it.qty}" required /></label><label>单位<input data-oi="unit" value="${esc(it.unit)}" /></label><label>单价 *<input type="number" min="0" step="any" data-oi="unitPrice" value="${it.unitPrice}" required /></label><label>金额（可微调）<input type="number" min="0" step="0.01" data-oi="lineAmount" value="${it.lineAmount??''}" placeholder="${orderItemAmount({...it,lineAmount:null})||0}" /><small>留空按数量 × 单价计算</small></label><label class="oi-wide">规格 / 描述<textarea data-oi="description" rows="2">${esc(it.description)}</textarea></label><button type="button" class="btn-mini oi-remove" data-index="${i}">删除此产品</button></div>`).join('')||'<p class="muted">暂无产品明细，点击“添加产品”录入。</p>';wrap.querySelectorAll('.oi-remove').forEach(b=>b.onclick=()=>{items=read();items.splice(Number(b.dataset.index),1);draw();});total();}
  wrap.addEventListener('input',()=>{wrap.querySelectorAll('.oi-row').forEach((row,i)=>{row.querySelector('[data-oi=lineAmount]').placeholder=orderItemAmount({...read()[i],lineAmount:null})||0;});total();});$('#oiAdd').onclick=()=>{items=read();items.push({name:'',description:'',qty:1,unit:'SET',unitPrice:0});draw();};$('#oiUseTotal').onclick=()=>{$('#modalForm [name="amount"]').value=total().toFixed(2);};$('#modalForm [name="currency"]').addEventListener('change',total);draw();return read;
}

["ftw:quotationsChanged","ftw:inquiriesChanged","ftw:dataReady"].forEach(name=>window.addEventListener(name,()=>{if(document.querySelector("#view-client-detail.active"))renderClientDetailAll();}));
