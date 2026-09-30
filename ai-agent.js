// ai-agent.js — AI 管家编排层（P0，2026-08-26）
// 职责：接收前端会话历史 → 组装系统提示词（工具协议 + 瘦身数据概况）→ 调用 LLM
//       → 解析 <<<AI_ACTION>>> 动作块 → 查询类工具在本模块执行（带 RBAC 过滤）→ 多轮循环。
// 写入类动作不在服务端执行：返回给前端渲染 ActionCard，由用户确认后走现有 REST 接口
//       （自动继承 RBAC 权限 / 参数处理 / 通用审计拦截，审计侧通过 X-AI-Action 头标记来源）。
// 依赖全部由 server.js 注入（readJson / RBAC / AI 辅助函数），本模块无状态、无直接 IO。

const AGENT_MAX_LOOPS = 8;          // 单次请求内 LLM 调用上限（查询工具循环）
const AGENT_LLM_TIMEOUT = 90000;    // 单次 LLM 调用超时（毫秒）
const AGENT_MAX_ACTIONS = 5;        // 单次请求返回的写动作上限
const AGENT_TOOL_RESULT_LIMIT = 6000; // 注入回对话的工具结果字符上限
const AGENT_MSG_CHAR_LIMIT = 20000; // 单条消息内容上限（防大文件文本/超长粘贴打爆上下文）

const QUERY_TOOLS = new Set(['query_clients', 'query_client_detail', 'query_inquiries', 'crm_stats']);

// ---------------- 动作块解析（容错：围栏/尾随空白/非法 JSON 跳过） ----------------
function parseAgentActions(raw) {
  const blocks = [];
  let cleaned = String(raw || '');
  const re = /<<<AI_ACTION>>>\s*([\s\S]*?)\s*<<<END>>>/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    let obj = null;
    const s0 = m[1];
    try { obj = JSON.parse(s0); } catch {
      const s1 = s0.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      try { obj = JSON.parse(s1); } catch { obj = null; }
    }
    if (obj && typeof obj.tool === 'string') {
      blocks.push({ tool: obj.tool, params: (obj.params && typeof obj.params === 'object') ? obj.params : {}, say: String(obj.say || '').slice(0, 200) });
    }
    cleaned = cleaned.replace(m[0], '');
  }
  return { text: cleaned.trim(), blocks };
}

// ---------------- 瘦身数据概况（替代旧版全量快照注入） ----------------
async function buildStatsSummary(ctx) {
  const { readJson, files, user, buildVisibleOwners } = ctx;
  const va = buildVisibleOwners(user);
  const vis = (l) => (va ? l.filter((o) => va.has(o.owner)) : l);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const clients = vis(await readJson(files.CLIENTS_FILE));
    const inqs = vis(await readJson(files.INQ_FILE));
    const orders = vis(await readJson(files.ORDERS_FILE));
    const tasks = vis(await readJson(files.TASKS_FILE));
    const byStage = {}; clients.forEach((c) => { const s = c.stage || '未补充'; byStage[s] = (byStage[s] || 0) + 1; });
    const byStatus = {}; inqs.forEach((q) => { const s = q.status || '未知'; byStatus[s] = (byStatus[s] || 0) + 1; });
    const overdue = clients.filter((c) => c.nextFollowUp && c.nextFollowUp < today && (c.stage || '') !== '流失').length;
    const dueToday = clients.filter((c) => c.nextFollowUp === today).length;
    const openTasks = tasks.filter((t) => !['已完成', '已取消'].includes(t.status || '')).length;
    return [
      `- 客户 ${clients.length} 家（按阶段：${Object.entries(byStage).map(([k, v]) => k + v).join('、') || '无'}）`,
      `- 询盘 ${inqs.length} 条（按状态：${Object.entries(byStatus).map(([k, v]) => k + v).join('、') || '无'}）`,
      `- 订单 ${orders.length} 条，未完结任务 ${openTasks} 条`,
      `- 超期未跟进客户 ${overdue} 家，今日应跟进 ${dueToday} 家`,
      `（详细数据请用查询工具获取；今天是 ${today}）`,
    ].join('\n');
  } catch {
    return `（数据概况暂不可用，今天是 ${today}。请直接使用查询工具。）`;
  }
}

// ---------------- 系统提示词（工具协议 v2） ----------------
function agentSystemPrompt(statsSummary) {
  return `你是外贸CRM系统的AI管家，帮用户管理客户、询盘、订单、沟通记录和任务。使用中文，回答简洁、可执行。

## 工具协议
你可以在回复中嵌入"动作块"调用工具，格式（严格遵守，可有多个）：
<<<AI_ACTION>>>
{"tool":"工具名","params":{...},"say":"给用户的一句说明"}
<<<END>>>

可用工具：
- query_clients：查询客户。params: keyword(公司/联系人/国家关键词，可选), country(可选), stage(可选), limit(默认10，最大20)
- query_client_detail：客户360°详情。params: clientId(必填)
- query_inquiries：查询询盘。params: status(可选), days(最近N天，可选), limit(默认10)
- crm_stats：整体统计。params: 无
- create_client：创建客户（需用户确认）。params: company(必填), country, contactName, contactEmail, contactPhone, source
- create_inquiry：创建询盘（需用户确认）。params: clientName(必填), product, country, contactName, contactEmail, source, expectedAmount, currency
- create_contact：为客户添加联系人（需用户确认）。params: clientId(必填), name(必填), role, email, phone
- log_comm：记录沟通（需用户确认）。params: clientId(必填), channel(电话/邮件/WhatsApp/会议等), content(必填), date(YYYY-MM-DD，缺省今天)
- create_task：创建任务（需用户确认）。params: title(必填), dueDate(YYYY-MM-DD), priority(高/中/低), notes
- update_client_stage：更新客户阶段/状态（需用户确认）。params: clientId(必填), stage(必填，阶段值如 潜在/跟进中/报价/样品/成交/流失), nextFollowUp(下次跟进日期 YYYY-MM-DD，可选)
- update_inquiry_status：更新询盘状态（需用户确认）。params: inquiryId(必填), status(必填，如 新询盘/已报价/等回复/谈判中/成交/输单), nextFollowAt(下次跟进日期，可选)
- navigate：跳转页面。params: view(clients/enquiry/orders/tasks/quotations/reminders/dashboard)

## 规则
1. 涉及具体数据（客户、询盘、统计）必须先调用查询工具拿真实数据，禁止编造数字或客户名。
2. 用户要求创建/记录时：字段齐全就直接输出写工具块；关键字段（如公司名、任务标题）缺失则先追问一句。
3. "给某客户建询盘/记沟通/加联系人"类指令：先用 query_clients 查到该客户拿 clientId，再输出写工具块（params 带 clientId）。
4. 一次回复最多输出 3 个写动作块；查询动作块不限但避免浪费。
5. 动作块之外的正文简短（150字内），不要重复 say 内容。
6. 日期一律 YYYY-MM-DD；金额纯数字不带千分位符。

## 当前数据概况
${statsSummary}`;
}

// ---------------- 查询工具执行（服务端，带 RBAC） ----------------
async function execQueryTool(tool, params, ctx) {
  const { readJson, files, user, buildVisibleOwners, canAccessRecord } = ctx;
  const va = buildVisibleOwners(user);
  const vis = (l) => (va ? l.filter((o) => va.has(o.owner)) : l);
  const limit = Math.max(1, Math.min(20, Number(params.limit) || 10));
  const sameName = (a, b) => String(a || '').trim() && String(a || '').trim() === String(b || '').trim();

  if (tool === 'query_clients') {
    let list = vis(await readJson(files.CLIENTS_FILE));
    const kw = String(params.keyword || '').toLowerCase();
    if (kw) list = list.filter((c) => [c.company, c.contactName, c.country, c.source, c.productInterest].some((v) => (v || '').toLowerCase().includes(kw)));
    if (params.country) list = list.filter((c) => (c.country || '') === String(params.country));
    if (params.stage) list = list.filter((c) => (c.stage || '') === String(params.stage));
    const total = list.length;
    const items = list.slice(0, limit).map((c) => ({
      id: c.id, company: c.company, country: c.country, stage: c.stage,
      contactName: c.contactName, email: c.contactEmail, phone: c.contactPhone,
      source: c.source, nextFollowUp: c.nextFollowUp,
    }));
    return { tool, items, total };
  }

  if (tool === 'query_client_detail') {
    const all = await readJson(files.CLIENTS_FILE);
    const c = all.find((x) => x.id === params.clientId);
    if (!c) return { tool, error: '未找到该客户' };
    if (!canAccessRecord(user, c.owner)) return { tool, error: '无权限查看该客户' };
    const inqs = vis(await readJson(files.INQ_FILE)).filter((q) => q.clientId === c.id || sameName(q.clientName, c.company));
    const quotes = vis(await readJson(files.QUOTATIONS_FILE)).filter((q) => q.clientId === c.id || sameName(q.clientName, c.company));
    const orders = vis(await readJson(files.ORDERS_FILE)).filter((o) => o.clientId === c.id || sameName(o.clientName, c.company));
    const comms = vis(await readJson(files.COMM_FILE)).filter((m) => m.clientId === c.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
    return {
      tool,
      client: {
        id: c.id, company: c.company, country: c.country, stage: c.stage, source: c.source,
        contactName: c.contactName, email: c.contactEmail, phone: c.contactPhone, nextFollowUp: c.nextFollowUp,
      },
      counts: { inquiries: inqs.length, quotations: quotes.length, orders: orders.length },
      recentInquiries: inqs.slice(0, 5).map((q) => ({ id: q.id, product: q.product, status: q.status, receivedAt: q.receivedAt, expectedAmount: q.expectedAmount, currency: q.currency })),
      recentOrders: orders.slice(0, 3).map((o) => ({ id: o.id, orderNo: o.orderNo, amount: o.amount, currency: o.currency, status: o.status, orderDate: o.orderDate })),
      recentComms: comms.map((m) => ({ date: m.date, channel: m.channel, content: String(m.content || '').slice(0, 120) })),
    };
  }

  if (tool === 'query_inquiries') {
    let list = vis(await readJson(files.INQ_FILE));
    if (params.status) list = list.filter((q) => (q.status || '') === String(params.status));
    if (params.days) {
      const days = Math.max(1, Math.min(365, Number(params.days) || 7));
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      list = list.filter((q) => !q.receivedAt || String(q.receivedAt).slice(0, 10) >= since);
    }
    const total = list.length;
    const items = list.slice(0, limit).map((q) => ({
      id: q.id, clientName: q.clientName, country: q.country, product: q.product,
      status: q.status, receivedAt: q.receivedAt, expectedAmount: q.expectedAmount, currency: q.currency,
      contactName: q.contactName, nextFollowAt: q.nextFollowAt,
    }));
    return { tool, items, total };
  }

  if (tool === 'crm_stats') {
    const clients = vis(await readJson(files.CLIENTS_FILE));
    const inqs = vis(await readJson(files.INQ_FILE));
    const orders = vis(await readJson(files.ORDERS_FILE));
    const tasks = vis(await readJson(files.TASKS_FILE));
    const today = new Date().toISOString().slice(0, 10);
    const byStage = {}; clients.forEach((c) => { const s = c.stage || '未补充'; byStage[s] = (byStage[s] || 0) + 1; });
    const byStatus = {}; inqs.forEach((q) => { const s = q.status || '未知'; byStatus[s] = (byStatus[s] || 0) + 1; });
    const byOrderStatus = {}; orders.forEach((o) => { const s = o.status || '未知'; byOrderStatus[s] = (byOrderStatus[s] || 0) + 1; });
    const overdueClients = clients.filter((c) => c.nextFollowUp && c.nextFollowUp < today && (c.stage || '') !== '流失').map((c) => ({ company: c.company, nextFollowUp: c.nextFollowUp })).slice(0, 10);
    const openTasks = tasks.filter((t) => !['已完成', '已取消'].includes(t.status || ''));
    return {
      tool, today,
      clients: { total: clients.length, byStage },
      inquiries: { total: inqs.length, byStatus },
      orders: { total: orders.length, byStatus: byOrderStatus },
      tasks: { open: openTasks.length, dueToday: openTasks.filter((t) => t.dueDate === today).length, overdue: openTasks.filter((t) => t.dueDate && t.dueDate < today).length },
      overdueFollowUps: overdueClients,
    };
  }

  return { tool, error: '未知查询工具：' + tool };
}

// ---------------- 主入口 ----------------
export async function handleAiAgent(res, body, ctx) {
  const { sendJson } = ctx;
  let cfg = null;
  try {
    body = body || {};
    cfg = await ctx.resolveAiCfg(body);
    if (!cfg.baseUrl || !cfg.model) return sendJson(res, 400, { error: 'AI 接口未配置，请先在 AI 助手设置中完成配置' });

    const history = Array.isArray(body.messages)
      ? body.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map((m) => ({ ...m, content: m.content.slice(0, AGENT_MSG_CHAR_LIMIT) }))
        .slice(-12)
      : [];
    if (!history.length) return sendJson(res, 400, { error: '缺少会话内容' });

    const sys = agentSystemPrompt(await buildStatsSummary(ctx));
    const convo = [...history];
    const actions = [];
    const queryResults = [];
    let finalText = '';

    for (let i = 0; i < AGENT_MAX_LOOPS; i++) {
      const payload = {
        model: cfg.model,
        messages: [{ role: 'system', content: sys }, ...convo],
        temperature: cfg.temperature ?? 0.2,
      };
      const upstream = await fetch(ctx.joinUrl(cfg.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: ctx.aiHeaders(cfg),
        body: JSON.stringify(payload),
        signal: ctx.abortAfter(Math.min(Number(cfg.timeout) || AGENT_LLM_TIMEOUT, AGENT_LLM_TIMEOUT)),
      });
      if (!upstream.ok) {
        const txt = await upstream.text();
        return sendJson(res, 502, { error: `AI 接口返回 ${upstream.status}: ${txt.slice(0, 300)}` });
      }
      const j = await upstream.json();
      const msg = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      const { text, blocks } = parseAgentActions(msg);

      const queries = [];
      for (const b of blocks) {
        if (QUERY_TOOLS.has(b.tool)) queries.push(b);
        else if (actions.length < AGENT_MAX_ACTIONS) actions.push(b);
      }

      if (!queries.length) { finalText = text; break; }

      const toolMsgs = [];
      for (const q of queries) {
        let result;
        try { result = await execQueryTool(q.tool, q.params, ctx); }
        catch (e) { result = { tool: q.tool, error: '查询失败：' + (e && e.message ? e.message : String(e)) }; }
        queryResults.push({ tool: q.tool, params: q.params, result });
        toolMsgs.push(`工具 ${q.tool} 结果：` + JSON.stringify(result).slice(0, AGENT_TOOL_RESULT_LIMIT));
      }
      convo.push({ role: 'assistant', content: msg });
      convo.push({ role: 'user', content: toolMsgs.join('\n') + '\n（以上为工具返回的真实数据。请据此回答用户；若用户此前有创建/记录意图且字段已明确，请输出对应写工具块；否则直接回答，不要提及工具机制。）' });
    }

    if (!finalText && !actions.length) finalText = '（多次查询后仍未得出结论，请换个说法再试）';
    return sendJson(res, 200, { text: finalText, actions, queryResults });
  } catch (e) {
    return sendJson(res, 502, { error: ctx.aiErrMsg(e, cfg || {}) });
  }
}
