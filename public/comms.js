// ====== 多通道沟通记录（微信 / WhatsApp / 电话 / 邮件 / 其他）+ 快捷话术模板 ======
// 说明：本模块是「沟通存档 + 话术库」，把对话记录绑定到客户，供后续跟进。
// WhatsApp 另有 wa.js：走官方 click-to-chat 深链（wa.me / whatsapp://），
// 由人确认后按发送键，发起时自动回写一条本模块的记录。收消息仍需手工粘贴。
// 2026-08-28 UX 增强：选客户自动带出上下文、一键 AI 生成小结（少录入）。

const COMM_CHANNELS = ['微信', 'WhatsApp', '电话', '邮件', '其他'];
const CH_ICON = { '微信': '💬', 'WhatsApp': '🟢', '电话': '📞', '邮件': '📧', '其他': '📝' };

let comms = [];
let commTmpl = [];
let commChannelFilter = '';
let commTab = 'timeline';
let commTimeFilter = '';

let commsBound = false;
function bindComms() {
  if (commsBound) return; commsBound = true;
  const q = (id) => document.querySelector('#' + id);
  if (q('commAdd')) q('commAdd').onclick = () => openCommModal();
  if (q('commTmplAdd')) q('commTmplAdd').onclick = () => openTmplModal();
  if (q('commWa')) q('commWa').onclick = () => openWaPicker();
  if (q('commAiDec')) q('commAiDec').onclick = () => { if (window.openAiDeconstruct) window.openAiDeconstruct(); else toast('AI 模块未加载，请刷新页面'); };
  document.querySelectorAll('#view-comms .subtab').forEach((b) => b.onclick = () => {
    const t = b.dataset.ctab;
    if (t === 'chatlog') { switchView('chatlog'); return; }
    if (t === 'mail') { switchView('mail'); return; }
    commTab = t; renderComms();
  });
  document.querySelectorAll('#commChannelChips .lf-chip').forEach((c) => c.onclick = () => { commChannelFilter = c.dataset.ch; renderComms(); });
  document.querySelectorAll('#timelineFilter .lf-chip').forEach((c) => c.onclick = () => { commTimeFilter = c.dataset.tl; renderComms(); });
}

async function loadComms() {
  try {
    const [c, t] = await Promise.all([api('/api/comms').then((r) => r.json()), api('/api/comm-templates').then((r) => r.json())]);
    comms = c || []; commTmpl = t || [];
  } catch { comms = []; commTmpl = []; }
  bindComms();
  renderComms();
}

function filterComms() {
  if (!commChannelFilter) return comms;
  return comms.filter((c) => c.channel === commChannelFilter);
}

function renderComms() {
  // 子页签激活
  document.querySelectorAll('#view-comms .subtab').forEach((b) => b.classList.toggle('active', b.dataset.ctab === commTab));
  document.querySelectorAll('#view-comms .subview').forEach((v) => v.classList.toggle('active', v.id === 'sub-' + commTab));

  if (commTab === 'timeline') { renderTimeline(); return; }

  if (commTab === 'records') {
    const chips = document.querySelectorAll('#commChannelChips .lf-chip');
    chips.forEach((c) => c.classList.toggle('active', c.dataset.ch === commChannelFilter));
    const list = document.querySelector('#commList');
    if (!list) return;
    const data = filterComms().slice().sort((a,b)=>newestRecords(a,b,'date'));
    if (!data.length) { list.innerHTML = '<div class="empty">暂无沟通记录，点击右上角「+ 沟通」</div>'; return; }
    list.innerHTML = data.map((c) => `<div class="email-card">
      <div class="ec-head">
        <span class="ec-title">${CH_ICON[c.channel] || '📝'} ${esc(c.clientName || '未指定客户')}</span>
        <span class="tag">${esc(c.channel || '其他')}</span>
      </div>
      <div class="ec-meta">${esc(c.date || '')} · ${esc(c.ownerName || '')}</div>
      ${c.summary ? `<div class="ec-summary"><b>小结：</b>${esc(c.summary)}</div>` : ''}
      <pre class="ec-body">${esc(c.content || '')}</pre>
      <div class="ec-foot">
        <button class="link-btn" data-cm="${c.id}">编辑</button>
        <button class="link-btn danger" data-cmdel="${c.id}">删除</button>
      </div>
    </div>`).join('');
    list.querySelectorAll('[data-cm]').forEach((b) => b.onclick = () => openCommModal(b.dataset.cm));
    list.querySelectorAll('[data-cmdel]').forEach((b) => b.onclick = async () => {
      if (confirm('确认删除该沟通记录？')) { await api('/api/comms/' + b.dataset.cmdel, { method: 'DELETE' }); toast('已删除'); loadComms(); }
    });
  } else {
    const list = document.querySelector('#commTmplList');
    if (!list) return;
    if (!commTmpl.length) { list.innerHTML = '<div class="empty">暂无话术模板，点击右上角「+ 话术」</div>'; return; }
    list.innerHTML = commTmpl.map((t) => `<div class="email-card">
      <div class="ec-head">
        <span class="ec-title">${esc(t.title || '话术')}</span>
        ${t.channel ? `<span class="tag">${esc(t.channel)}</span>` : ''}
      </div>
      <pre class="ec-body">${esc(t.content || '')}</pre>
      <div class="ec-foot">
        <button class="link-btn" data-copy="${t.id}">复制</button>
        <button class="link-btn" data-tm="${t.id}">编辑</button>
        <button class="link-btn danger" data-tmdel="${t.id}">删除</button>
      </div>
    </div>`).join('');
    list.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => {
      const t = commTmpl.find((x) => x.id === b.dataset.copy);
      if (t) { navigator.clipboard.writeText(t.content || '').then(() => toast('话术已复制'), () => toast('复制失败')); }
    });
    list.querySelectorAll('[data-tm]').forEach((b) => b.onclick = () => openTmplModal(b.dataset.tm));
    list.querySelectorAll('[data-tmdel]').forEach((b) => b.onclick = async () => {
      if (confirm('确认删除该话术？')) { await api('/api/comm-templates/' + b.dataset.tmdel, { method: 'DELETE' }); toast('已删除'); loadComms(); }
    });
  }
}

// 会话时间线：按客户聚合沟通记录 + 聊天记录，一眼看完每个客户最近在聊什么
function renderTimeline() {
  const list = document.querySelector('#timelineList');
  if (!list) return;
  const now = Date.now();
  const allChats = (typeof chats !== 'undefined') ? (chats || []) : [];
  const items = [];
  comms.forEach((c) => {
    const ts = c.date ? new Date(c.date + 'T00:00:00').getTime() : (c.createdAt || 0);
    items.push({ key: c.clientName || '', ts, type: 'comm', channel: c.channel || '', summary: c.summary || '', content: c.content || '', id: c.id });
  });
  allChats.forEach((c) => {
    items.push({ key: c.clientName || '', ts: c.updatedAt || c.createdAt || 0, type: 'chat', channel: '聊天', summary: c.summary || '', content: (c.raw || '').slice(0, 300), id: c.id, lines: (c.lines || []).length });
  });
  // 时间过滤
  let cutoff = 0;
  if (commTimeFilter === '今天') { const d = new Date(); d.setHours(0, 0, 0, 0); cutoff = d.getTime(); }
  else if (commTimeFilter === '近7天') cutoff = now - 7 * 86400000;
  else if (commTimeFilter === '近30天') cutoff = now - 30 * 86400000;
  const fItems = cutoff ? items.filter((i) => i.ts >= cutoff) : items;
  const groups = {};
  fItems.forEach((it) => { const k = it.key || '未指定客户'; (groups[k] = groups[k] || []).push(it); });
  const keys = Object.keys(groups).sort((a, b) => {
    const ma = Math.max(...groups[a].map((x) => x.ts)); const mb = Math.max(...groups[b].map((x) => x.ts)); return mb - ma;
  });
  const chips = document.querySelectorAll('#timelineFilter .lf-chip');
  chips.forEach((c) => c.classList.toggle('active', c.dataset.tl === commTimeFilter));
  if (!keys.length) {
    list.innerHTML = '<div class="empty">暂无沟通。点右上角「🤖 AI 解构」把聊天记录一键解构入系统，或「+ 沟通」手动登记。</div>';
    return;
  }
  const tstr = (ts) => { if (!ts) return ''; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const iconOf = (it) => (it.type === 'chat' ? '💭'
    : it.channel === '邮件' ? '📧' : it.channel === '微信' ? '💬' : it.channel === 'WhatsApp' ? '🟢'
      : it.channel === '电话' ? '📞' : '📝');
  list.innerHTML = keys.map((k) => {
    const arr = groups[k].slice().sort((a, b) => b.ts - a.ts);
    const last = arr[0];
    return `<div class="tl-group">
      <div class="tl-head">
        <span class="tl-client">${esc(k)}</span>
        <span class="muted">${arr.length} 条沟通 · 最近 ${tstr(last.ts)}</span>
      </div>
      <div class="tl-items">
        ${arr.map((it) => `<div class="tl-item" title="${esc((it.summary || it.content || '').slice(0, 120))}">
          <span class="tl-dot">${iconOf(it)}</span>
          <span class="tl-chan">${esc(it.channel || '')}</span>
          <span class="tl-sum">${esc(it.summary || it.content || '')}</span>
          <span class="tl-date">${tstr(it.ts)}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

// 客户上下文（国家/联系人/进行中商机/最近订单），用于自动带出与 AI 小结
function commContextText(company) {
  if (!company) return '';
  const cl = clients.find((x) => x.company === company);
  if (!cl) return '';
  const inqs = (inquiries || []).filter((q) => q.company === company && q.stage && q.stage !== '已关闭' && q.stage !== '关闭');
  const ords = (orders || []).filter((o) => o.clientName === company || o.client === company);
  return (cl.country ? '客户国家：' + cl.country + '。' : '')
    + (inqs.length ? '进行中商机' + inqs.length + '个（' + inqs.map((q) => q.product || '').filter(Boolean).slice(0, 3).join('、') + '）。' : '')
    + (ords.length ? '历史订单' + ords.length + '个。' : '');
}

function openCommModal(id) {
  const c = id ? comms.find((x) => x.id === id) : {};
  const clientOpts = ['', ...clients.map((cl) => cl.company)];
  // 新增时默认勾选 AI 分析；编辑时默认不勾（内容已存在）
  const aiChecked = id ? '' : 'checked';
  openModal(id ? '编辑沟通记录' : '新增沟通记录', `
    ${selectField('客户', 'clientName', c.clientName || '', clientOpts)}
    <div class="field full muted" id="commCtx"></div>
    ${selectField('通道', 'channel', c.channel || '微信', COMM_CHANNELS)}
    ${field('日期', 'date', c.date || todayStr(), 'date')}
    <div class="field full"><label>小结（可选）</label><input id="commSummary" name="summary" value="${esc(c.summary)}" placeholder="这次沟通的结论/下一步" /></div>
    <div class="field full"><label>沟通内容</label><textarea id="commContent" name="content" rows="6" placeholder="粘贴聊天记录 / 通话要点">${esc(c.content)}</textarea></div>
    <div class="field full com-ai-row"><label class="chk-inline"><input type="checkbox" id="commAi" ${aiChecked}/> 🤖 AI 分析沟通内容（自动生成小结，需先在「🤖 AI 助手设置」配置本地模型）</label>
      <button type="button" class="btn-mini" id="commGenSummary">✨ 立即生成小结</button>
    </div>
  `, { wide: true });

  // 客户自动带出上下文（少录入：选完客户，背景一目了然，AI 小结更准）
  const ctxEl = document.getElementById('commCtx');
  const buildCtx = (company) => {
    if (!company) { if (ctxEl) ctxEl.textContent = ''; return; }
    const cl = clients.find((x) => x.company === company);
    if (!cl) { if (ctxEl) ctxEl.textContent = ''; return; }
    const inqs = (inquiries || []).filter((q) => q.company === company && q.stage && q.stage !== '已关闭' && q.stage !== '关闭');
    const ords = (orders || []).filter((o) => o.clientName === company || o.client === company);
    const parts = [];
    if (cl.country) parts.push('国家 ' + cl.country);
    if (cl.contactName) parts.push('联系人 ' + cl.contactName);
    if (inqs.length) parts.push('进行中商机 ' + inqs.length + ' 个');
    const lastOrd = ords.slice().sort((a, b) => String(b.orderDate || b.createdAt || '').localeCompare(String(a.orderDate || a.createdAt || '')))[0];
    if (lastOrd) parts.push('最近订单 ' + (lastOrd.orderNo || lastOrd.id));
    if (ctxEl) ctxEl.textContent = parts.length ? '📇 ' + parts.join(' · ') : '';
  };
  const clientSel = document.querySelector('#modalForm [name="clientName"]');
  if (clientSel) { clientSel.onchange = (e) => buildCtx(e.target.value); buildCtx(c.clientName || ''); }

  // ✨ 立即生成小结（带客户上下文）
  document.getElementById('commGenSummary').onclick = async () => {
    const content = document.getElementById('commContent').value.trim();
    if (!content) { toast('请先粘贴沟通内容'); return; }
    const btn = document.getElementById('commGenSummary');
    btn.disabled = true; btn.textContent = '✨ 生成中…';
    try {
      const company = (document.querySelector('#modalForm [name="clientName"]') || {}).value || '';
      const summary = await summarizeComm(content, commContextText(company));
      if (summary) { document.getElementById('commSummary').value = summary; toast('✨ 已生成小结'); }
    } catch (err) {
      toast('生成失败：' + (err && err.message ? err.message : err));
    } finally {
      btn.disabled = false; btn.textContent = '✨ 立即生成小结';
    }
  };

  document.querySelector('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const aiBox = document.getElementById('commAi');
    if (aiBox && aiBox.checked && (fd.content || '').trim()) {
      const btn = e.target.querySelector('button[type="submit"]');
      const orig = btn ? btn.textContent : '保存';
      if (btn) { btn.disabled = true; btn.textContent = 'AI 分析中…'; }
      try {
        const summary = await summarizeComm(fd.content, commContextText(fd.clientName || ''));
        if (summary) { fd.summary = summary; toast('🤖 AI 已生成小结'); }
      } catch (err) {
        // 模型未连通/超时时，明确提示但仍保留手动输入并继续保存
        toast('AI 分析失败：' + (err && err.message ? err.message : err) + '（仍会保存）');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = orig; }
      }
    }
    const url = id ? '/api/comms/' + id : '/api/comms';
    const m = id ? 'PUT' : 'POST';
    await api(url, { method: m, body: JSON.stringify(fd) });
    toast('已保存'); closeModal(); loadComms();
  };
}

// 用本地模型（经 /api/ai/chat）把一段沟通内容压缩成一句话小结
async function summarizeComm(content, context) {
  const sys = '你是一名外贸业务助理。请阅读一段与客户的沟通记录（微信 / WhatsApp / 电话 / 邮件），用简体中文写一句不超过 40 字的小结，概括沟通结论与下一步动作。只返回小结文本本身，不要解释、不要引号、不要 markdown。';
  const usr = (context ? '客户背景：' + context + '\n' : '') + '沟通内容：\n' + String(content || '').slice(0, 4000);
  const { content: out } = await aiChat([
    { role: 'system', content: sys },
    { role: 'user', content: usr },
  ], { temperature: 0.3 });
  return (out || '').trim();
}
function openTmplModal(id) {
  const t = id ? commTmpl.find((x) => x.id === id) : {};
  openModal(id ? '编辑话术' : '新增话术', `
    ${field('标题 *', 'title', t.title, 'text', 'required')}
    ${selectField('通道', 'channel', t.channel || '', ['', ...COMM_CHANNELS])}
    <div class="field full"><label>话术内容</label><textarea name="content" rows="7" placeholder="可复用的回复话术，支持 {{变量}}">${esc(t.content)}</textarea></div>
    <div class="field full tmpl-vars">
      <b>支持的变量</b><span class="muted">（发起 WhatsApp 时按当前客户自动替换；取不到值会原样保留，方便肉眼发现）</span>
      <div class="tmpl-var-list">${['客户', '联系人', '国家', '产品', '订单号', '我', '我司', '今天']
    .map((v) => `<code data-var="{{${v}}}">{{${v}}}</code>`).join('')}</div>
      <span class="muted">点变量即可插入光标处。通道选「WhatsApp」或留空，才会出现在发起弹窗的模板列表里。</span>
    </div>
  `, { wide: true });
  // 点变量插入到光标位置
  const ta = document.querySelector('#modalForm [name="content"]');
  document.querySelectorAll('#modalForm [data-var]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.onclick = () => {
      const v = el.dataset.var;
      const s = ta.selectionStart || 0; const e2 = ta.selectionEnd || 0;
      ta.value = ta.value.slice(0, s) + v + ta.value.slice(e2);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + v.length;
    };
  });
  document.querySelector('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const url = id ? '/api/comm-templates/' + id : '/api/comm-templates';
    const m = id ? 'PUT' : 'POST';
    await api(url, { method: m, body: JSON.stringify(fd) });
    toast('已保存'); closeModal(); loadComms();
  };
}

window.loadComms = loadComms;
window.getAllComms = () => comms;
window.openCommModal = openCommModal;
