import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/idle-refresh.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const IDLE = 30 * 60 * 1000;

// Isolated clock and DOM: no business data, credentials, server changes, or real reloads.
function setup({ loggedIn = true, missing = false } = {}) {
  let now = 0;
  let reloads = 0;
  let confirmations = 0;
  let confirmResult = false;
  let observer;
  let interval;
  const documentListeners = new Map();
  const windowListeners = new Map();
  const elements = new Map();
  const document = {
    hidden: false,
    activeElement: null,
    getElementById: id => elements.get(id) || null,
    addEventListener(type, callback) { documentListeners.set(type, callback); }
  };
  function element(id) {
    const listeners = new Map();
    const classes = new Set();
    const el = {
      id, hidden: id === 'idleRefreshReminder', textContent: '', isConnected: true,
      value: '', listeners,
      classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value) },
      addEventListener(type, callback) { listeners.set(type, callback); },
      contains(target) { return target === this || (id === 'idleRefreshReminder' && ['idleRefreshLater', 'idleRefreshNow'].includes(target?.id)); },
      focus() { document.activeElement = this; }
    };
    elements.set(id, el);
    return el;
  }
  const card = element('idleRefreshReminder');
  const announcement = element('idleRefreshAnnouncement');
  const overlay = element('loginOverlay');
  const later = element('idleRefreshLater');
  const refresh = element('idleRefreshNow');
  const form = element('modalForm');
  const input = element('unsavedInput');
  form.value = 'existing editor DOM';
  input.value = 'unsaved customer details';
  document.activeElement = input;
  if (loggedIn) overlay.classList.add('hidden');
  if (missing) elements.delete('idleRefreshNow');
  const window = {
    addEventListener(type, callback) { windowListeners.set(type, callback); },
    confirm() { confirmations++; return confirmResult; },
    location: { reload() { reloads++; } }
  };
  const context = vm.createContext({
    document, window, Date: { now: () => now },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    setInterval(callback, delay) { assert.equal(delay, 15000); interval = callback; }
  });
  vm.runInContext(`let currentUser = ${loggedIn ? '{ id: "user-1" }' : 'null'};`, context);
  vm.runInContext(source, context);
  return {
    card, announcement, overlay, later, refresh, form, input, document, documentListeners,
    tick(ms) { now += ms; interval?.(); },
    jump(ms) { now += ms; },
    event(type, { trusted = true } = {}) { documentListeners.get(type)?.({ isTrusted: trusted }); },
    windowEvent(type) { windowListeners.get(type)?.(); },
    visible(value) { document.hidden = !value; documentListeners.get('visibilitychange')?.(); },
    click(el) { document.activeElement = el; el.listeners.get('click')?.({ isTrusted: true }); },
    login(id = 'user-1') { vm.runInContext(`currentUser = { id: ${JSON.stringify(id)} };`, context); overlay.classList.add('hidden'); observer(); },
    expire() { overlay.classList.remove('hidden'); observer(); },
    setConfirmation(value) { confirmResult = value; },
    get reloads() { return reloads; }, get confirmations() { return confirmations; }
  };
}

test('integration: unique IDs, 30 minute threshold, versioned script and CSS', () => {
  for (const id of ['idleRefreshReminder', 'idleRefreshAnnouncement', 'idleRefreshTitle', 'idleRefreshLater', 'idleRefreshNow']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  }
  assert.match(html, /styles\.css\?v=[a-zA-Z0-9_-]+/);
  assert.match(html, /idle-refresh\.js\?v=20260921a/);
  assert.ok(html.indexOf('idle-refresh.js?v=') > html.indexOf('app.js?v='));
  assert.match(source, /const IDLE_MS = 30 \* 60 \* 1000/);
});

test('shows at 30 minutes, never before, and never automatically reloads', () => {
  const h = setup();
  h.tick(IDLE - 1); assert.equal(h.card.hidden, true);
  h.tick(1); assert.equal(h.card.hidden, false);
  h.tick(IDLE * 4); assert.equal(h.reloads, 0); assert.equal(h.confirmations, 0);
});

for (const type of ['pointermove', 'pointerdown', 'click', 'keydown', 'input', 'wheel', 'touchstart', 'touchmove']) {
  test(`trusted ${type} resets inactivity`, () => {
    const h = setup();
    h.tick(IDLE - 1); h.event(type);
    h.tick(IDLE - 1); assert.equal(h.card.hidden, true);
    h.tick(1); assert.equal(h.card.hidden, false);
  });
}

test('synthetic activity and automatic scrolling do not postpone reminder', () => {
  const h = setup();
  h.tick(IDLE - 1);
  h.event('input', { trusted: false }); h.event('scroll');
  assert.equal(h.documentListeners.has('scroll'), false);
  h.tick(1); assert.equal(h.card.hidden, false);
});

test('staying logged out does not show a reminder; login starts a new period', () => {
  const h = setup({ loggedIn: false });
  h.tick(IDLE * 3); assert.equal(h.card.hidden, true);
  h.login(); h.tick(IDLE - 1); assert.equal(h.card.hidden, true);
  h.tick(1); assert.equal(h.card.hidden, false);
});

test('session expiry hides reminder; switching users resets clock', () => {
  const h = setup(); h.tick(IDLE); h.expire();
  assert.equal(h.card.hidden, true); assert.equal(h.announcement.textContent, '');
  h.login(); h.tick(IDLE - 1); h.login('user-2');
  h.tick(IDLE - 1); assert.equal(h.card.hidden, true);
  h.tick(1); assert.equal(h.card.hidden, false);
});

test('background stays quiet and foreground checks elapsed wall-clock time', () => {
  const h = setup(); h.visible(false); h.tick(IDLE * 2);
  assert.equal(h.card.hidden, true);
  h.visible(true); assert.equal(h.card.hidden, false);
});

test('activity in a hidden document cannot reset clock', () => {
  const h = setup(); h.visible(false); h.tick(IDLE - 1); h.event('pointermove');
  h.tick(1); h.visible(true); assert.equal(h.card.hidden, false);
});

test('first interaction after suspended timers cannot swallow an overdue reminder', () => {
  const h = setup(); h.jump(IDLE + 1); h.event('pointermove');
  assert.equal(h.card.hidden, false);
});

for (const event of ['focus', 'pageshow']) {
  test(`${event} checks overdue time without resetting it`, () => {
    const h = setup(); h.jump(IDLE + 1); h.windowEvent(event);
    assert.equal(h.card.hidden, false);
  });
}

test('dismissing starts another full 30 minutes and restores editor focus', () => {
  const h = setup(); h.tick(IDLE); h.click(h.later);
  assert.equal(h.card.hidden, true); assert.equal(h.document.activeElement, h.input);
  assert.equal(h.announcement.textContent, '');
  h.tick(IDLE - 1); assert.equal(h.card.hidden, true);
  h.tick(1); assert.equal(h.card.hidden, false);
});

test('reminder preserves unsaved content and does not steal focus or duplicate DOM', () => {
  const h = setup(); const form = h.form;
  h.tick(IDLE); h.tick(IDLE); h.event('keydown');
  assert.equal(h.card.hidden, false); assert.equal(h.form, form);
  assert.equal(h.input.value, 'unsaved customer details');
  assert.equal(h.document.activeElement, h.input);
  assert.ok(h.announcement.textContent.includes('30'));
});

test('explicit refresh requires confirmation; cancelling keeps content and restarts clock', () => {
  const h = setup(); h.tick(IDLE); h.click(h.refresh);
  assert.equal(h.confirmations, 1); assert.equal(h.reloads, 0);
  assert.equal(h.card.hidden, true); assert.equal(h.input.value, 'unsaved customer details');
  h.tick(IDLE); h.setConfirmation(true); h.click(h.refresh);
  assert.equal(h.confirmations, 2); assert.equal(h.reloads, 1);
});

test('Escape inside reminder dismisses it without reaching editor shortcuts', () => {
  const h = setup(); h.tick(IDLE); let stopped = false;
  h.card.listeners.get('keydown')({ key: 'Escape', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(h.card.hidden, true);
});

test('backward system clock adjustment recovers normally', () => {
  const h = setup(); h.tick(-100000); h.tick(IDLE - 1);
  assert.equal(h.card.hidden, true); h.tick(1); assert.equal(h.card.hidden, false);
});

test('missing optional page integration does not crash or install timers', () => {
  const h = setup({ missing: true }); h.tick(IDLE * 2);
  assert.equal(h.card.hidden, true); assert.equal(h.reloads, 0);
});

if (process.env.CRM_VERIFY_URL) {
  test('live service returns the exact updated HTML, stylesheet and script', async () => {
    for (const name of ['index.html', 'styles.css', 'idle-refresh.js']) {
      const response = await fetch(new URL(name, process.env.CRM_VERIFY_URL), { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, name);
      const served = (await response.text()).replace(/\n<script data-ftw-build>window\.__FTW_BUILD__=[^<]*;<\/script>/, '');
      const local = readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
      assert.equal(served, local, `${name}: deployed content mismatch`);
    }
  });
}
