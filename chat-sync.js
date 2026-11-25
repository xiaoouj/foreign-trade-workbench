/**
 * 浏览器扩展聊天同步与客户匹配路由（/api/chat-sync/*）
 * 支持阿里国际站（后续可扩展 WhatsApp Web）对话抓取、客户精确绑定、
 * AI 进度小结提炼、未知客户一键建档及按业务员归属落库。
 */
import crypto from 'node:crypto';

const BINDINGS_BASE = 'chat-bindings';
const INQ_STATUSES = new Set(['新询盘', '已报价', '等回复', '谈判中', '成交', '输单', '暂缓', '无效']);
const COUNTRY_CODE_MAP = {
  US: '美国', CA: '加拿大', GB: '英国', UK: '英国', DE: '德国', FR: '法国',
  IT: '意大利', ES: '西班牙', PT: '葡萄牙', NL: '荷兰', BE: '比利时', CH: '瑞士',
  AT: '奥地利', SE: '瑞典', NO: '挪威', DK: '丹麦', FI: '芬兰', PL: '波兰',
  CZ: '捷克', RO: '罗马尼亚', GR: '希腊', UA: '乌克兰', RU: '俄罗斯', TR: '土耳其',
  IL: '以色列', SA: '沙特阿拉伯', AE: '阿联酋', QA: '卡塔尔', KW: '科威特', OM: '阿曼',
  JO: '约旦', IQ: '伊拉克', IR: '伊朗', EG: '埃及', MA: '摩洛哥', DZ: '阿尔及利亚',
  ZA: '南非', NG: '尼日利亚', KE: '肯尼亚', GH: '加纳', ET: '埃塞俄比亚', TZ: '坦桑尼亚',
  IN: '印度', PK: '巴基斯坦', BD: '孟加拉国', LK: '斯里兰卡', ID: '印度尼西亚',
  MY: '马来西亚', SG: '新加坡', TH: '泰国', VN: '越南', PH: '菲律宾', KH: '柬埔寨',
  MM: '缅甸', KR: '韩国', JP: '日本', AU: '澳大利亚', NZ: '新西兰', BR: '巴西',
  MX: '墨西哥', AR: '阿根廷', CL: '智利', CO: '哥伦比亚', PE: '秘鲁', EC: '厄瓜多尔',
  CN: '中国', HK: '中国香港', TW: '中国台湾',
};

const normText = (v) => String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ');
const normKey = (v) => normText(v).toLowerCase();
const compactKey = (v) => normKey(v).replace(/[\s._-]+/g, '');
const digitsOf = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const isMasked = (v) => /\*{2,}/.test(String(v || ''));
const shanghaiToday = (ts = Date.now()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(ts));

function safeErr(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalizeEmail(v) {
  const s = normKey(v);
  if (!s || isMasked(s) || !s.includes('@')) return '';
  return s;
}

function normalizeCountry(country, countryCode) {
  const c = normText(country);
  if (c) return c;
  const code = String(countryCode || '').trim().toUpperCase();
  return COUNTRY_CODE_MAP[code] || code || '';
}

function validDateStr(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const ts = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(ts) || new Date(ts).toISOString().slice(0, 10) !== s) return '';
  return s;
}

function parseJsonSafe(raw) {
  const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(text); } catch {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
    }
    return null;
  }
}

function formatMessages(messages, limit = 50) {
  const list = Array.isArray(messages) ? messages.filter((m) => m && m.side !== 'system' && normText(m.text)) : [];
  return list.slice(-limit).map((m) => {
    const role = m.side === 'buyer' ? '客户' : m.side === 'seller' ? '我方' : '其他';
    const who = normText(m.sender) ? `${role}(${normText(m.sender)})` : role;
    const t = normText(m.sentAt);
    const body = String(m.text || '').trim();
    const tr = normText(m.translation);
    const trPart = tr && tr !== body ? ` [译: ${tr}]` : '';
    return `${t ? `[${t}] ` : ''}${who}: ${body}${trPart}`;
  }).join('\n');
}

function resolveTargetOwner(user, allUsers, isManager, requestedOwnerId, ownerHint) {
  const safeUsers = allUsers.map((u) => ({
    id: u.id, username: u.username, name: u.name || u.username, role: u.role || 'sales',
  }));
  if (!isManager) {
    return { owner: user.id, ownerName: user.name || user.username, matched: true, locked: true, matchedFrom: '' };
  }
  if (requestedOwnerId) {
    const explicit = safeUsers.find((u) => u.id === requestedOwnerId);
    if (!explicit) throw safeErr('指定的跟进业务员不存在', 400);
    return { owner: explicit.id, ownerName: explicit.name, matched: true, locked: false, matchedFrom: 'manual' };
  }
  const hint = normKey(ownerHint);
  const hintCompact = compactKey(ownerHint);
  if (hint) {
    const exact = safeUsers.filter((u) => normKey(u.name) === hint || normKey(u.username) === hint);
    if (exact.length === 1) return { owner: exact[0].id, ownerName: exact[0].name, matched: true, locked: false, matchedFrom: ownerHint };
    const comp = safeUsers.filter((u) => compactKey(u.name) === hintCompact || compactKey(u.username) === hintCompact);
    if (comp.length === 1) return { owner: comp[0].id, ownerName: comp[0].name, matched: true, locked: false, matchedFrom: ownerHint };
    if (hintCompact.length >= 3) {
      const partial = safeUsers.filter((u) => compactKey(u.name).includes(hintCompact) || compactKey(u.username).includes(hintCompact) || hintCompact.includes(compactKey(u.username)));
      if (partial.length === 1) return { owner: partial[0].id, ownerName: partial[0].name, matched: true, locked: false, matchedFrom: ownerHint };
    }
  }
  return { owner: user.id, ownerName: user.name || user.username, matched: false, locked: false, matchedFrom: ownerHint || '' };
}

function phoneSuffixMatch(a, b) {
  const da = digitsOf(a), db = digitsOf(b);
  if (da.length < 7 || db.length < 7) return false;
  if (da === db) return true;
  const len = Math.min(8, da.length, db.length);
  return da.slice(-len) === db.slice(-len);
}

function channelLabel(ch) {
  if (ch === 'whatsapp') return 'WhatsApp';
  if (ch === 'alibaba') return '阿里巴巴';
  return '其他';
}

function findBindingRecord(bindings, channel, customerId, imInquiryId, phone) {
  const cid = normText(customerId);
  const inqId = normText(imInquiryId);
  const ph = digitsOf(phone);
  if (cid) {
    const hit = bindings.find((b) => b.channel === channel && b.externalType === 'customerId' && b.externalKey === cid);
    if (hit) return hit;
  }
  if (inqId) {
    const hit = bindings.find((b) => b.channel === channel && (
      (b.externalType === 'imInquiryId' && b.externalKey === inqId) ||
      (Array.isArray(b.imInquiryIds) && b.imInquiryIds.includes(inqId))
    ));
    if (hit) return hit;
  }
  if (ph.length >= 7) {
    const hit = bindings.find((b) => b.channel === channel && b.externalType === 'phone' && phoneSuffixMatch(b.externalKey, ph));
    if (hit) return hit;
  }
  return null;
}

function matchClientAndCandidates({ channel, customerId, imInquiryId, buyer = {} }, visClients, visContacts, visBindings) {
  const clientById = new Map(visClients.map((c) => [c.id, c]));
  const binding = findBindingRecord(visBindings, channel, customerId, imInquiryId, buyer.phone);
  if (binding && clientById.has(binding.clientId)) {
    return { matched: true, matchType: 'binding', client: clientById.get(binding.clientId), binding, candidates: [] };
  }

  const email = normalizeEmail(buyer.email);
  const companyKey = !isMasked(buyer.company) ? normKey(buyer.company) : '';
  const nameKey = !isMasked(buyer.name) ? normKey(buyer.name) : '';
  const phone = digitsOf(buyer.phone);

  if (email) {
    const emailHits = new Set();
    for (const c of visClients) {
      if (normalizeEmail(c.contactEmail) === email) emailHits.add(c.id);
    }
    for (const ct of visContacts) {
      if (normalizeEmail(ct.email) === email && clientById.has(ct.clientId)) emailHits.add(ct.clientId);
    }
    if (emailHits.size === 1) {
      const id = [...emailHits][0];
      return { matched: true, matchType: 'email', client: clientById.get(id), binding: null, candidates: [] };
    }
  }

  if (phone.length >= 7) {
    const phoneHits = new Set();
    for (const c of visClients) {
      if (phoneSuffixMatch(c.contactPhone, phone) || phoneSuffixMatch(c.waPhone, phone) || phoneSuffixMatch(c.whatsapp, phone)) phoneHits.add(c.id);
    }
    for (const ct of visContacts) {
      if (phoneSuffixMatch(ct.phone, phone) && clientById.has(ct.clientId)) phoneHits.add(ct.clientId);
    }
    if (phoneHits.size === 1) {
      const id = [...phoneHits][0];
      return { matched: true, matchType: 'phone', client: clientById.get(id), binding: null, candidates: [] };
    }
  }

  if (companyKey && companyKey.length >= 2) {
    const compHits = visClients.filter((c) => normKey(c.company) === companyKey);
    if (compHits.length === 1) {
      return { matched: true, matchType: 'company', client: compHits[0], binding: null, candidates: [] };
    }
  }

  // 模糊候选排名
  const domain = email ? email.split('@')[1] : '';
  const countryKey = normKey(normalizeCountry(buyer.country, buyer.countryCode));
  const scored = [];
  for (const c of visClients) {
    let score = 0;
    const cc = normKey(c.company);
    const cn = normKey(c.contactName);
    const ce = normalizeEmail(c.contactEmail);
    if (email && ce === email) score += 80;
    else if (domain && ce.endsWith('@' + domain)) score += 40;
    if (companyKey.length >= 2 && cc) {
      if (cc === companyKey) score += 70;
      else if (cc.includes(companyKey) || companyKey.includes(cc)) score += 35;
    }
    if (nameKey.length >= 2 && cn && (cn === nameKey || cn.includes(nameKey) || nameKey.includes(cn))) score += 25;
    if (countryKey && normKey(c.country) === countryKey) score += 10;
    if (score > 0) scored.push({ client: c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    matched: false,
    matchType: '',
    client: null,
    binding: null,
    candidates: scored.slice(0, 6).map((x) => ({
      id: x.client.id, company: x.client.company, country: x.client.country || '',
      contactName: x.client.contactName || '', ownerName: x.client.ownerName || '', score: x.score,
    })),
  };
}

function collectSyncedIds(bindings, channel, customerId, imInquiryId, clientId) {
  const set = new Set();
  for (const b of bindings) {
    if (b.channel !== channel) continue;
    const hit = (customerId && b.externalType === 'customerId' && b.externalKey === customerId)
      || (imInquiryId && ((b.externalType === 'imInquiryId' && b.externalKey === imInquiryId) || (Array.isArray(b.imInquiryIds) && b.imInquiryIds.includes(imInquiryId))))
      || (clientId && b.clientId === clientId);
    if (!hit) continue;
    if (Array.isArray(b.syncedMessageIds)) b.syncedMessageIds.forEach((id) => set.add(id));
  }
  return set;
}

function upsertBinding(bindings, { channel, customerId, imInquiryId, client, owner, ownerName, buyer, messageIds, summary, now, genId }) {
  const externalType = customerId ? 'customerId' : (imInquiryId ? 'imInquiryId' : (digitsOf(buyer?.phone) ? 'phone' : ''));
  const externalKey = customerId ? normText(customerId) : (imInquiryId ? normText(imInquiryId) : digitsOf(buyer?.phone));
  if (!externalType || !externalKey) return null;

  let b = bindings.find((x) => x.channel === channel && x.externalType === externalType && x.externalKey === externalKey);
  const newIds = Array.isArray(messageIds) ? messageIds.map((x) => normText(x)).filter(Boolean) : [];
  if (!b) {
    b = {
      id: 'cb_' + genId(),
      channel,
      externalType,
      externalKey,
      clientId: client.id,
      clientName: client.company,
      imInquiryIds: imInquiryId ? [normText(imInquiryId)] : [],
      syncedMessageIds: newIds.slice(-500),
      owner,
      ownerName,
      meta: {
        buyerName: normText(buyer?.name),
        buyerCompany: normText(buyer?.company),
        buyerEmail: normalizeEmail(buyer?.email),
      },
      lastSummary: normText(summary).slice(0, 300),
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    bindings.push(b);
  } else {
    b.clientId = client.id;
    b.clientName = client.company;
    b.owner = owner;
    b.ownerName = ownerName;
    if (imInquiryId) {
      const set = new Set([...(Array.isArray(b.imInquiryIds) ? b.imInquiryIds : []), normText(imInquiryId)]);
      b.imInquiryIds = [...set].slice(-50);
    }
    if (newIds.length) {
      const merged = new Set([...(Array.isArray(b.syncedMessageIds) ? b.syncedMessageIds : []), ...newIds]);
      b.syncedMessageIds = [...merged].slice(-500);
    }
    if (summary) b.lastSummary = normText(summary).slice(0, 300);
    b.lastSyncedAt = now;
    b.updatedAt = now;
  }
  return b;
}

export function createChatSyncRoutes({
  read, write, body, send, users, resolveAiCfg, joinUrl, aiHeaders, abortAfter,
  isBusinessManager, canAccessRecord, visibleRecords, logAudit, genId, now = Date.now,
}) {
  return async function route(req, res, url, p, method, user) {
    if (!p.startsWith('/api/chat-sync/')) return false;
    const isMgr = isBusinessManager(user);

    // 1) 上下文：当前登录人、可选业务员列表、可见客户列表
    if (p === '/api/chat-sync/context' && method === 'GET') {
      const allUsers = users();
      const salesUsers = isMgr
        ? allUsers.map((u) => ({ id: u.id, username: u.username, name: u.name || u.username, role: u.role || 'sales' }))
        : [{ id: user.id, username: user.username, name: user.name || user.username, role: user.role || 'sales' }];
      const clients = visibleRecords(await read('clients'), user).map((c) => ({
        id: c.id,
        company: c.company || '',
        country: c.country || '',
        contactName: c.contactName || '',
        contactEmail: c.contactEmail || '',
        contactPhone: c.contactPhone || '',
        stage: c.stage || '',
        owner: c.owner || '',
        ownerName: c.ownerName || '',
      }));
      send(res, 200, { user, isManager: isMgr, salesUsers, clients });
      return true;
    }

    // 2) 匹配当前聊天会话对应的客户、进行中商机、最近沟通与去重消息 ID
    if (p === '/api/chat-sync/match' && method === 'POST') {
      const input = await body(req);
      const channel = normKey(input.channel || 'alibaba') || 'alibaba';
      const customerId = normText(input.customerId || input.buyer?.customerId);
      const imInquiryId = normText(input.imInquiryId);
      const buyer = input.buyer && typeof input.buyer === 'object' ? input.buyer : {};

      const [clients, contacts, bindings, inquiries, comms] = await Promise.all([
        read('clients'), read('contacts'), read(BINDINGS_BASE), read('inquiries'), read('comms'),
      ]);
      const visClients = visibleRecords(clients, user);
      const visContacts = visibleRecords(contacts, user);
      const visBindings = visibleRecords(bindings, user);

      const match = matchClientAndCandidates({ channel, customerId, imInquiryId, buyer }, visClients, visContacts, visBindings);
      let resolvedOwner = resolveTargetOwner(user, users(), isMgr, '', buyer.owner || '');
      if (isMgr && !resolvedOwner.matched && match.client?.owner) {
        const clientOwner = users().find((u) => u.id === match.client.owner);
        if (clientOwner) {
          resolvedOwner = { owner: clientOwner.id, ownerName: clientOwner.name || clientOwner.username, matched: true, locked: false, matchedFrom: 'client' };
        }
      }
      const syncedIds = collectSyncedIds(visBindings, channel, customerId, imInquiryId, match.client?.id);

      let clientInquiries = [];
      let recentComms = [];
      if (match.client) {
        const cid = match.client.id;
        const cNameKey = normKey(match.client.company);
        clientInquiries = visibleRecords(inquiries, user)
          .filter((q) => q.clientId === cid || (!q.clientId && cNameKey && normKey(q.clientName) === cNameKey))
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
          .slice(0, 10)
          .map((q) => ({
            id: q.id, product: q.product || '', model: q.model || '', status: q.status || '新询盘',
            expectedAmount: q.expectedAmount ?? null, currency: q.currency || 'USD',
            receivedAt: q.receivedAt || '', nextFollowAt: q.nextFollowAt || '',
            owner: q.owner || '', ownerName: q.ownerName || '',
          }));
        recentComms = visibleRecords(comms, user)
          .filter((cm) => cm.clientId === cid || (!cm.clientId && cNameKey && normKey(cm.clientName) === cNameKey))
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
          .slice(0, 3)
          .map((cm) => ({
            id: cm.id, date: cm.date || '', channel: cm.channel || '',
            summary: cm.summary || '', ownerName: cm.ownerName || '',
          }));
      }

      send(res, 200, {
        matched: match.matched,
        matchType: match.matchType,
        client: match.client ? {
          id: match.client.id, company: match.client.company, country: match.client.country || '',
          contactName: match.client.contactName || '', contactEmail: match.client.contactEmail || '',
          contactPhone: match.client.contactPhone || '', stage: match.client.stage || '',
          owner: match.client.owner || '', ownerName: match.client.ownerName || '',
        } : null,
        candidates: match.candidates,
        inquiries: clientInquiries,
        recentComms,
        syncedMessageIds: [...syncedIds],
        resolvedOwner,
      });
      return true;
    }

    // 3) 手动将外部会话绑定到工作台已有客户
    if (p === '/api/chat-sync/bind' && method === 'POST') {
      const input = await body(req);
      const channel = normKey(input.channel || 'alibaba') || 'alibaba';
      const clientId = normText(input.clientId);
      if (!clientId) throw safeErr('请选择要关联的客户');

      const clients = await read('clients');
      const idx = clients.findIndex((c) => c.id === clientId);
      if (idx < 0) throw safeErr('客户不存在', 404);
      if (!canAccessRecord(user, clients[idx].owner)) throw safeErr('无权关联该客户', 403);

      const client = clients[idx];
      const buyer = input.buyer && typeof input.buyer === 'object' ? input.buyer : {};
      const email = normalizeEmail(buyer.email);
      const country = normalizeCountry(buyer.country, buyer.countryCode);
      const stamp = now();
      let clientChanged = false;
      if (!client.contactEmail && email) { client.contactEmail = email; clientChanged = true; }
      if (!client.country && country) { client.country = country; clientChanged = true; }
      if (!client.contactName && buyer.name && !isMasked(buyer.name)) { client.contactName = normText(buyer.name); clientChanged = true; }
      if (clientChanged) {
        client.updatedAt = stamp;
        await write('clients', clients);
      }

      const bindings = await read(BINDINGS_BASE);
      const binding = upsertBinding(bindings, {
        channel,
        customerId: input.customerId || buyer.customerId,
        imInquiryId: input.imInquiryId,
        client,
        owner: client.owner || user.id,
        ownerName: client.ownerName || user.name || user.username,
        buyer,
        messageIds: [],
        now: stamp,
        genId,
      });
      if (!binding) throw safeErr('当前页面缺少可绑定的外部账号标识（customerId 或询盘 ID）');
      await write(BINDINGS_BASE, bindings);
      logAudit(user, 'update', 'chat-bindings', binding.id, `绑定 ${channel} 会话到 ${client.company}`);
      send(res, 200, { ok: true, client, binding });
      return true;
    }

    // 4) AI 提取进度小结与建档字段（不改数据库）
    if (p === '/api/chat-sync/analyze' && method === 'POST') {
      const input = await body(req);
      const buyer = input.buyer && typeof input.buyer === 'object' ? input.buyer : {};
      const messages = Array.isArray(input.messages) ? input.messages : [];
      const syncedSet = new Set(Array.isArray(input.syncedMessageIds) ? input.syncedMessageIds : []);
      const validMsgs = messages.filter((m) => m && m.side !== 'system' && normText(m.text));
      const newMsgs = validMsgs.filter((m) => m.id && !syncedSet.has(m.id));
      const targetMsgs = (input.onlyUnsynced !== false && newMsgs.length > 0) ? newMsgs : validMsgs.slice(-30);
      const transcript = formatMessages(targetMsgs, 45);

      const fallbackCompany = !isMasked(buyer.company) ? normText(buyer.company) : '';
      const fallbackName = !isMasked(buyer.name) ? normText(buyer.name) : '';
      const fallbackCountry = normalizeCountry(buyer.country, buyer.countryCode);
      const fallbackEmail = normalizeEmail(buyer.email);
      const lastMsg = targetMsgs[targetMsgs.length - 1];
      const fallbackSummary = lastMsg
        ? `${lastMsg.side === 'buyer' ? '客户咨询/反馈：' : '我方已回复：'}${normText(lastMsg.translation || lastMsg.text).slice(0, 32)}`
        : '阿里客服沟通记录';

      const defaultDraft = {
        summary: fallbackSummary.slice(0, 50),
        clientDraft: {
          company: fallbackCompany || fallbackName || '',
          country: fallbackCountry,
          contactName: fallbackName,
          contactEmail: fallbackEmail,
          contactPhone: normText(buyer.phone),
        },
        inquiryDraft: {
          product: '',
          model: '',
          expectedAmount: null,
          currency: 'USD',
          status: '新询盘',
          nextFollowAt: '',
        },
        taskDraft: { action: '', dueDate: '' },
        replyDraft: '',
        analyzedMessageCount: targetMsgs.length,
        newMessageCount: newMsgs.length,
      };

      if (!transcript) {
        send(res, 200, { ...defaultDraft, aiFallback: true, aiError: '当前页面没有可分析的对话文本' });
        return true;
      }

      const cfg = resolveAiCfg({});
      const today = shanghaiToday(now());
      const sys = '你是中国机械出口公司（外贸工作台 / 本公司）的外贸业务助理。'
        + '请阅读阿里国际站/外贸聊天记录，只返回合法 JSON（不要解释或 markdown 围栏）。格式：\n'
        + '{"summary":"不超过45字简体中文进度小结，写清客户核心需求/卡点/当前进度",\n'
        + '"clientDraft":{"company":"客户公司名(未知留空)","country":"中文国家名","contactName":"","contactEmail":"","contactPhone":""},\n'
        + '"inquiryDraft":{"product":"需求产品","model":"型号规格简述","expectedAmount":null,"currency":"USD","status":"新询盘/已报价/等回复/谈判中/成交/输单/暂缓/无效之一","nextFollowAt":"YYYY-MM-DD或空"},\n'
        + '"taskDraft":{"action":"下一步待办(没有就空)","dueDate":"YYYY-MM-DD或空"},\n'
        + '"replyDraft":"一条简短专业的英文回复建议"}\n'
        + `今天是 ${today}。不得编造未出现的金额、邮箱或电话；金额未知填 null。`;
      const userPrompt = `已知买家信息：${JSON.stringify({
        name: fallbackName, company: fallbackCompany, country: fallbackCountry,
        email: fallbackEmail, tags: buyer.tags || [],
      })}\n\n聊天记录：\n${transcript.slice(0, 10000)}`;

      try {
        const upstream = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiHeaders(cfg) },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'system', content: sys }, { role: 'user', content: userPrompt }],
            temperature: 0.2,
            stream: false,
            response_format: { type: 'json_object' },
            reasoning_effort: 'none',
          }),
          signal: abortAfter(Math.min(Number(cfg.timeout) || 60000, 60000)),
        });
        if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
        const json = await upstream.json();
        const rawText = json?.choices?.[0]?.message?.content || '';
        const parsed = parseJsonSafe(rawText);
        if (!parsed) throw new Error('AI 未返回有效 JSON');

        const cd = parsed.clientDraft || {};
        const iq = parsed.inquiryDraft || {};
        const tk = parsed.taskDraft || {};
        send(res, 200, {
          summary: normText(parsed.summary) || defaultDraft.summary,
          clientDraft: {
            company: normText(cd.company) || defaultDraft.clientDraft.company,
            country: normText(cd.country) || defaultDraft.clientDraft.country,
            contactName: normText(cd.contactName) || defaultDraft.clientDraft.contactName,
            contactEmail: normalizeEmail(cd.contactEmail) || defaultDraft.clientDraft.contactEmail,
            contactPhone: normText(cd.contactPhone) || defaultDraft.clientDraft.contactPhone,
          },
          inquiryDraft: {
            product: normText(iq.product),
            model: normText(iq.model),
            expectedAmount: typeof iq.expectedAmount === 'number' && Number.isFinite(iq.expectedAmount) && iq.expectedAmount >= 0 ? iq.expectedAmount : null,
            currency: normText(iq.currency).toUpperCase().slice(0, 3) || 'USD',
            status: INQ_STATUSES.has(iq.status) ? iq.status : '新询盘',
            nextFollowAt: validDateStr(iq.nextFollowAt),
          },
          taskDraft: {
            action: normText(tk.action),
            dueDate: validDateStr(tk.dueDate),
          },
          replyDraft: String(parsed.replyDraft || '').trim(),
          analyzedMessageCount: targetMsgs.length,
          newMessageCount: newMsgs.length,
          aiFallback: false,
        });
      } catch (err) {
        send(res, 200, {
          ...defaultDraft,
          aiFallback: true,
          aiError: err && err.message ? err.message : String(err),
        });
      }
      return true;
    }

    // 5) 提交业务员确认的结果：建档 / 更新客户 + 绑定 + 记沟通小结 + 更新/新建商机 + 建任务
    if (p === '/api/chat-sync/commit' && method === 'POST') {
      const input = await body(req);
      const channel = normKey(input.channel || 'alibaba') || 'alibaba';
      const mode = input.mode === 'create' ? 'create' : 'sync';
      const stamp = now();
      const today = shanghaiToday(stamp);
      const buyer = input.buyer && typeof input.buyer === 'object' ? input.buyer : {};
      let target = resolveTargetOwner(user, users(), isMgr, input.ownerId, input.buyerOwnerHint || buyer.owner);

      const [clients, contacts, bindings, inquiries, comms, tasks] = await Promise.all([
        read('clients'), read('contacts'), read(BINDINGS_BASE), read('inquiries'), read('comms'), read('tasks'),
      ]);

      let client = null;
      let clientsDirty = false;
      let contactsDirty = false;

      if (mode === 'create') {
        const cd = input.clientDraft && typeof input.clientDraft === 'object' ? input.clientDraft : {};
        const company = normText(cd.company || buyer.company || cd.contactName || buyer.name);
        if (!company || company.length > 300) throw safeErr('请填写有效的客户公司/名称');
        const email = normalizeEmail(cd.contactEmail || buyer.email);
        const country = normalizeCountry(cd.country || buyer.country, buyer.countryCode);
        const contactName = normText(cd.contactName || (!isMasked(buyer.name) ? buyer.name : ''));
        const contactPhone = normText(cd.contactPhone || buyer.phone);

        if (!input.forceCreate) {
          const vis = visibleRecords(clients, user);
          const dup = vis.find((c) => normKey(c.company) === normKey(company) || (email && normalizeEmail(c.contactEmail) === email));
          if (dup) {
            send(res, 409, {
              error: `工作台已有相似客户「${dup.company}」（跟进人：${dup.ownerName || '未分配'}）`,
              duplicateClient: { id: dup.id, company: dup.company, ownerName: dup.ownerName || '' },
            });
            return true;
          }
        }

        client = {
          id: genId(),
          company,
          country,
          contactName,
          contactEmail: email,
          contactPhone,
          stage: 'C',
          source: channelLabel(channel),
          annualValue: 0,
          nextFollowUp: validDateStr(input.inquiry?.nextFollowAt || ''),
          lastFollowAt: today,
          notes: normText(cd.notes),
          owner: target.owner,
          ownerName: target.ownerName,
          createdAt: stamp,
          updatedAt: stamp,
        };
        clients.push(client);
        clientsDirty = true;

        if (contactName || email || contactPhone) {
          contacts.push({
            id: genId(),
            clientId: client.id,
            name: contactName || email || contactPhone,
            role: '采购',
            title: '',
            phone: contactPhone,
            email,
            isPrimary: true,
            notes: '',
            owner: target.owner,
            createdAt: stamp,
            updatedAt: stamp,
          });
          contactsDirty = true;
        }
      } else {
        const clientId = normText(input.clientId);
        const idx = clients.findIndex((c) => c.id === clientId);
        if (idx < 0) throw safeErr('关联的客户不存在', 404);
        if (!canAccessRecord(user, clients[idx].owner)) throw safeErr('无权操作该客户', 403);
        client = clients[idx];
        if (isMgr && !input.ownerId && !target.matched && client.owner) {
          const clientOwner = users().find((u) => u.id === client.owner);
          if (clientOwner) target = { owner: clientOwner.id, ownerName: clientOwner.name || clientOwner.username, matched: true, locked: false, matchedFrom: 'client' };
        }
        const cd = input.clientDraft && typeof input.clientDraft === 'object' ? input.clientDraft : {};
        const email = normalizeEmail(cd.contactEmail || buyer.email);
        const country = normalizeCountry(cd.country || buyer.country, buyer.countryCode);
        const contactName = normText(cd.contactName || (!isMasked(buyer.name) ? buyer.name : ''));
        const contactPhone = normText(cd.contactPhone || buyer.phone);
        if (!client.contactEmail && email) client.contactEmail = email;
        if (!client.country && country) client.country = country;
        if (!client.contactName && contactName) client.contactName = contactName;
        if (!client.contactPhone && contactPhone) client.contactPhone = contactPhone;
        const nf = validDateStr(input.inquiry?.nextFollowAt || '');
        if (nf) client.nextFollowUp = nf;
        client.lastFollowAt = today;
        client.updatedAt = stamp;
        clientsDirty = true;
      }

      const summary = normText(input.summary).slice(0, 300);
      const messages = Array.isArray(input.messages) ? input.messages : [];
      const messageIds = messages.map((m) => normText(m?.id)).filter(Boolean);
      const transcript = formatMessages(messages, 80);

      const binding = upsertBinding(bindings, {
        channel,
        customerId: input.customerId || buyer.customerId,
        imInquiryId: input.imInquiryId,
        client,
        owner: client.owner || target.owner,
        ownerName: client.ownerName || target.ownerName,
        buyer,
        messageIds,
        summary,
        now: stamp,
        genId,
      });

      let savedComm = null;
      if (input.saveComm !== false && (summary || transcript)) {
        savedComm = {
          id: genId(),
          clientId: client.id,
          clientName: client.company,
          channel: channelLabel(channel),
          date: today,
          summary: summary || '沟通进度更新',
          content: transcript || summary,
          source: 'extension',
          externalKey: normText(input.imInquiryId || input.customerId || buyer.customerId),
          owner: target.owner,
          ownerName: target.ownerName,
          createdAt: stamp,
          updatedAt: stamp,
        };
        comms.push(savedComm);
      }

      let savedInquiry = null;
      const inqInput = input.inquiry && typeof input.inquiry === 'object' ? input.inquiry : null;
      if (inqInput && inqInput.action === 'update' && inqInput.inquiryId) {
        const iqIdx = inquiries.findIndex((q) => q.id === inqInput.inquiryId);
        if (iqIdx < 0) throw safeErr('要更新的询盘不存在', 404);
        if (!canAccessRecord(user, inquiries[iqIdx].owner)) throw safeErr('无权操作该询盘', 403);
        const prev = inquiries[iqIdx];
        const nextStatus = INQ_STATUSES.has(inqInput.status) ? inqInput.status : prev.status;
        const nextFollowAt = validDateStr(inqInput.nextFollowAt) || prev.nextFollowAt || '';
        const followLogs = Array.isArray(prev.followLog) ? [...prev.followLog] : [];
        if (summary) {
          followLogs.push({
            id: genId(),
            content: summary,
            at: stamp,
            by: user.name || user.username,
            userId: user.id,
            ...(nextFollowAt ? { nextFollowAt } : {}),
          });
        }
        const stageLogs = Array.isArray(prev.stageLog) ? [...prev.stageLog] : [];
        if (nextStatus && nextStatus !== (prev.status || '新询盘')) {
          stageLogs.push({ from: prev.status || '新询盘', to: nextStatus, at: stamp, by: user.name || user.username, reason: summary || '聊天进度同步' });
        }
        inquiries[iqIdx] = {
          ...prev,
          status: nextStatus,
          lastFollowAt: today,
          nextFollowAt,
          followLog: followLogs,
          stageLog: stageLogs,
          ...(nextStatus === '成交' && !prev.wonAt ? { wonAt: stamp } : {}),
          ...(transcript ? { chatLog: transcript } : {}),
          updatedAt: stamp,
        };
        savedInquiry = inquiries[iqIdx];
      } else if (inqInput && inqInput.action === 'create') {
        const status = INQ_STATUSES.has(inqInput.status) ? inqInput.status : '新询盘';
        const nextFollowAt = validDateStr(inqInput.nextFollowAt);
        const amt = Number(inqInput.expectedAmount);
        savedInquiry = {
          id: genId(),
          clientId: client.id,
          clientName: client.company,
          country: client.country || '',
          contactName: client.contactName || '',
          contactEmail: client.contactEmail || '',
          contactPhone: client.contactPhone || '',
          source: channelLabel(channel),
          receivedAt: validDateStr(inqInput.receivedAt) || today,
          product: normText(inqInput.product) || '待补充产品',
          model: normText(inqInput.model),
          status,
          expectedAmount: Number.isFinite(amt) && amt >= 0 ? amt : 0,
          currency: normText(inqInput.currency).toUpperCase().slice(0, 3) || 'USD',
          sampleSent: '',
          lastFollowAt: today,
          nextFollowAt,
          notes: normText(inqInput.notes),
          chatLog: transcript,
          followLog: summary ? [{ id: genId(), content: summary, at: stamp, by: user.name || user.username, userId: user.id }] : [],
          stageLog: [],
          owner: target.owner,
          ownerName: target.ownerName,
          createdAt: stamp,
          updatedAt: stamp,
        };
        inquiries.push(savedInquiry);
      }

      let savedTask = null;
      const tkInput = input.task && typeof input.task === 'object' ? input.task : null;
      if (tkInput && tkInput.create && normText(tkInput.action)) {
        savedTask = {
          id: genId(),
          title: normText(tkInput.action).slice(0, 300),
          type: '待办',
          status: '待办',
          priority: '中',
          dueDate: validDateStr(tkInput.dueDate),
          notes: summary ? `来自聊天同步：${summary}` : '',
          relatedKind: 'client',
          relatedId: client.id,
          relatedName: client.company,
          owner: target.owner,
          ownerName: target.ownerName,
          createdAt: stamp,
          updatedAt: stamp,
        };
        tasks.push(savedTask);
      }

      const writes = [];
      if (clientsDirty) writes.push(write('clients', clients));
      if (contactsDirty) writes.push(write('contacts', contacts));
      if (binding) writes.push(write(BINDINGS_BASE, bindings));
      if (savedComm) writes.push(write('comms', comms));
      if (savedInquiry) writes.push(write('inquiries', inquiries));
      if (savedTask) writes.push(write('tasks', tasks));
      await Promise.all(writes);

      logAudit(user, mode === 'create' ? 'create' : 'update', 'chat-sync', client.id, `${channelLabel(channel)}同步：${client.company}（归属 ${target.ownerName}）`);
      send(res, 200, {
        ok: true,
        client,
        binding,
        comm: savedComm,
        inquiry: savedInquiry,
        task: savedTask,
        targetOwner: target,
      });
      return true;
    }

    return false;
  };
}
