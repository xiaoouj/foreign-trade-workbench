// 整个 CRM 工作台共用的空闲提醒；只有用户确认后才刷新页面。
(() => {
  'use strict';
  const IDLE_MS = 30 * 60 * 1000;
  const CHECK_MS = 15 * 1000;
  const reminder = document.getElementById('idleRefreshReminder');
  const announcement = document.getElementById('idleRefreshAnnouncement');
  const laterButton = document.getElementById('idleRefreshLater');
  const refreshButton = document.getElementById('idleRefreshNow');
  const loginOverlay = document.getElementById('loginOverlay');
  if (!reminder || !laterButton || !refreshButton || !loginOverlay) return;

  let trackedUser = null;
  let lastActivity = Date.now();
  let previousFocus = null;

  function userKey() {
    if (!loginOverlay.classList.contains('hidden')) return null;
    return typeof currentUser !== 'undefined' && currentUser && currentUser.id != null
      ? String(currentUser.id) : null;
  }

  function checkIdle() {
    const now = Date.now();
    const user = userKey();
    // 未登录、会话过期或换用户时不提醒；登录完成后重新计时。
    if (user !== trackedUser) {
      trackedUser = user;
      lastActivity = now;
      reminder.hidden = true;
      if (announcement) announcement.textContent = '';
      previousFocus = null;
    }
    if (window.__ftwUpdateBlocking) {
      reminder.hidden = true;
      if (announcement) announcement.textContent = '';
      return;
    }
    if (user === null) return;
    // 系统时钟回拨时重新计时，避免等待异常长的时间。
    if (now < lastActivity) lastActivity = now;
    if (!document.hidden && reminder.hidden && now - lastActivity >= IDLE_MS) {
      previousFocus = document.activeElement;
      reminder.hidden = false;
      if (announcement) announcement.textContent = '页面已超过 30 分钟无操作，建议保存后刷新。可选择立即刷新或暂不刷新。';
    }
  }

  function recordActivity(event) {
    // 后台轮询及代码派发的事件不能冒充用户操作。
    if (!event.isTrusted || document.hidden) return;
    // 先检查再重置：后台休眠恢复后的第一次操作不能吞掉到期提醒。
    checkIdle();
    if (trackedUser !== null && reminder.hidden) lastActivity = Date.now();
  }

  function dismissReminder() {
    const restoreFocus = reminder.contains(document.activeElement);
    reminder.hidden = true;
    if (announcement) announcement.textContent = '';
    lastActivity = Date.now();
    if (restoreFocus && previousFocus && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  // 仅焦点在提醒卡片内部时处理 Esc，不影响底层编辑弹窗的快捷键。
  reminder.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismissReminder();
    }
  });
  laterButton.addEventListener('click', dismissReminder);
  refreshButton.addEventListener('click', () => {
    if (window.__ftwUpdateBlocking) return;
    // 刷新会清掉未保存的表单，点击按钮后仍明确确认一次。
    if (window.confirm('刷新页面会丢失尚未保存的内容。请确认已保存，是否立即刷新？')) {
      window.location.reload();
    } else {
      dismissReminder();
    }
  });

  // 捕获阶段覆盖各模块；移动鼠标、点击、输入、滚轮和触屏均算操作。
  // 不监听 scroll：脚本自动滚动也会产生可信事件；手动滚动由滚轮、按键和指针/触屏覆盖。
  ['pointermove', 'pointerdown', 'click', 'keydown', 'input', 'wheel', 'touchstart', 'touchmove']
    .forEach(type => document.addEventListener(type, recordActivity, { capture: true, passive: true }));
  // 切回标签页/唤醒只检查，不视为新操作；后台按真实时间累计。
  document.addEventListener('visibilitychange', checkIdle);
  window.addEventListener('focus', checkIdle);
  window.addEventListener('pageshow', checkIdle);
  new MutationObserver(checkIdle).observe(loginOverlay, { attributes: true, attributeFilter: ['class'] });
  setInterval(checkIdle, CHECK_MS);
  checkIdle();
})();
