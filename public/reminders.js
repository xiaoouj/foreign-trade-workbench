// ====== 跟进提醒中心（融合 GoodJob：跟进提醒） ======
// 后端在 /api/reminders/scan 派生扫描任务/询盘/报价/财务生成提醒（规则 R1-R5），
// 这里只做展示与已读。铃声徽标挂到顶栏 #tbBell。
const REM_RULE_CN = { R1: '任务', R2: '询盘', R3: '报价', R5: '回款' };
const REM_TYPE_ICON = { task: '☑', inquiry: '✉️', quotation: '📄', finance: '💰' };
const REM_TYPE_VIEW = { task: 'tasks', inquiry: 'enquiry', quotation: 'quotations', finance: 'finance' };

let remItems = [];
let remFilter = { level: '', type: '' };
let systemItems = [], remTab = 'follow', systemFilter = '', systemError = '', remEpoch = 0;
const reminderUserId = () => window.__ftwNoticeUser?.id || '';
let remRefreshBusy = null, followRequest = 0;

// Badge polling is optional and must not show network toasts or alter the login state.
async function reminderGet(path) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const token = localStorage.getItem('ftw_token');
    return await fetch(path, { headers: token ? { Authorization: 'Bearer ' + token } : {}, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
  } finally { clearTimeout(timer); }
}
async function scanReminders() {
  try {
    const uid = reminderUserId(), epoch = remEpoch, request = ++followRequest;
    if (!uid) return { items: [], unread: 0 };
    const r = await reminderGet('/api/reminders/scan');
    if (!r.ok) return { items: [], unread: 0 };
    const data = await r.json();
    if (uid !== reminderUserId() || epoch !== remEpoch || request !== followRequest) return { items: [], unread: 0 };
    remItems = Array.isArray(data.items) ? data.items : [];
    return data;
  } catch (e) { console.error('scanReminders', e); return { items: [], unread: 0 }; }
}

async function loadSystemNotices() {
  const uid = reminderUserId(), epoch = remEpoch;
  if (!uid) return;
  try {
    const r = await reminderGet('/api/system-notices');
    if (!r.ok) throw new Error('系统提醒暂时无法加载，请重试');
    const data = await r.json();
    if (uid !== reminderUserId() || epoch !== remEpoch || data.userId !== uid) return;
    systemItems = Array.isArray(data.items) ? data.items : [];
    systemError = '';
  } catch (e) { if (uid === reminderUserId() && epoch === remEpoch) systemError = ehR(e); }
}
function renderReminderBadge() {
  const follow = remItems.length, system = systemItems.filter(x => !x.read).length;
  const badge = document.getElementById('bellBadge');
  if (badge) { badge.textContent = follow + system; badge.classList.toggle('hidden', follow + system === 0); }
  const bell = document.getElementById('tbBell');
  if (bell) bell.title = `提醒中心：${follow} 条跟进提醒，${system} 条未读系统提醒`;
  const fc = document.getElementById('remFollowCount'), sc = document.getElementById('remSystemCount');
  if (fc) fc.textContent = follow;
  if (sc) sc.textContent = system;
}
async function refreshReminderBadge(force = false) {
  if (!reminderUserId()) return;
  if (remRefreshBusy) {
    if (!force) return remRefreshBusy;
    await remRefreshBusy;
    return refreshReminderBadge();
  }
  const epoch = remEpoch;
  const pending = Promise.all([scanReminders(), loadSystemNotices()]).then(() => {
    if (epoch === remEpoch) { renderReminderBadge(); renderSystemList(); }
  }).finally(() => { if (remRefreshBusy === pending) remRefreshBusy = null; });
  remRefreshBusy = pending;
  return pending;
}
window.refreshReminderBadge = refreshReminderBadge;

async function readSystemNotice(id) {
  const uid = reminderUserId(), epoch = remEpoch;
  const item = systemItems.find(x => x.id === id);
  if (!uid || !item || item.read) return;
  try {
    const r = await api('/api/system-notices/read', { method: 'POST', body: JSON.stringify({ id, userId: uid }) });
    if (!r.ok) throw new Error('已读状态保存失败，请重试');
    if (uid !== reminderUserId() || epoch !== remEpoch) return;
    item.read = true; renderReminderBadge();
    // Preserve expanded text and keyboard focus while updating the status.
    const node = [...document.querySelectorAll('[data-system-id]')].find(x => x.dataset.systemId === id);
    if (node) { node.classList.remove('is-unread'); const status = node.querySelector('.system-read-state'); if (status) status.textContent = '已读'; const button = node.querySelector('[data-system-read]'); if (button) button.hidden = true; }
    document.dispatchEvent(new CustomEvent('ftw:notifications-changed', { detail: { userId: uid, id } }));
  } catch (e) { toast(ehR(e)); }
}
function renderSystemList() {
  const wrap = document.getElementById('systemNoticeList');
  if (!wrap) return;
  const opened = new Set([...wrap.querySelectorAll('details[open]')].map(x => x.dataset.systemId));
  const list = systemItems.filter(x => !systemFilter || x.kind === systemFilter);
  const error = systemError ? `<div class="system-error" role="status">${esc(systemError)}</div>` : '';
  wrap.innerHTML = error + (list.length ? list.map(it => `<details class="system-notice ${it.read ? '' : 'is-unread'}" data-system-id="${esc(it.id)}" ${opened.has(it.id) ? 'open' : ''}>
    <summary><span class="system-kind">${it.kind === 'update' ? '版本更新' : '系统通知'}</span><span class="system-summary"><strong>${esc(it.title)}</strong><small>${esc(it.date || new Date(it.createdAt).toLocaleDateString('zh-CN'))}${it.authorName ? ' · ' + esc(it.authorName) : ''}</small></span><span class="system-read-state">${it.read ? '已读' : '未读'}</span></summary>
    <div class="system-notice-content">${(it.items || []).map(line => `<p>${esc(line)}</p>`).join('')}<button type="button" class="btn-ghost btn-mini" data-system-read="${esc(it.id)}">标为已读</button></div>
  </details>`).join('') : (systemError ? '' : '<div class="empty">暂无系统提醒。更新说明和系统通知会保留在这里，已读后也可复看。</div>'));
  wrap.querySelectorAll('details').forEach(node => node.addEventListener('toggle', () => { if (node.open && node.isConnected) void readSystemNotice(node.dataset.systemId); }));
  wrap.querySelectorAll('[data-system-read]').forEach(button => { button.hidden = !!systemItems.find(x => x.id === button.dataset.systemRead)?.read; button.onclick = () => readSystemNotice(button.dataset.systemRead); });
  const count = document.getElementById('systemArchiveCount'); if (count) count.textContent = systemItems.length;
}
function selectReminderTab(tab) {
  remTab = tab;
  document.querySelectorAll('[data-rem-tab]').forEach(button => { button.setAttribute('aria-selected', String(button.dataset.remTab === tab)); button.tabIndex = button.dataset.remTab === tab ? 0 : -1; });
  const follow = document.getElementById('remFollowPanel'), system = document.getElementById('remSystemPanel');
  if (follow) follow.hidden = tab !== 'follow';
  if (system) system.hidden = tab !== 'system';
}
function publishSystemNotice() {
  const uid = reminderUserId();
  openModal('发布系统通知', '<div class="field full"><label>标题</label><input name="title" required maxlength="120" placeholder="例如：周末维护安排" /></div><div class="field full"><label>通知内容</label><textarea name="content" required maxlength="8000" rows="7"></textarea></div><p class="muted">发布后，所有成员都能在系统提醒中查看。</p>');
  const submit = document.querySelector('#modalFoot [type="submit"]'); if (submit) submit.textContent = '发布通知';
  document.getElementById('modalForm').onsubmit = async event => {
    event.preventDefault(); if (uid !== reminderUserId()) return toast('账号已变化，请重新打开发布窗口');
    const data = new FormData(event.target); if (submit) submit.disabled = true;
    try {
      const r = await api('/api/system-notices', { method: 'POST', body: JSON.stringify({ title: data.get('title'), content: data.get('content') }) });
      if (!r.ok) throw new Error((await r.json()).error || '发布失败');
      closeModal(); toast('系统通知已发布'); await refreshReminderBadge(true); selectReminderTab('system');
    } catch (e) { toast(ehR(e)); } finally { if (submit) submit.disabled = false; }
  };
}

async function dismissReminder(key) {
  try {
    const r = await api('/api/notifications/dismiss', { method: 'POST', body: JSON.stringify({ key }) });
    if (!r.ok) throw new Error('操作失败');
    followRequest++;
    remItems = remItems.filter((x) => x.key !== key);
    renderReminderList();
    refreshReminderBadge();
  } catch (e) { toast('处理失败：' + ehR(e)); }
}
const ehR = (e) => (e && e.message) || '网络错误';

function remListHtml() {
  const list = remItems.filter((x) => {
    if (remFilter.level && x.level !== remFilter.level) return false;
    if (remFilter.type && x.refType !== remFilter.type) return false;
    return true;
  });
  if (!list.length) return '<div class="empty">✅ 全部已跟进，暂无待办提醒</div>';
  return list.map((it) => `
    <div class="rem-item ${it.level}">
      <div class="ri-ic">${REM_TYPE_ICON[it.refType] || '📌'}</div>
      <div class="ri-body">
        <div class="ri-title">${esc(it.text)}</div>
        <div class="ri-meta">${REM_RULE_CN[it.rule] || it.rule} · ${esc(it.date || '—')}</div>
      </div>
      <div class="ri-actions">
        <button class="btn-ghost btn-mini" data-go="${REM_TYPE_VIEW[it.refType] || ''}">去处理</button>
        <button class="btn-ghost btn-mini" data-dismiss="${esc(it.key)}">忽略</button>
      </div>
    </div>`).join('');
}

function renderReminderList() {
  const wrap = document.getElementById('remList');
  if (!wrap) return;
  wrap.innerHTML = remListHtml();
  wrap.querySelectorAll('[data-dismiss]').forEach((b) => b.onclick = () => dismissReminder(b.dataset.dismiss));
  wrap.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { if (b.dataset.go) switchView(b.dataset.go); });
  const cnt = document.getElementById('remCount'); if (cnt) cnt.textContent = remItems.length;
}

async function renderReminders() {
  const sec = document.getElementById('view-reminders');
  if (!sec) return;
  sec.innerHTML = `
    <div class="view-head"><h2>提醒中心</h2><span class="muted">跟进待办与系统消息，集中查看</span></div>
    <div class="rem-tabs" role="tablist" aria-label="提醒分类"><button type="button" role="tab" id="remFollowTab" aria-controls="remFollowPanel" data-rem-tab="follow">跟进提醒 <span id="remFollowCount">0</span></button><button type="button" role="tab" id="remSystemTab" aria-controls="remSystemPanel" data-rem-tab="system">系统提醒 <span id="remSystemCount">0</span></button></div>
    <div id="remFollowPanel" role="tabpanel" aria-labelledby="remFollowTab">
    <p class="muted rem-panel-hint">自动扫描任务、询盘、报价和回款，按需跟进不遗漏</p>
    <div class="rem-toolbar">
      <label>优先级 <select id="remLevel">
        <option value="">全部</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option>
      </select></label>
      <label>类型 <select id="remType">
        <option value="">全部</option><option value="task">任务</option><option value="inquiry">询盘</option>
        <option value="quotation">报价</option><option value="finance">回款</option>
      </select></label>
      <button class="btn-primary" id="remRefresh">刷新</button>
      <span class="muted">共 <b id="remCount">0</b> 条待处理</span>
    </div>
    <div id="remList" class="rem-list"></div></div>
    <div id="remSystemPanel" role="tabpanel" aria-labelledby="remSystemTab" hidden>
      <div class="rem-toolbar"><label>类型 <select id="systemNoticeType"><option value="">全部</option><option value="update">版本更新</option><option value="system">系统通知</option></select></label><button type="button" class="btn-primary" id="systemRefresh">刷新</button><span class="muted">共 <b id="systemArchiveCount">0</b> 条记录 · 已读内容可随时复看</span>${currentUser?.role === 'admin' ? '<button type="button" class="btn-ghost" id="systemPublish">发布通知</button>' : ''}</div>
      <div id="systemNoticeList" class="system-notice-list"><div class="empty">加载中…</div></div>
    </div>`;
  sec.querySelectorAll('[data-rem-tab]').forEach(button => {
    button.onclick = () => selectReminderTab(button.dataset.remTab);
    button.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const tab = event.key === 'Home' ? 'follow' : event.key === 'End' ? 'system' : remTab === 'follow' ? 'system' : 'follow'; selectReminderTab(tab); sec.querySelector(`[data-rem-tab="${tab}"]`).focus(); } };
  });
  selectReminderTab(remTab);
  const sf = document.getElementById('systemNoticeType'); sf.value = systemFilter; sf.onchange = () => { systemFilter = sf.value; renderSystemList(); };
  document.getElementById('systemRefresh').onclick = async () => { await loadSystemNotices(); renderSystemList(); renderReminderBadge(); };
  const publish = document.getElementById('systemPublish'); if (publish) publish.onclick = publishSystemNotice;
  const lv = document.getElementById('remLevel'); lv.value = remFilter.level; lv.onchange = () => { remFilter.level = lv.value; renderReminderList(); };
  const ty = document.getElementById('remType'); ty.value = remFilter.type; ty.onchange = () => { remFilter.type = ty.value; renderReminderList(); };
  document.getElementById('remRefresh').onclick = async () => { sec.querySelector('#remList').innerHTML = '<div class="empty">扫描中…</div>'; await scanReminders(); renderReminderList(); refreshReminderBadge(); toast('已刷新提醒'); };
  sec.querySelector('#remList').innerHTML = '<div class="empty">扫描中…</div>';
  await refreshReminderBadge(true);
  renderReminderList();
  renderSystemList();
}

// 接入视图激活钩子（链式包装，不覆盖其他模块）
window.onViewActivated = (function (orig) {
  return function (view) {
    if (typeof orig === 'function') orig(view);
    if (view === 'reminders') renderReminders();
  };
})(window.onViewActivated);

// 顶栏铃铛：点击进入提醒中心；页面加载后取一次徽标
document.addEventListener('DOMContentLoaded', () => {
  const bell = document.getElementById('tbBell');
  if (bell) bell.addEventListener('click', () => switchView('reminders'));
  refreshReminderBadge();
});
document.addEventListener('ftw:notifications-changed', () => { void refreshReminderBadge(true); });
document.addEventListener('ftw:session-change', () => {
  remEpoch++; remRefreshBusy = null; remItems = []; systemItems = []; systemError = ''; remTab = 'follow';
  remFilter = { level: '', type: '' }; systemFilter = '';
  renderReminderBadge();
  const sec = document.getElementById('view-reminders'); if (sec) sec.replaceChildren();
  if (reminderUserId()) void refreshReminderBadge();
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshReminderBadge(); });
setInterval(() => { if (!document.hidden) void refreshReminderBadge(); }, 60000);
