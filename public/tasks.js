// ====== 任务与日历模块 ======
// 统一承接原先散落在客户/询盘上的「下次跟进」跟进计划，形成可筛选、可日历化、
// 可逾期提醒的活动（Activities）实体。RBAC 与服务端一致：owner=创建人，
// 经理可见团队、管理员可见全部、业务员仅看自己。
const TASK_TYPES = ['待办', '电话', '会议', '邮件', '其他'];
const TASK_TYPE_ICON = { 待办: '☑', 电话: '📞', 会议: '📅', 邮件: '✉️', 其他: '📝' };
const TASK_STATUSES = ['待办', '进行中', '已完成', '已取消'];
const TASK_PRIORITIES = ['高', '中', '低'];

let tasks = [];
let taskFilter = { status: 'open', type: '', mine: true };
let taskSubtab = 'list';
let calCursor = new Date();

const getAllTasks = () => tasks;
window.getAllTasks = getAllTasks;

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const isOpen = (t) => t.status !== '已完成' && t.status !== '已取消';
const isOverdue = (t) => isOpen(t) && !!t.dueDate && t.dueDate < todayStr();
const isToday = (t) => isOpen(t) && !!t.dueDate && t.dueDate === todayStr();

async function loadTasks() {
  try {
    const r = await api('/api/tasks');
    if (r.ok) tasks = await r.json();
  } catch (e) { console.error('loadTasks', e); }
  return tasks;
}

// ---------- 仪表盘统计（今日 / 逾期，按当前登录人） ----------
function renderTaskStats() {
  const my = currentUser ? tasks.filter((t) => t.owner === currentUser.id) : tasks;
  const e1 = $('#statTasksToday'); if (e1) e1.textContent = my.filter(isToday).length;
  const e2 = $('#statTasksOverdue'); if (e2) e2.textContent = my.filter(isOverdue).length;
}
window.renderTaskStats = renderTaskStats;

function readTaskFilters() {
  const tf = $('#taskTypeFilter'); if (tf) taskFilter.type = tf.value;
  const mo = $('#taskMineOnly'); if (mo) taskFilter.mine = mo.checked;
}

// ---------- 列表视图 ----------
function taskRowHtml(t) {
  const overdue = isOverdue(t);
  const done = t.status === '已完成';
  const cancelled = t.status === '已取消';
  const cls = 'task-row' + (overdue ? ' overdue' : '') + (done ? ' done' : '') + (cancelled ? ' cancelled' : '');
  return `<div class="${cls}" data-id="${t.id}">
    <input type="checkbox" class="task-done" ${done ? 'checked' : ''} data-id="${t.id}" title="标记完成" ${cancelled ? 'disabled' : ''}/>
    <span class="task-ico" title="${esc(t.type)}">${TASK_TYPE_ICON[t.type] || '📝'}</span>
    <div class="task-main">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-meta">${esc(t.type || '')} · 优先级 ${esc(t.priority || '中')}${t.relatedName ? ' · 关联 ' + esc(t.relatedName) : ''} · 负责人 ${esc(t.ownerName || '-')}</div>
    </div>
    <span class="task-due ${overdue ? 'od' : ''}">${t.dueDate ? (overdue ? '逾期 ' + esc(t.dueDate) : esc(t.dueDate)) : '无日期'}${t.dueTime ? ' ' + esc(t.dueTime) : ''}</span>
    <button class="link-btn task-edit" data-id="${t.id}">编辑</button>
    <button class="link-btn task-del" data-id="${t.id}">删除</button>
  </div>`;
}

function renderTaskList() {
  const body = $('#taskListBody'); if (!body) return;
  let list = tasks.slice();
  if (taskFilter.mine && currentUser) list = list.filter((t) => t.owner === currentUser.id);
  if (taskFilter.type) list = list.filter((t) => t.type === taskFilter.type);
  if (taskFilter.status === 'open') list = list.filter(isOpen);
  else if (taskFilter.status === 'overdue') list = list.filter(isOverdue);
  else if (taskFilter.status === 'done') list = list.filter((t) => t.status === '已完成' || t.status === '已取消');
  // 列表默认按登记时间由新到旧。
  list.sort(newestRecords);
  if (!list.length) {
    body.innerHTML = '<div class="empty">暂无任务。点右上角「+ 新建任务」添加跟进计划。</div>';
    return;
  }
  body.innerHTML = list.map(taskRowHtml).join('');
}

// ---------- 日历视图 ----------
function renderTaskCalendar() {
  const host = $('#taskCalHost'); if (!host) return;
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  const ct = $('#calTitle'); if (ct) ct.textContent = `${y} 年 ${m + 1} 月`;
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((startDow + daysInMonth) / 7) * 7;
  const today = todayStr();
  let html = '<div class="cal-grid cal-head">';
  ['日', '一', '二', '三', '四', '五', '六'].forEach((d) => { html += `<div class="cal-col-h">${d}</div>`; });
  html += '</div><div class="cal-grid">';
  for (let i = 0; i < total; i++) {
    const d = new Date(y, m, 1 - startDow + i);
    const ds = fmtDate(d);
    const inMonth = d.getMonth() === m;
    const list = tasks.filter((t) => t.dueDate === ds && (!taskFilter.mine || !currentUser || t.owner === currentUser.id) && (!taskFilter.type || t.type === taskFilter.type));
    const cls = 'cal-cell' + (inMonth ? '' : ' muted') + (ds === today ? ' today' : '');
    html += `<div class="${cls}" data-date="${ds}">
      <div class="cal-cell-top"><span class="cal-d">${d.getDate()}</span><button class="cal-add" data-date="${ds}" title="该日新建任务">+</button></div>
      <div class="cal-tasks">${list.slice(0, 3).map((t) => {
        const od = isOverdue(t);
        return `<div class="cal-task ${t.status === '已完成' ? 'done' : ''} ${od ? 'overdue' : ''}" data-id="${t.id}" title="${esc(t.title)}">${TASK_TYPE_ICON[t.type] || '•'} ${esc(t.title)}</div>`;
      }).join('')}${list.length > 3 ? `<div class="cal-more">+${list.length - 3}</div>` : ''}</div>
    </div>`;
  }
  html += '</div>';
  host.innerHTML = html;
}

// ---------- 看板视图（待办 / 进行中 / 已完成，支持拖拽流转） ----------
const KANBAN_COLS = [
  { status: '待办', label: '待办' },
  { status: '进行中', label: '进行中' },
  { status: '已完成', label: '已完成' },
];

function kanbanCardHtml(t) {
  const overdue = isOverdue(t);
  const pri = t.priority || '中';
  return `<div class="kb-card ${overdue ? 'overdue' : ''} ${t.status === '已完成' ? 'done' : ''}" draggable="true" data-id="${t.id}" title="点击编辑，可拖拽到其他列变更状态">
    <div class="kb-card-title">${TASK_TYPE_ICON[t.type] || '📝'} ${esc(t.title)}</div>
    ${t.relatedName ? `<div class="kb-card-rel">🔗 ${esc(t.relatedName)}</div>` : ''}
    <div class="kb-card-foot">
      <span class="kb-pri kb-pri-${pri}">${esc(pri)}</span>
      <span class="kb-due ${overdue ? 'od' : ''}">${t.dueDate ? esc(t.dueDate) : '无日期'}</span>
      <span class="kb-owner">${esc(t.ownerName || '-')}</span>
    </div>
  </div>`;
}

function renderTaskKanban() {
  const host = $('#taskKanbanHost'); if (!host) return;
  let list = tasks.filter((t) => t.status !== '已取消');
  if (taskFilter.mine && currentUser) list = list.filter((t) => t.owner === currentUser.id);
  if (taskFilter.type) list = list.filter((t) => t.type === taskFilter.type);
  const priOrder = { '高': 0, '中': 1, '低': 2 };
  host.innerHTML = KANBAN_COLS.map((col) => {
    const items = list.filter((t) => (t.status || '待办') === col.status)
      .sort((a, b) => (priOrder[a.priority || '中'] - priOrder[b.priority || '中']) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    return `<div class="kb-col" data-status="${col.status}">
      <div class="kb-col-head"><span class="kb-col-title">${col.label}</span><span class="kb-col-count">${items.length}</span></div>
      <div class="kb-col-body">${items.map(kanbanCardHtml).join('') || '<div class="kb-empty">拖拽任务到此列</div>'}</div>
      <button class="kb-add" data-status="${col.status}" title="在此列新建任务">＋</button>
    </div>`;
  }).join('');
}

// 看板拖拽 / 点击（事件委托）
function initKanbanEvents() {
  const host = $('#taskKanbanHost'); if (!host) return;
  host.addEventListener('click', (e) => {
    const add = e.target.closest('.kb-add');
    if (add) { openTaskModal(null, { status: add.dataset.status }); return; }
    const card = e.target.closest('.kb-card');
    if (card) openTaskModal(card.dataset.id);
  });
  host.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kb-card');
    if (!card) return;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
  });
  host.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kb-card');
    if (card) card.classList.remove('dragging');
    host.querySelectorAll('.kb-col').forEach((c) => c.classList.remove('drag-over'));
  });
  host.addEventListener('dragover', (e) => {
    const col = e.target.closest('.kb-col');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    host.querySelectorAll('.kb-col').forEach((c) => c.classList.toggle('drag-over', c === col));
  });
  host.addEventListener('drop', async (e) => {
    const col = e.target.closest('.kb-col');
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const t = tasks.find((x) => x.id === id);
    if (!t || (t.status || '待办') === col.dataset.status) return;
    const body = { status: col.dataset.status };
    if (col.dataset.status === '已完成') body.doneAt = Date.now();
    const r = await api('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) { toast('更新失败'); return; }
    t.status = col.dataset.status;
    toast('已移到「' + col.dataset.status + '」');
    renderTaskKanban();
    renderTaskStats();
  });
}
initKanbanEvents();

async function renderTasksView() {
  readTaskFilters();
  if (!tasks.length) await loadTasks();
  if (taskSubtab === 'calendar') renderTaskCalendar();
  else if (taskSubtab === 'kanban') renderTaskKanban();
  else renderTaskList();
  renderTaskStats();
}
window.renderTasksView = renderTasksView;

// ---------- 编辑弹窗 ----------
function relSelectHtml(t) {
  const relVal = (t.relatedKind && t.relatedId) ? t.relatedKind + ':' + t.relatedId : '';
  const inqs = (typeof window.getAllInquiries === 'function') ? window.getAllInquiries() : [];
  const opt = (v, label) => `<option value="${esc(v)}" ${v === relVal ? 'selected' : ''}>${esc(label)}</option>`;
  let html = opt('', '— 不关联 —');
  for (const c of clients) html += opt('client:' + c.id, '客户：' + (c.company || ''));
  for (const i of inqs) html += opt('inquiry:' + i.id, '询盘：' + (i.clientName || ''));
  return `<div class="field full"><label>关联对象</label><select name="related">${html}</select></div>`;
}

function openTaskModal(id, prefill) {
  const t = id ? tasks.find((x) => x.id === id) : (prefill || {});
  const html = `
    ${field('标题 *', 'title', t.title, 'text', 'required')}
    <div class="form-grid">
      ${selectField('类型', 'type', t.type || '待办', TASK_TYPES)}
      ${selectField('状态', 'status', t.status || '待办', TASK_STATUSES)}
    </div>
    <div class="form-grid">
      ${selectField('优先级', 'priority', t.priority || '中', TASK_PRIORITIES)}
      ${field('日期', 'dueDate', t.dueDate || '', 'date')}
      ${field('时间', 'dueTime', t.dueTime || '', 'time')}
    </div>
    ${relSelectHtml(t)}
    <div class="field full"><label>备注</label><textarea name="notes" rows="3">${esc(t.notes || '')}</textarea></div>
  `;
  openModal(id ? '编辑任务' : '新建任务', html);
  const form = $('#modalForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      title: (fd.get('title') || '').toString().trim(),
      type: fd.get('type'), status: fd.get('status'), priority: fd.get('priority'),
      dueDate: fd.get('dueDate') || '', dueTime: fd.get('dueTime') || '', notes: fd.get('notes') || '',
      related: fd.get('related') || '',
    };
    if (!body.title) { toast('请填写标题'); return; }
    let related = { kind: '', id: '', name: '' };
    if (body.related) {
      const [kind, rid] = body.related.split(':');
      related.kind = kind; related.id = rid;
      if (kind === 'client') { const c = clients.find((x) => x.id === rid); related.name = c ? c.company : ''; }
      else if (kind === 'inquiry') { const iq = (typeof window.getAllInquiries === 'function') ? window.getAllInquiries().find((x) => x.id === rid) : null; related.name = iq ? iq.clientName : ''; }
    }
    body.relatedName = related.name; body.relatedId = related.id; body.relatedKind = related.kind;
    delete body.related;
    if (body.status === '已完成') body.doneAt = Date.now();
    let r;
    if (id) r = await api('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else r = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || r.status)); return; }
    closeModal();
    await loadTasks(); renderTaskStats();
    const view = location.hash.replace(/^#\/?/, '');
    if (view === 'tasks') renderTasksView(); else renderDashboard();
    toast('已保存');
  };
}
window.openTaskModal = openTaskModal;

// ---------- 列表交互（编辑 / 删除 / 完成） ----------
function onTaskListClick(e) {
  const ed = e.target.closest('.task-edit');
  const del = e.target.closest('.task-del');
  if (ed) { openTaskModal(ed.dataset.id); return; }
  if (del) {
    if (!confirm('确认删除该任务？')) return;
    api('/api/tasks/' + del.dataset.id, { method: 'DELETE' }).then(async (r) => {
      if (!r.ok) { toast('删除失败'); return; }
      await loadTasks(); renderTaskStats();
      const view = location.hash.replace(/^#\/?/, '');
      if (view === 'tasks') renderTaskList(); else renderDashboard();
      toast('已删除');
    });
  }
}
function onTaskListChange(e) {
  const cb = e.target.closest('.task-done');
  if (!cb) return;
  const id = cb.dataset.id;
  const t = tasks.find((x) => x.id === id); if (!t) return;
  const newStatus = cb.checked ? '已完成' : (t.status === '已完成' ? '待办' : t.status);
  api('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify({ status: newStatus, doneAt: cb.checked ? Date.now() : null }) }).then(async (r) => {
    if (!r.ok) { toast('更新失败'); cb.checked = !cb.checked; return; }
    await loadTasks(); renderTaskStats();
    const view = location.hash.replace(/^#\/?/, '');
    if (view === 'tasks') renderTaskList(); else renderDashboard();
  });
}

// ---------- 初始化 ----------
function initTasks() {
  // 子页签：列表 / 日历
  $$('#view-tasks .subtab').forEach((b) => b.addEventListener('click', () => {
    $$('#view-tasks .subtab').forEach((x) => x.classList.remove('active'));
    $$('#view-tasks .subview').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const st = b.dataset.subtab;
    const listEl = document.getElementById('sub-task-list');
    const calEl = document.getElementById('sub-task-cal');
    const kbEl = document.getElementById('sub-task-kanban');
    if (listEl) listEl.classList.toggle('active', st === 'list');
    if (calEl) calEl.classList.toggle('active', st === 'calendar');
    if (kbEl) kbEl.classList.toggle('active', st === 'kanban');
    taskSubtab = st;
    renderTasksView();
  }));

  // 状态筛选条
  $$('#taskFilterBar .lf-chip').forEach((c) => c.addEventListener('click', () => {
    $$('#taskFilterBar .lf-chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    taskFilter.status = c.dataset.st || 'open';
    renderTaskList();
  }));

  // 工具栏
  $('#taskAdd')?.addEventListener('click', () => openTaskModal());
  $('#taskTypeFilter')?.addEventListener('change', renderTasksView);
  $('#taskMineOnly')?.addEventListener('change', renderTasksView);

  // 日历导航
  $('#calPrev')?.addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderTaskCalendar(); });
  $('#calNext')?.addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderTaskCalendar(); });
  $('#calToday')?.addEventListener('click', () => { calCursor = new Date(); renderTaskCalendar(); });

  // 列表行事件委托
  const lb = $('#taskListBody');
  lb?.addEventListener('click', onTaskListClick);
  lb?.addEventListener('change', onTaskListChange);

  // 日历点击（日格 + 任务）事件委托
  $('#taskCalHost')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.cal-task');
    if (chip) { openTaskModal(chip.dataset.id); return; }
    const add = e.target.closest('.cal-add');
    if (add) { openTaskModal(null, { dueDate: add.dataset.date }); }
  });

  // 仪表盘卡片跳转
  $('#cardTasksToday')?.addEventListener('click', () => { taskFilter = { status: 'open', type: '', mine: true }; switchView('tasks'); });
  $('#cardTasksOverdue')?.addEventListener('click', () => { taskFilter = { status: 'overdue', type: '', mine: true }; switchView('tasks'); });

  // 视图激活钩子（包裹既有 onViewActivated，避免覆盖 settings/audit 的钩子）
  window.onViewActivated = (function (orig) {
    return function (view) {
      if (typeof orig === 'function') orig(view);
      if (view === 'tasks') renderTasksView();
      else if (view === 'dashboard') renderTaskStats();
    };
  })(window.onViewActivated);

  // 数据就绪后拉取任务并刷新统计（登录后 loadAll 触发）
  window.addEventListener('ftw:dataReady', async () => {
    await loadTasks();
    renderTaskStats();
    if (location.hash.replace(/^#\/?/, '') === 'tasks') renderTasksView();
  });
}
initTasks();
