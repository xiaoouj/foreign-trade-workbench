// Optional, isolated release UI. Never uses the business modal or error-toasting api().
(() => {
  'use strict';
  if (window.__ftwUpdateNoticeLoaded || !window.__FTW_BUILD__) return;
  window.__ftwUpdateNoticeLoaded = true;
  const ownBuild = window.__FTW_BUILD__;
  const PERIOD = 60000, SNOOZE = 30 * 60000;
  const memory = new Map();
  function read(key) { try { const value = localStorage.getItem(key); return value === null ? memory.get(key) : JSON.parse(value); } catch { return memory.get(key); } }
  function write(key, value) { memory.set(key, value); try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function token() { try { return localStorage.getItem('ftw_token') || ''; } catch { return ''; } }
  const seenKey = (uid, id) => 'ftw_announce_seen_' + encodeURIComponent(uid) + '_' + id;
  const pendingKey = uid => 'ftw_announce_pending_' + encodeURIComponent(uid);
  let session = null, epoch = 0, announcement = null, version = null;
  let versionBusy = false, announcementBusy = false, timer, failures = 0;
  let lastAnnouncementCheck = 0, confirmFocus = null;
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  const card = element('aside', '', document.body);
  card.id = 'updateNotice'; card.className = 'ftw-update-card'; card.hidden = true;
  card.setAttribute('aria-labelledby', 'ftwUpdateTitle');
  const title = element('h3', '', card); title.id = 'ftwUpdateTitle';
  const body = element('div', '', card); body.className = 'ftw-update-body';
  const actions = element('div', '', card); actions.className = 'ftw-update-actions';
  const later = element('button', '稍后', actions); later.type = 'button';
  const refresh = element('button', '立即刷新', actions); refresh.type = 'button';
  const close = element('button', '知道了', actions); close.type = 'button';
  const live = element('div', '', document.body);
  live.className = 'ftw-update-live'; live.setAttribute('aria-live', 'polite');
  const dialog = element('dialog', '', document.body);
  dialog.className = 'ftw-update-confirm'; dialog.setAttribute('aria-labelledby', 'ftwRefreshTitle');
  element('h3', '刷新前请保存', dialog).id = 'ftwRefreshTitle';
  element('p', '刷新会丢失尚未保存的客户、订单、报价等表单内容，以及尚未保存的 AI 解析结果。请先保存或完成当前操作。', dialog);
  const dialogActions = element('div', '', dialog); dialogActions.className = 'ftw-update-actions';
  const cancel = element('button', '暂不刷新', dialogActions); cancel.type = 'button';
  const confirm = element('button', '已保存，确认刷新', dialogActions); confirm.type = 'button';
  function closeConfirm() {
    if (dialog.open) dialog.close();
    if (confirmFocus?.isConnected) confirmFocus.focus({ preventScroll: true });
  }
  cancel.onclick = closeConfirm;
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeConfirm(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  const matches = (captured, n) => epoch === n && session === captured && captured?.token === token();
  async function request(url, captured, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { ...options.headers };
      if (captured?.token) headers.Authorization = 'Bearer ' + captured.token;
      const res = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error('notice unavailable');
      return await res.json();
    } finally { clearTimeout(timeout); }
  }
  function updateBlocking(blocked) {
    window.__ftwUpdateBlocking = blocked;
    if (blocked) {
      const idle = document.getElementById('idleRefreshReminder');
      if (idle) idle.hidden = true;
      const idleLive = document.getElementById('idleRefreshAnnouncement');
      if (idleLive) idleLive.textContent = '';
    }
  }
  function mode() {
    if (version?.updating) return 'deploying';
    if (version && version.buildId !== ownBuild) {
      const snooze = read('ftw_update_snooze');
      return snooze?.buildId === version.buildId && Number(snooze.until) > Date.now() ? '' : 'update';
    }
    if (announcement && session && session.token === token() && version?.buildId === ownBuild) return 'announcement';
    return '';
  }
  function render() {
    const state = mode();
    card.hidden = !state;
    updateBlocking(!!state || dialog.open);
    if (!state) { live.textContent = ''; return; }
    title.textContent = state === 'deploying' ? '系统正在更新' : state === 'update' ? '系统已发布新版本' : announcement.title;
    body.replaceChildren();
    const lines = state === 'deploying' ? ['请保留当前页面，暂勿刷新。更新完成后会再次提示。']
      : state === 'update' ? ['请先保存正在编辑的内容，再刷新以使用最新版本。'] : announcement.items;
    lines.forEach(line => element('p', String(line), body));
    later.hidden = refresh.hidden = state !== 'update';
    close.hidden = state !== 'announcement';
    if (live.textContent !== title.textContent) live.textContent = title.textContent;
    if (state === 'deploying' && dialog.open) closeConfirm();
  }
  later.onclick = () => { if (version) write('ftw_update_snooze', { buildId: version.buildId, until: Date.now() + SNOOZE }); render(); };
  refresh.onclick = () => {
    if (mode() !== 'update') return;
    confirmFocus = document.activeElement;
    dialog.showModal(); cancel.focus(); updateBlocking(true);
  };
  confirm.onclick = async () => {
    confirm.disabled = true;
    try {
      const current = await request('/api/version');
      if (!current || typeof current.buildId !== 'string' || typeof current.updating !== 'boolean') return;
      version = current;
      if (current.updating) { closeConfirm(); render(); return; }
      write('ftw_update_snooze', null);
      window.location.reload();
    } catch {
      // Keep edits and the confirmation open if deployment cannot be checked.
    } finally { confirm.disabled = false; }
  };
  async function retryRead(captured, n) {
    const pending = read(pendingKey(captured.id));
    if (!pending || !matches(captured, n)) return;
    try {
      await request('/api/announcement/read', captured, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pending.id, userId: captured.id }) });
      if (matches(captured, n)) {
        if (read(pendingKey(captured.id))?.id === pending.id) write(pendingKey(captured.id), null);
        document.dispatchEvent(new Event('ftw:notifications-changed'));
      }
    } catch { /* retry on the next foreground poll */ }
  }
  close.onclick = () => {
    if (!announcement || !session || session.token !== token()) return;
    const captured = session, n = epoch, id = announcement.id;
    write(seenKey(captured.id, id), true);
    write(pendingKey(captured.id), { id });
    announcement = null; render();
    void retryRead(captured, n);
  };
  async function checkAnnouncement() {
    if (!session || session.token !== token() || announcementBusy || document.hidden) return;
    const captured = session, n = epoch;
    announcementBusy = true;
    try {
      const result = await request('/api/announcement', captured);
      if (!matches(captured, n) || String(result.userId) !== captured.id) return;
      const a = result.announcement;
      if (a && (!/^[a-f0-9]{24}$/.test(a.id) || typeof a.title !== 'string' || !Array.isArray(a.items))) return;
      const pending = read(pendingKey(captured.id));
      const ids = a ? [a.id, ...(a.legacyIds || [])] : [];
      if (pending && (!ids.includes(pending.id) || result.read)) write(pendingKey(captured.id), null);
      announcement = a && !result.read && !ids.some(id => read(seenKey(captured.id, id))) ? a : null;
      lastAnnouncementCheck = Date.now();
      render();
      await retryRead(captured, n);
    } catch { /* optional UI must not affect authentication or business work */ }
    finally { if (epoch === n) announcementBusy = false; }
  }
  function sessionChanged() {
    epoch++;
    const id = window.__ftwNoticeUser?.id;
    session = id == null ? null : { id: String(id), token: token() };
    announcement = null; announcementBusy = false; lastAnnouncementCheck = 0;
    closeConfirm(); render();
    void checkAnnouncement();
  }
  async function poll() {
    clearTimeout(timer);
    if (!document.hidden && !versionBusy) {
      versionBusy = true;
      try {
        const value = await request('/api/version');
        if (!value || typeof value.buildId !== 'string' || typeof value.updating !== 'boolean') throw new Error('invalid version');
        version = value; failures = 0;
        const snooze = read('ftw_update_snooze');
        if (snooze?.buildId === ownBuild) write('ftw_update_snooze', null);
        render();
        if (!lastAnnouncementCheck || Date.now() - lastAnnouncementCheck >= PERIOD) void checkAnnouncement();
      } catch { failures = Math.min(failures + 1, 4); }
      finally { versionBusy = false; }
    }
    clearTimeout(timer);
    timer = setTimeout(poll, PERIOD * Math.pow(2, failures));
  }
  document.addEventListener('ftw:session-change', sessionChanged);
  document.addEventListener('ftw:notifications-changed', event => {
    if (session && event.detail?.userId === session.id && announcement?.id === event.detail.id) {
      write(seenKey(session.id, announcement.id), true); announcement = null; render();
    }
    void checkAnnouncement();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
  window.addEventListener('pageshow', () => { if (!document.hidden) void poll(); });
  window.addEventListener('storage', event => {
    if (event.key === 'ftw_token') {
      // The underlying CRM must establish the new account before showing its private announcement.
      window.__ftwNoticeUser = null; sessionChanged();
    } else if (event.key?.startsWith('ftw_announce_')) { void checkAnnouncement(); }
    else if (event.key === 'ftw_update_snooze') render();
  });
  sessionChanged();
  void poll();
})();
