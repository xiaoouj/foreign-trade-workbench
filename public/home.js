// Dashboard request feedback follows the loaders that own each data set.
const dashSources = new Map(['core', 'inquiries', 'tasks', 'quotes'].map(key => [key, 'pending']));
const dashPending = new Map();
let dashFeedbackTimer;
async function ftwDashLoad(source, loader) {
  dashPending.set(source, (dashPending.get(source) || 0) + 1);
  dashSources.set(source, 'pending');
  ftwDashFeedback();
  try {
    const value = await loader();
    dashSources.set(source, 'ready');
    return value;
  } catch (error) {
    dashSources.set(source, 'error');
    throw error;
  } finally {
    dashPending.set(source, dashPending.get(source) - 1);
    clearTimeout(dashFeedbackTimer);
    dashFeedbackTimer = setTimeout(() => {
      if (typeof renderDashKpis === 'function') renderDashKpis();
      if (typeof renderTodoList === 'function') renderTodoList();
      if (typeof renderRevenueTrend === 'function') renderRevenueTrend();
      ftwDashFeedback();
    }, 0);
  }
}
function dashStatus(sources) {
  if (sources.some(source => dashSources.get(source) === 'error' && !dashPending.get(source))) return 'error';
  return sources.some(source => dashSources.get(source) === 'pending' || dashPending.get(source)) ? 'pending' : 'ready';
}
function ftwDashFeedback() {
  window.ftwClientFeedback?.(dashStatus(['core']));
  const groups = [
    ['#statFollow', ['inquiries']], ['#statQuotes', ['quotes']],
    ['#statClients', ['core']], ['#statTasksToday', ['tasks']],
    ['#statWeighted', ['inquiries']], ['#statMonthRevenue', ['core', 'inquiries']],
    ['#pipelineList', ['inquiries']], ['#todoList', ['inquiries', 'tasks']],
    ['#oppList', ['inquiries']], ['#revenueTrend', ['core']]
  ];
  for (const [selector, sources] of groups) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const card = element.closest('.stat-card');
    const host = card || element;
    const status = dashStatus(sources);
    host.classList.toggle('dash-loading', status === 'pending');
    host.classList.toggle('dash-failed', status === 'error');
    host.setAttribute('aria-busy', String(status === 'pending'));
    if (card) {
      let state = card.querySelector('.dash-card-state');
      if (!state) { state = document.createElement('span'); state.className = 'dash-card-state'; card.append(state); }
      state.textContent = status === 'pending' ? '正在加载…' : status === 'error' ? '加载失败 · 点击重试' : '';
      continue;
    }
    host.querySelector(':scope > .dash-feedback')?.remove();
    if (status !== 'ready') {
      const feedback = document.createElement('div');
      feedback.className = 'dash-feedback';
      feedback.setAttribute('role', 'status');
      feedback.innerHTML = status === 'pending'
        ? '<span class="dash-skeleton" aria-hidden="true"></span><span class="dash-skeleton" aria-hidden="true"></span><span class="dash-skeleton" aria-hidden="true"></span><span class="dash-sr-only">正在加载数据…</span>'
        : '<p>数据暂时无法加载，请稍后重试。</p><button type="button" class="btn-ghost" data-dash-retry>重新加载</button>';
      host.append(feedback);
    }
  }
  const hint = document.querySelector('#dashHint');
  if (hint) {
    const status = dashStatus(['inquiries', 'tasks']);
    hint.classList.toggle('dash-skeleton', status === 'pending');
    hint.setAttribute('aria-busy', String(status === 'pending'));
    if (status === 'pending') hint.textContent = '正在加载今日工作摘要…';
    else if (status === 'error') hint.textContent = '今日工作摘要暂时不可用，请重新加载。';
    else {
      const today = todayStr();
      const due = (window.getAllInquiries?.() || []).filter(q => q.nextFollowAt && q.nextFollowAt <= today && canSeeBusiness(q.owner));
      const tasks = (window.getAllTasks?.() || []).filter(t => !['已完成', '已取消'].includes(t.status) && t.dueDate && t.dueDate <= today);
      hint.innerHTML = due.length || tasks.length
        ? `有 <b>${due.length} 条询盘待跟进</b>，${tasks.length} 项到期待办；${document.getElementById('flowClockCount')?.textContent||0} 个客户时区此刻在办公。`
        : '今天暂无到期待办与跟进，可以看看新询盘。';
    }
  }
}
function dashEmpty(title, description, action, label) {
  return `<div class="dash-empty"><span class="dash-empty-icon" aria-hidden="true">◇</span><strong>${esc(title)}</strong><p>${esc(description)}</p><button type="button" class="btn-ghost" ${action}>${esc(label)}</button></div>`;
}
async function dashRetry() {
  const jobs = [];
  if (dashSources.get('core') !== 'ready') jobs.push(loadAll());
  if (dashSources.get('inquiries') !== 'ready') jobs.push(loadInquiries());
  if (dashSources.get('tasks') !== 'ready') jobs.push(loadTasks());
  if (dashSources.get('quotes') !== 'ready') jobs.push(loadQuotations());
  await Promise.allSettled(jobs);
}
document.addEventListener('DOMContentLoaded', () => {
  const search = document.querySelector('#globalSearch');
  if (search) {
    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
    search.setAttribute('aria-label', '搜索客户、询盘或订单');
    search.setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    const key = document.createElement('kbd'); key.className = 'dash-search-key'; key.textContent = shortcut; key.setAttribute('aria-hidden', 'true');
    search.after(key);
    document.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.altKey || event.isComposing) return;
      if (document.querySelector('#modal.open, #clientDrawer.open, .login-overlay:not(.hidden)') || document.body.classList.contains('ftw-nav-mobile-open')) return;
      event.preventDefault(); if (window.openFlowSearch) window.openFlowSearch(); else {search.focus(); search.select();}
    });
  }
  document.querySelectorAll('#view-dashboard .stat-card').forEach(card => {
    card.tabIndex = 0; card.setAttribute('role', 'button');
    card.addEventListener('keydown', event => {
      if (event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); card.click(); }
    });
    card.addEventListener('click', event => {
      if (!card.classList.contains('dash-failed')) return;
      event.stopImmediatePropagation(); dashRetry();
    }, true);
  });
  document.querySelector('#view-dashboard')?.addEventListener('click', event => {
    if (event.target.closest('[data-dash-retry]')) dashRetry();
    const go = event.target.closest('[data-dash-go]');
    if (go) switchView(go.dataset.dashGo);
    if (event.target.closest('[data-dash-create="task"]')) window.openTaskModal?.();
    if (event.target.closest('[data-dash-create="inquiry"]')) { switchView('enquiry'); openInqModal(); }
  });
  ftwDashFeedback();
});
