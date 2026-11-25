// ====== 任务日历：Trello 式看板 + 月历 ======
// 看板按状态分列（待办 / 进行中 / 已完成），卡片可拖到其他列或同列换位置；
// 日历按到期日排布，任务可拖到别的日期改期。数据仍是 /api/tasks，
// RBAC 与服务端一致：owner=创建人，经理可见团队、管理员可见全部、业务员仅看自己。
// 同列排序用任务上的 boardRank（数字越小越靠前），没有 boardRank 的任务排在后面，按紧急程度排。
const TASK_TYPES = ['待办', '跟进', '电话', '会议', '邮件', '其他'];
const TASK_STATUSES = ['待办', '进行中', '已完成', '已取消'];
const TASK_PRIORITIES = ['高', '中', '低'];

let tasks = [];
let tasksLoadState = 'loading';

const getAllTasks = () => tasks;
window.getAllTasks = getAllTasks;

async function loadTasks() {
  try {
    await ftwDashLoad('tasks', async () => {
      const r = await api('/api/tasks');
      if (!r.ok) throw new Error('任务加载失败');
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error('任务数据格式异常');
      tasks = data;
    });
    tasksLoadState = 'ready';
  } catch (e) { console.error('loadTasks', e); tasksLoadState = 'error'; }
  return tasks;
}

// ---------- 仪表盘统计（今日 / 逾期，按当前登录人） ----------
function renderTaskStats() {
  const open = (t) => t.status !== '已完成' && t.status !== '已取消';
  const my = currentUser ? tasks.filter((t) => t.owner === currentUser.id) : tasks;
  const e1 = $('#statTasksToday'); if (e1) e1.textContent = tasks.filter(t => open(t) && t.dueDate && t.dueDate <= todayStr() && canSeeBusiness(t.owner)).length;
  const e2 = $('#statTasksOverdue'); if (e2) e2.textContent = my.filter((t) => open(t) && t.dueDate && t.dueDate < todayStr()).length;
}
window.renderTaskStats = renderTaskStats;

(function () {
  const root = document.getElementById('live-tasks');
  if (!root) return;
  const $q = (s) => root.querySelector(s);
  const proto = () => window.CRMPrototype || {};
  const ic = (id, style) => (proto().ic ? proto().ic(id, style) : '');
  const today = () => (proto().today ? proto().today() : new Date().toISOString().slice(0, 10));

  const isOpen = (t) => t.status !== '已完成' && t.status !== '已取消';
  const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const dayNo = (s) => Date.parse(s + 'T00:00:00Z') / 864e5;
  const dayDiff = (a, b) => Math.round(dayNo(b) - dayNo(a));
  const dueOf = (t) => (validDay(t.dueDate) ? t.dueDate : '');
  const isOverdue = (t) => isOpen(t) && !!dueOf(t) && dueOf(t) < today();
  const isToday = (t) => isOpen(t) && dueOf(t) === today();
  const mdLabel = (s) => `${+s.slice(5, 7)}月${+s.slice(8, 10)}日`;
  const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const typeIcon = (t) => ({ 待办: 'check', 跟进: 'chat', 电话: 'phone', 会议: 'cal', 邮件: 'inbox', 其他: 'more' }[t] || 'check');
  const PRI = { 高: 'hi', 中: 'md', 低: 'lo' };
  const QUICK = {
    overdue: isOverdue,
    today: isToday,
    nodate: (t) => isOpen(t) && !dueOf(t),
  };
  const COLS = ['待办', '进行中', '已完成', '已取消'];
  const DONE_CAP = 10;
  const DAY_CHIPS = 3;

  const saved = (() => { try { return localStorage.getItem('ftw.tasks.view'); } catch { return ''; } })();
  const state = {
    view: saved === 'calendar' ? 'calendar' : 'board',
    q: '', type: '', owner: 'mine', quick: '',
    month: today().slice(0, 7), day: '', openDay: '',
    showDone: false, compose: '', draft: '',
    dragging: false, pending: false,
  };

  // ---------- 数据范围 ----------
  const ownerLabel = (t) => t.ownerName || t.owner || '未分配';
  function scoped() {
    const q = state.q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (state.owner === 'mine') { if (currentUser && t.owner !== currentUser.id) return false; }
      else if (state.owner !== 'all' && (t.owner || '') !== state.owner) return false;
      if (state.type && t.type !== state.type) return false;
      if (q && ![t.title, t.relatedName, t.notes, t.ownerName, t.type].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }
  const visible = () => (state.quick ? scoped().filter(QUICK[state.quick]) : scoped());
  const byId = (id) => tasks.find((t) => t.id === id);

  // 列内顺序：先看 boardRank，没有的再按逾期 / 优先级 / 到期日排。
  function compare(a, b) {
    const ra = Number.isFinite(a.boardRank) ? a.boardRank : Infinity;
    const rb = Number.isFinite(b.boardRank) ? b.boardRank : Infinity;
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (a.status === '已完成' && b.status === '已完成') return (b.doneAt || 0) - (a.doneAt || 0);
    if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
    const w = { 高: 0, 中: 1, 低: 2 };
    const pa = w[a.priority] ?? 1, pb = w[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    const da = dueOf(a) || '9999-99-99', db = dueOf(b) || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }
  // 状态为空或不在列表里的旧数据，一律放进「待办」列，避免任务从看板上消失。
  const statusOf = (t) => (TASK_STATUSES.includes(t.status) ? t.status : '待办');
  const columnTasks = (status, list) => list.filter((t) => statusOf(t) === status).sort(compare);

  // ---------- 通用小件 ----------
  function dueBadge(t) {
    const d = dueOf(t);
    const time = t.dueTime ? ' ' + esc(t.dueTime) : '';
    if (!d) return `<span class="due none">${ic('clock')}无日期</span>`;
    if (!isOpen(t)) return `<span class="due ok">${ic(t.status === '已完成' ? 'check' : 'clock')}${mdLabel(d)}</span>`;
    const diff = dayDiff(today(), d);
    if (diff < 0) return `<span class="due late">${ic('alert')}逾期 ${-diff} 天 · ${mdLabel(d)}</span>`;
    if (diff === 0) return `<span class="due soon">${ic('clock')}今天${time}</span>`;
    return `<span class="due">${ic('clock')}${mdLabel(d)}${time}${diff <= 7 ? ` · ${diff} 天后` : ''}</span>`;
  }
  function avatar(t) {
    const name = ownerLabel(t);
    const tone = [...String(t.owner || name)].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
    return `<span class="tk-own o${tone}" title="${esc(name)}" aria-label="负责人 ${esc(name)}">${esc(name.slice(0, 1).toUpperCase())}</span>`;
  }

  function cardHtml(t) {
    const done = t.status === '已完成', cancelled = t.status === '已取消';
    const pri = t.priority || '中';
    // 默认的「中优先级」「待办」类型不重复显示，只标出需要留意的标签。
    const labels = (pri !== '中' ? `<span class="lb pr-${PRI[pri] || 'md'}">${esc(pri)}优先级</span>` : '')
      + (t.type && t.type !== '待办' ? `<span class="lb ty">${ic(typeIcon(t.type))}${esc(t.type)}</span>` : '');
    const cls = 'tk-card' + (isOverdue(t) ? ' late' : '') + (done ? ' done' : '') + (cancelled ? ' cancel' : '');
    return `<article class="${cls}" data-id="${esc(t.id)}" draggable="true" tabindex="0" aria-label="${esc(t.title)}">
      <button type="button" class="tk-chk" data-done="${esc(t.id)}" aria-pressed="${done}" aria-label="${done ? '恢复为待办' : '标记完成'}：${esc(t.title)}"${cancelled ? ' disabled' : ''}>${ic('check')}</button>
      ${labels ? `<div class="tk-labels">${labels}</div>` : ''}
      <h4>${esc(t.title)}</h4>
      ${t.relatedName ? `<div class="tk-rel">${ic('link')}<span>${esc(t.relatedName)}</span></div>` : ''}
      <div class="tk-foot">${dueBadge(t)}${avatar(t)}</div>
    </article>`;
  }

  // ---------- 看板 ----------
  function renderBoard() {
    const host = $q('#tk-board');
    if (tasksLoadState === 'error' && !tasks.length) {
      host.innerHTML = `<div class="err" role="alert">${ic('alert')}<h3>任务没有加载出来</h3><p>服务器暂时没有响应，请稍后重试。</p><button class="btn" type="button" data-retry>${ic('refresh')}重新加载</button></div>`;
      return;
    }
    if (tasksLoadState === 'loading' && !tasks.length) {
      host.innerHTML = '<div class="tk-cols">' + ['待办', '进行中', '已完成'].map((s) => `<section class="tk-col"><header class="tk-col-h"><h3>${s}</h3></header><div class="tk-col-b">${'<div class="tk-card sk"><span></span><span></span></div>'.repeat(2)}</div></section>`).join('') + '</div>';
      return;
    }
    const list = visible();
    const cols = COLS.filter((s) => s !== '已取消' || list.some((t) => statusOf(t) === '已取消'));
    host.innerHTML = '<div class="tk-cols">' + cols.map((s) => {
      const rows = columnTasks(s, list);
      const capped = s === '已完成' && !state.showDone && rows.length > DONE_CAP;
      const shown = capped ? rows.slice(0, DONE_CAP) : rows;
      const more = s === '已完成' && rows.length > DONE_CAP
        ? `<button type="button" class="tk-more" data-showdone>${state.showDone ? '只看最近 ' + DONE_CAP + ' 条' : '显示全部 ' + rows.length + ' 条'}</button>` : '';
      const composing = state.compose === s;
      const foot = s === '已取消' ? '' : composing
        ? `<form class="tk-comp" data-comp="${s}"><textarea rows="2" maxlength="200" placeholder="输入任务标题，回车添加" aria-label="新任务标题（${s}）">${esc(state.draft)}</textarea><div class="acts"><button class="btn btn-pri" type="submit">添加</button><button class="btn btn-ghost" type="button" data-comp-x>取消</button></div></form>`
        : `<button type="button" class="tk-add" data-add="${s}">${ic('plus')}添加任务</button>`;
      return `<section class="tk-col${s === '已取消' ? ' muted' : ''}" data-status="${s}" aria-label="${s}，${rows.length} 条任务">
        <header class="tk-col-h"><h3>${s}</h3><span class="n">${rows.length}</span></header>
        <div class="tk-col-b" data-status="${s}">${shown.map(cardHtml).join('') || '<p class="tk-empty">这里还没有任务</p>'}${more}</div>
        <div class="tk-col-f">${foot}</div>
      </section>`;
    }).join('') + '</div>';
    if (state.compose) {
      const ta = host.querySelector('.tk-comp textarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
  }

  // ---------- 日历 ----------
  function renderCalendar() {
    const host = $q('#tk-cal');
    const [y, m] = state.month.split('-').map(Number);
    const first = `${state.month}-01`;
    const lead = (new Date(Date.parse(first + 'T00:00:00Z')).getUTCDay() + 6) % 7; // 周一为首
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const total = Math.ceil((lead + days) / 7) * 7;
    const todayStr_ = today();
    const list = visible().filter((t) => t.status !== '已取消');
    const byDay = new Map();
    for (const t of list) { const d = dueOf(t); if (d) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(t); } }
    const undated = list.filter((t) => isOpen(t) && !dueOf(t)).sort(compare);
    const chip = (t) => {
      const k = !isOpen(t) ? 'done' : isOverdue(t) || t.priority === '高' ? 'hi' : '';
      return `<div class="tk-ev ${k}" role="button" tabindex="0" draggable="true" data-id="${esc(t.id)}" title="${esc(t.title)}">${esc(t.dueTime ? t.dueTime + ' ' : '')}${esc(t.title)}</div>`;
    };
    const dot = (t) => `<i class="${!isOpen(t) ? 'done' : isOverdue(t) || t.priority === '高' ? 'hi' : ''}"></i>`;
    let cells = '';
    for (let i = 0; i < total; i++) {
      const ds = addDays(first, i - lead);
      const out = ds.slice(0, 7) !== state.month;
      const rows = (byDay.get(ds) || []).sort((a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || compare(a, b));
      const expanded = state.openDay === ds;
      const shown = expanded ? rows : rows.slice(0, DAY_CHIPS);
      const cls = 'tk-day' + (out ? ' out' : '') + (ds === todayStr_ ? ' today' : '') + (ds === (state.day || todayStr_) ? ' sel' : '');
      cells += `<div class="${cls}" data-date="${ds}">
        <div class="tk-dn"><span>${+ds.slice(8, 10)}</span><button type="button" class="tk-dadd" data-addday="${ds}" aria-label="在 ${mdLabel(ds)} 新建任务">${ic('plus')}</button></div>
        <div class="tk-evs">${shown.map(chip).join('')}${rows.length > DAY_CHIPS ? `<button type="button" class="tk-more" data-more="${ds}">${expanded ? '收起' : '还有 ' + (rows.length - DAY_CHIPS) + ' 项'}</button>` : ''}</div>
        <div class="tk-dots" aria-hidden="true">${rows.slice(0, 4).map(dot).join('')}</div>
      </div>`;
    }
    const sel = state.day || todayStr_;
    const agenda = (byDay.get(sel) || []).sort((a, b) => compare(a, b));
    host.innerHTML = `<div class="tk-cal-h">
        <button type="button" class="btn btn-ghost icon-btn" data-cal="-1" aria-label="上一月">${ic('chev', 'transform:rotate(90deg)')}</button>
        <h3 aria-live="polite">${y} 年 ${m} 月</h3>
        <button type="button" class="btn btn-ghost icon-btn" data-cal="1" aria-label="下一月">${ic('chev', 'transform:rotate(-90deg)')}</button>
        <button type="button" class="btn" data-cal="0">今天</button>
        <span class="tk-legend"><i class="hi"></i>逾期 / 高优先级<i></i>普通<i class="done"></i>已完成<i class="today"></i>今天</span>
      </div>
      <div class="tk-tray" data-tray aria-label="未排期任务，拖到日期上即可安排"><b>未排期 ${undated.length}</b>${undated.length ? undated.map(chip).join('') : '<span class="dim">没有未排期的任务；把日历上的任务拖到这里可取消日期</span>'}</div>
      <div class="tk-grid" role="grid">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<div class="tk-wd" role="columnheader">周${w}</div>`).join('')}${cells}</div>
      <div class="tk-agenda"><h4>${mdLabel(sel)}${sel === todayStr_ ? ' · 今天' : ''}<button type="button" class="btn" data-addday="${sel}">${ic('plus')}新建</button></h4>${agenda.length ? agenda.map(cardHtml).join('') : '<p class="tk-empty">这天没有任务</p>'}</div>`;
  }

  // ---------- 总渲染 ----------
  function owners() {
    const seen = new Map();
    for (const t of tasks) if (t.owner && !seen.has(t.owner)) seen.set(t.owner, ownerLabel(t));
    return [...seen];
  }
  function render() {
    if (state.dragging) { state.pending = true; return; }
    state.pending = false;
    const all = scoped();
    const open = all.filter(isOpen);
    const late = all.filter(isOverdue).length;
    $q('#tk-headSub').innerHTML = tasksLoadState === 'loading' && !tasks.length ? '正在加载任务…'
      : `共 <b>${all.length}</b> 条任务 · 未完成 <b>${open.length}</b> 条 · 逾期 <b>${late}</b> 条`;
    $q('#tk-attention').innerHTML = [
      ['overdue', '逾期', all.filter(QUICK.overdue).length, true],
      ['today', '今天到期', all.filter(QUICK.today).length],
      ['nodate', '未排期', all.filter(QUICK.nodate).length],
    ].map(([k, label, n, danger]) => `<button type="button" data-quick="${k}" aria-pressed="${state.quick === k}">${danger && n ? '<span class="dot"></span>' : ''}${label}<b>${n}</b></button>`).join('');
    const typeSel = $q('#tk-fType');
    const types = [...new Set([...TASK_TYPES, ...tasks.map((t) => t.type).filter(Boolean)])];
    typeSel.innerHTML = '<option value="">全部类型</option>' + types.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    typeSel.value = state.type; typeSel.classList.toggle('on', !!state.type);
    const ownSel = $q('#tk-fOwner');
    ownSel.innerHTML = '<option value="mine">我负责的</option><option value="all">全部负责人</option>' + owners().map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    ownSel.value = state.owner; if (ownSel.value !== state.owner) { state.owner = 'mine'; ownSel.value = 'mine'; }
    ownSel.classList.toggle('on', state.owner !== 'mine');
    $q('#tk-qWrap').classList.toggle('has', !!state.q);
    const dirty = state.q || state.type || state.quick || state.owner !== 'mine';
    $q('#tk-fbar').classList.toggle('dirty', !!dirty);
    $q('#tk-count').innerHTML = `显示 <b>${visible().length}</b> 条`;
    root.querySelectorAll('#tk-viewSeg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
    $q('#tk-board').hidden = state.view !== 'board';
    $q('#tk-cal').hidden = state.view !== 'calendar';
    if (state.view === 'board') renderBoard(); else renderCalendar();
  }
  async function renderTasksView(refresh = false) {
    if (!tasks.length || refresh) {
      if (!tasks.length) { tasksLoadState = 'loading'; render(); }
      await loadTasks();
    }
    render();
    renderTaskStats();
  }
  window.renderTasksView = renderTasksView;

  // ---------- 保存 ----------
  async function putTask(id, patch) {
    const r = await api('/api/tasks/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(patch) });
    if (!r.ok) throw new Error('保存失败（' + r.status + '）');
  }
  // 先改界面再写服务器；失败时重新读取服务器数据，保证界面不留下假状态。
  async function save(changes, okMsg) {
    for (const [id, patch] of changes) Object.assign(byId(id) || {}, patch);
    render(); renderTaskStats();
    try {
      await Promise.all(changes.map(([id, patch]) => putTask(id, patch)));
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast('保存失败，已恢复为服务器上的数据');
      await loadTasks(); render(); renderTaskStats();
    }
  }
  const completePatch = (done) => ({ status: done ? '已完成' : '待办', doneAt: done ? Date.now() : null });

  // 把任务放进某列的第 index 个位置：用前后卡片的 boardRank 取中间值，必要时给前面的卡片补号。
  function placeInColumn(id, status, index) {
    const t = byId(id);
    const col = columnTasks(status, visible());
    const cur = col.findIndex((x) => x.id === id);
    if (statusOf(t) === status && cur === index) return;
    const rest = col.filter((x) => x.id !== id);
    const prev = rest[index - 1], next = rest[index];
    const rk = (x) => (x && Number.isFinite(x.boardRank) ? x.boardRank : null);
    const changes = [], patch = {};
    if (t.status !== status) Object.assign(patch, completePatch(status === '已完成'), { status });
    if (!prev) patch.boardRank = rk(next) != null ? rk(next) - 1024 : 1024;
    else if (rk(prev) == null) {
      let last = 0;
      for (const x of rest.slice(0, index)) {
        if (rk(x) != null) last = rk(x);
        else { last += 1024; changes.push([x.id, { boardRank: last }]); }
      }
      patch.boardRank = last + 1024;
    } else if (rk(next) != null) {
      patch.boardRank = (rk(prev) + rk(next)) / 2;
      if (Math.abs(rk(next) - rk(prev)) < 1e-6) { // 间隔太小，整列重新编号
        rest.forEach((x, i) => changes.push([x.id, { boardRank: ((i < index ? i : i + 1) + 1) * 1024 }]));
        patch.boardRank = (index + 1) * 1024;
      }
    } else patch.boardRank = rk(prev) + 1024;
    changes.push([id, patch]);
    save(changes, status !== t.status ? `已移到「${status}」` : '');
  }

  async function addQuick(status, title) {
    const body = { title, type: '待办', status, priority: '中', dueDate: '', dueTime: '', notes: '' };
    if (status === '已完成') body.doneAt = Date.now();
    const r = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('添加失败：' + (j.error || r.status)); return false; }
    await loadTasks(); render(); renderTaskStats();
    return true;
  }

  // ---------- 拖拽（看板与日历共用） ----------
  let drag = null, drop = null;
  const clearDrop = () => { root.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); drop?.remove(); drop = null; };
  root.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.tk-card,.tk-ev');
    if (!el || el.closest('.tk-agenda')) { if (el) e.preventDefault(); return; }
    drag = { id: el.dataset.id, kind: el.classList.contains('tk-card') ? 'card' : 'ev' };
    state.dragging = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', drag.id);
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  root.addEventListener('dragend', () => {
    drag = null; clearDrop(); state.dragging = false;
    root.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
    if (state.pending) render();
  });
  root.addEventListener('dragover', (e) => {
    if (!drag) return;
    const body = e.target.closest('.tk-col')?.querySelector('.tk-col-b');
    const day = e.target.closest('.tk-day'), tray = e.target.closest('[data-tray]');
    if (drag.kind === 'card' && body) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      root.querySelectorAll('.tk-col.over').forEach((x) => x.classList.remove('over'));
      body.closest('.tk-col').classList.add('over');
      if (!drop) { drop = document.createElement('div'); drop.className = 'tk-drop'; }
      const cards = [...body.querySelectorAll('.tk-card:not(.dragging)')];
      const after = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (after) body.insertBefore(drop, after);
      else body.insertBefore(drop, body.querySelector('.tk-more') || null);
    } else if (drag.kind === 'ev' && (day || tray)) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      root.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
      (day || tray).classList.add('over');
    }
  });
  root.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) clearDrop(); });
  root.addEventListener('drop', (e) => {
    if (!drag) return;
    const col = e.target.closest('.tk-col'), day = e.target.closest('.tk-day'), tray = e.target.closest('[data-tray]');
    const id = drag.id, kind = drag.kind;
    if (kind === 'card' && col) {
      e.preventDefault();
      const body = col.querySelector('.tk-col-b');
      const index = drop && drop.parentNode === body ? [...body.children].slice(0, [...body.children].indexOf(drop)).filter((c) => c.classList.contains('tk-card') && !c.classList.contains('dragging')).length : body.querySelectorAll('.tk-card:not(.dragging)').length;
      clearDrop(); drag = null; state.dragging = false;
      placeInColumn(id, col.dataset.status, index);
    } else if (kind === 'ev' && (day || tray)) {
      e.preventDefault();
      const t = byId(id), date = day ? day.dataset.date : '';
      clearDrop(); drag = null; state.dragging = false;
      if (t && dueOf(t) !== date) save([[id, { dueDate: date }]], date ? `已改到 ${mdLabel(date)}` : '已取消日期');
      else render();
    }
  });

  // ---------- 点击 / 键盘 ----------
  function setState(patch) { Object.assign(state, patch); render(); }
  root.addEventListener('click', (e) => {
    const t = e.target;
    const done = t.closest('[data-done]');
    if (done) { const task = byId(done.dataset.done); if (task) save([[task.id, completePatch(task.status !== '已完成')]], task.status !== '已完成' ? '已完成' : '已恢复为待办'); return; }
    const seg = t.closest('#tk-viewSeg [data-view]');
    if (seg) { try { localStorage.setItem('ftw.tasks.view', seg.dataset.view); } catch { /* 忽略 */ } setState({ view: seg.dataset.view }); return; }
    const quick = t.closest('[data-quick]');
    if (quick) { setState({ quick: state.quick === quick.dataset.quick ? '' : quick.dataset.quick }); return; }
    if (t.closest('#tk-reset')) { $q('#tk-q').value = ''; setState({ q: '', type: '', owner: 'mine', quick: '' }); return; }
    if (t.closest('#tk-qWrap .clr')) { $q('#tk-q').value = ''; setState({ q: '' }); $q('#tk-q').focus(); return; }
    if (t.closest('#tk-addBtn')) { openTaskModal(null, state.view === 'calendar' ? { dueDate: state.day || '' } : {}); return; }
    if (t.closest('[data-retry]')) { tasksLoadState = 'loading'; render(); loadTasks().then(render); return; }
    const add = t.closest('[data-add]');
    if (add) { setState({ compose: add.dataset.add, draft: '' }); return; }
    if (t.closest('[data-comp-x]')) { setState({ compose: '', draft: '' }); return; }
    if (t.closest('[data-showdone]')) { setState({ showDone: !state.showDone }); return; }
    const cal = t.closest('[data-cal]');
    if (cal) {
      const v = Number(cal.dataset.cal), [y, m] = state.month.split('-').map(Number);
      const next = v === 0 ? today().slice(0, 7) : new Date(Date.UTC(y, m - 1 + v, 1)).toISOString().slice(0, 7);
      setState({ month: next, openDay: '', day: v === 0 ? today() : '' }); return;
    }
    const more = t.closest('[data-more]');
    if (more) { setState({ openDay: state.openDay === more.dataset.more ? '' : more.dataset.more }); return; }
    const addDay = t.closest('[data-addday]');
    if (addDay) { openTaskModal(null, { dueDate: addDay.dataset.addday }); return; }
    const open = t.closest('.tk-card,.tk-ev');
    if (open) { openTaskModal(open.dataset.id); return; }
    const day = t.closest('.tk-day');
    if (day && !day.classList.contains('out')) setState({ day: day.dataset.date });
    else if (day) setState({ day: day.dataset.date, month: day.dataset.date.slice(0, 7) });
  });
  root.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.matches('.tk-comp textarea')) {
      if (e.key === 'Escape') { e.preventDefault(); setState({ compose: '', draft: '' }); }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); t.form.requestSubmit(); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && t.matches('.tk-card,.tk-ev')) { e.preventDefault(); openTaskModal(t.dataset.id); }
  });
  root.addEventListener('input', (e) => { if (e.target.matches('.tk-comp textarea')) state.draft = e.target.value; });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('.tk-comp');
    if (!form) return;
    e.preventDefault();
    const title = form.querySelector('textarea').value.trim().replace(/\s+/g, ' ');
    if (!title) { setState({ compose: '', draft: '' }); return; }
    const status = form.dataset.comp, ta = form.querySelector('textarea');
    ta.disabled = true;
    state.draft = '';
    if (!await addQuick(status, title)) { state.draft = title; render(); }
  });
  let qTimer;
  $q('#tk-q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => setState({ q: e.target.value }), 160); });
  $q('#tk-fType').addEventListener('change', (e) => setState({ type: e.target.value }));
  $q('#tk-fOwner').addEventListener('change', (e) => setState({ owner: e.target.value }));

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
    if (id && !t) return;
    const typeList = TASK_TYPES.includes(t.type) || !t.type ? TASK_TYPES : [...TASK_TYPES, t.type];
    const html = `
    ${field('标题 *', 'title', t.title, 'text', 'required')}
    <div class="form-grid">
      ${selectField('类型', 'type', t.type || '待办', typeList)}
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
    if (id) {
      const foot = document.getElementById('modalFoot');
      const del = document.createElement('button');
      del.type = 'button'; del.id = 'taskDelete'; del.className = 'btn-ghost'; del.textContent = '删除任务';
      del.style.cssText = 'margin-right:auto;color:#c0352b';
      del.onclick = async () => {
        if (!confirm('确认删除该任务？')) return;
        const r = await api('/api/tasks/' + encodeURIComponent(id), { method: 'DELETE' });
        if (!r.ok) { toast('删除失败'); return; }
        closeModal();
        await loadTasks(); renderTaskStats();
        if (location.hash.replace(/^#\/?/, '') === 'tasks') render(); else renderDashboard();
        toast('已删除');
      };
      foot?.prepend(del);
    }
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
      const related = { kind: '', id: '', name: '' };
      if (body.related) {
        const [kind, rid] = body.related.split(':');
        related.kind = kind; related.id = rid;
        if (kind === 'client') { const c = clients.find((x) => x.id === rid); related.name = c ? c.company : ''; }
        else if (kind === 'inquiry') { const iq = (typeof window.getAllInquiries === 'function') ? window.getAllInquiries().find((x) => x.id === rid) : null; related.name = iq ? iq.clientName : ''; }
      }
      body.relatedName = related.name; body.relatedId = related.id; body.relatedKind = related.kind;
      delete body.related;
      if (body.status === '已完成') { if (t.status !== '已完成') body.doneAt = Date.now(); }
      else if (id && t.status === '已完成') body.doneAt = null;
      let r;
      if (id) r = await api('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify(body) });
      else r = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || r.status)); return; }
      closeModal();
      await loadTasks(); renderTaskStats();
      if (location.hash.replace(/^#\/?/, '') === 'tasks') render(); else renderDashboard();
      toast('已保存');
    };
  }
  window.openTaskModal = openTaskModal;

  // ---------- 初始化 ----------
  // 仪表盘卡片跳转
  document.getElementById('cardTasksToday')?.addEventListener('click', () => { Object.assign(state, { owner: 'mine', type: '', q: '', quick: 'today' }); switchView('tasks'); });
  document.getElementById('cardTasksOverdue')?.addEventListener('click', () => { Object.assign(state, { owner: 'mine', type: '', q: '', quick: 'overdue' }); switchView('tasks'); });

  // 视图激活钩子（包裹既有 onViewActivated，避免覆盖 settings/audit 的钩子）
  window.onViewActivated = (function (orig) {
    return function (view) {
      if (typeof orig === 'function') orig(view);
      if (view === 'tasks') renderTasksView(true);
      else if (view === 'dashboard') renderTaskStats();
    };
  })(window.onViewActivated);

  // 数据就绪后拉取任务并刷新统计（登录后 loadAll 触发）
  window.addEventListener('ftw:dataReady', async () => {
    await loadTasks();
    renderTaskStats();
    if (location.hash.replace(/^#\/?/, '') === 'tasks') render();
  });
})();
