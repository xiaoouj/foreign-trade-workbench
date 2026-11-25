import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createChatSyncRoutes } from '../chat-sync.js';

function makeEnv() {
  const store = {
    clients: [],
    contacts: [],
    'chat-bindings': [],
    inquiries: [],
    comms: [],
    tasks: [],
  };
  const users = [
    { id: 'u_admin', username: 'admin', name: '管理员', role: 'admin' },
    { id: 'u_demo-sales', username: 'demosales', name: 'Example Sales Rep', role: 'sales' },
    { id: 'u_alice', username: 'alice', name: 'Alice', role: 'sales' },
  ];
  let seq = 1;
  const genId = () => 'id_' + (seq++);
  const isBusinessManager = (u) => !!u && ['admin', 'manager'].includes(u.role);
  const canAccessRecord = (u, ownerId) => !!u && (isBusinessManager(u) || (!!ownerId && ownerId === u.id));
  const visibleRecords = (rows, u) => rows.filter((r) => canAccessRecord(u, r.owner));
  const audits = [];

  const route = createChatSyncRoutes({
    read: async (base) => JSON.parse(JSON.stringify(store[base] || [])),
    write: async (base, rows) => { store[base] = JSON.parse(JSON.stringify(rows)); },
    body: async (req) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      return raw ? JSON.parse(raw) : {};
    },
    send: (res, code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    },
    users: () => users,
    resolveAiCfg: () => ({ baseUrl: 'http://127.0.0.1:1', model: 'none', apiKey: '', timeout: 300 }),
    joinUrl: (b, s) => b + s,
    aiHeaders: () => ({}),
    abortAfter: (ms) => AbortSignal.timeout(ms),
    isBusinessManager,
    canAccessRecord,
    visibleRecords,
    logAudit: (...args) => audits.push(args),
    genId,
    now: () => 1795420800000,
  });

  return { store, users, route, audits };
}

test('chat-sync: matching, owner attribution, unknown create, duplicate guard, dedup & RBAC', async (t) => {
  const { store, users, route } = makeEnv();
  let currentUser = users[0];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      const handled = await route(req, res, url, url.pathname, req.method, currentUser);
      if (!handled) { res.writeHead(404); res.end('not found'); }
    } catch (e) {
      res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = 'http://127.0.0.1:' + server.address().port;

  const call = async (p, method = 'GET', input = undefined, expect = 200) => {
    const res = await fetch(base + p, {
      method,
      headers: input !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    const json = await res.json();
    assert.equal(res.status, expect, `${method} ${p}: ${JSON.stringify(json)}`);
    return json;
  };

  // 1) Admin context lists all salespeople
  const ctx = await call('/api/chat-sync/context');
  assert.equal(ctx.isManager, true);
  assert.equal(ctx.salesUsers.length, 3);

  // 2) Unknown buyer -> unmatched, resolves owner "Example Sales Rep" -> u_demo-sales
  const buyer = {
    name: 'Example Buyer',
    company: 'Example Logistics Ltd',
    email: 'charles@example.test',
    country: '法国',
    countryCode: 'FR',
    owner: 'Example Sales Rep',
    customerId: 'ali_cust_001',
  };
  const messages = [
    { id: 'm_1', side: 'buyer', sender: 'Charles', sentAt: '2026-11-22 10:00:00', text: 'Need 2 chain conveyors 10m' },
    { id: 'm_2', side: 'seller', sender: 'Example Sales Rep', sentAt: '2026-11-22 10:05:00', text: 'Sure, USD 6200 FOB Shanghai' },
  ];
  const m1 = await call('/api/chat-sync/match', 'POST', {
    channel: 'alibaba', customerId: 'ali_cust_001', imInquiryId: '90000000001', buyer,
  });
  assert.equal(m1.matched, false);
  assert.equal(m1.resolvedOwner.owner, 'u_demo-sales');
  assert.equal(m1.resolvedOwner.matched, true);

  // 3) Analyze falls back cleanly when AI service is offline
  const an1 = await call('/api/chat-sync/analyze', 'POST', {
    channel: 'alibaba', imInquiryId: '90000000001', buyer, messages,
  });
  assert.equal(an1.aiFallback, true);
  assert.equal(an1.clientDraft.company, 'Example Logistics Ltd');
  assert.equal(an1.clientDraft.contactEmail, 'charles@example.test');

  // 4) Admin confirms 1-click create -> attributed to Example Sales Rep
  const c1 = await call('/api/chat-sync/commit', 'POST', {
    mode: 'create',
    channel: 'alibaba',
    customerId: 'ali_cust_001',
    imInquiryId: '90000000001',
    buyerOwnerHint: 'Example Sales Rep',
    buyer,
    clientDraft: an1.clientDraft,
    summary: '已报价10米链板输送机6200美金',
    messages,
    inquiry: { action: 'create', product: '链板输送机', expectedAmount: 6200, currency: 'USD', status: '已报价', nextFollowAt: '2026-11-26' },
    task: { create: true, action: '确认客户对运费反馈', dueDate: '2026-11-26' },
  });
  assert.equal(c1.ok, true);
  assert.equal(c1.client.owner, 'u_demo-sales');
  assert.equal(c1.inquiry.owner, 'u_demo-sales');
  assert.equal(c1.comm.owner, 'u_demo-sales');
  assert.equal(c1.task.owner, 'u_demo-sales');
  assert.equal(store.contacts.length, 1);

  // 5) Duplicate company guard returns 409 unless forceCreate
  const dup = await call('/api/chat-sync/commit', 'POST', {
    mode: 'create',
    channel: 'alibaba',
    customerId: 'ali_cust_999',
    buyer,
    clientDraft: an1.clientDraft,
    summary: '重复建档',
    messages,
  }, 409);
  assert.equal(dup.duplicateClient.id, c1.client.id);

  // 6) Subsequent match hits permanent binding & returns syncedMessageIds
  const m2 = await call('/api/chat-sync/match', 'POST', {
    channel: 'alibaba', customerId: 'ali_cust_001', imInquiryId: '90000000001', buyer: { customerId: 'ali_cust_001' },
  });
  assert.equal(m2.matched, true);
  assert.equal(m2.matchType, 'binding');
  assert.equal(m2.client.id, c1.client.id);
  assert.deepEqual(m2.syncedMessageIds, ['m_1', 'm_2']);
  assert.equal(m2.inquiries.length, 1);

  // 7) RBAC: Alice cannot match or bind 示例业务员's client
  currentUser = users[2];
  const aliceCtx = await call('/api/chat-sync/context');
  assert.equal(aliceCtx.isManager, false);
  assert.equal(aliceCtx.salesUsers.length, 1);
  const aliceMatch = await call('/api/chat-sync/match', 'POST', {
    channel: 'alibaba', customerId: 'ali_cust_001', buyer,
  });
  assert.equal(aliceMatch.matched, false);
  await call('/api/chat-sync/bind', 'POST', {
    channel: 'alibaba', clientId: c1.client.id, customerId: 'ali_cust_other',
  }, 403);

  // 8) 示例业务员 matches his bound customer & syncs new message m_3
  currentUser = users[1];
  const demoSalesMatch = await call('/api/chat-sync/match', 'POST', {
    channel: 'alibaba', customerId: 'ali_cust_001', buyer,
  });
  assert.equal(demoSalesMatch.matched, true);
  const c2 = await call('/api/chat-sync/commit', 'POST', {
    mode: 'sync',
    channel: 'alibaba',
    clientId: c1.client.id,
    customerId: 'ali_cust_001',
    imInquiryId: '90000000001',
    summary: '客户接受报价，准备确认付款方式',
    messages: [...messages, { id: 'm_3', side: 'buyer', sender: 'Charles', sentAt: '2026-11-23 15:00:00', text: 'Price is ok, send PI' }],
    inquiry: { action: 'update', inquiryId: c1.inquiry.id, status: '谈判中', nextFollowAt: '2026-11-25' },
  });
  assert.equal(c2.inquiry.status, '谈判中');
  assert.equal(c2.inquiry.followLog.length, 2);
  assert(c2.binding.syncedMessageIds.includes('m_3'));
});
