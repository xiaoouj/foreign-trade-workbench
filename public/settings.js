// ====== 设置页 / 主题配色 / 批量导入 模块 ======
// 依赖 app.js 的全局：LS, toast, esc, api, openModal, closeModal, switchView, loadAll,
//   openUserMgmt, currentUser, $, $$；ai.js 的 openAiSettings（调用时检测）。

// One supported interface. Migrate old browser preferences without touching business data.
function applyTheme() {
  const root = document.documentElement;
  root.dataset.themeStyle = 'blue';
  root.removeAttribute('data-theme');
  root.classList.remove('dark');
  ['vibe', 'apple', 't21', 'mc', 'nerv', 'fui'].forEach(key => delete root.dataset[key]);
  try { LS.set('theme', {brand:'#2563eb', mode:'light', style:'blue'}); LS.set('uiVersion', 4); } catch {}
}
applyTheme();

// ================= 设置页 =================
function renderSettings() {
  const view = $('#view-settings');
  if (!view || typeof currentUser === 'undefined' || !currentUser) return;
  view.innerHTML = `
    <div class="panel-head row"><h2>设置</h2></div>

    <div class="card set-card">
      <div class="card-head"><div class="card-title">界面外观</div></div>
      <p class="muted">统一蓝色界面 · 工作台与客户资料全新布局</p>
    </div>

    <div class="card set-card">
      <div class="card-head"><div class="card-title">⚙ 功能设置</div></div>
      <div class="set-links">
        <button class="set-link" id="setAi">🤖 AI 助手接口<span class="muted">Ollama / OpenAI 兼容接口配置</span></button>
        <button class="set-link" id="setUsers">👥 用户与权限<span class="muted">业务员账号管理</span></button>
      </div>
    </div>

    <div class="card set-card">
      <div class="card-head"><div class="card-title">📋 询盘来源</div></div>
      <div class="set-row" style="flex-wrap:wrap;gap:6px;padding:8px 0" id="inqSrcTags"></div>
      <div class="set-row" style="padding-top:4px;gap:8px">
        <input id="inqSrcInput" placeholder="新增来源" style="flex:1;font-size:13px" />
        <button class="btn-mini" id="inqSrcAdd">添加</button>
        <button class="btn-save" id="inqSrcSave">保存</button>
      </div>
    </div>

    <div class="card set-card">
      <div class="card-head"><div class="card-title">📥 数据导入</div></div>
      <div class="set-links">
        <button class="set-link" id="setImpClients">👥 导入客户记录<span class="muted">文本粘贴 / txt / CSV / Excel</span></button>
        <button class="set-link" id="setImpComms">💬 导入沟通记录<span class="muted">文本粘贴 / txt / CSV / Excel</span></button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">支持直接粘贴从 Excel 复制的表格内容；列顺序见导入窗口说明。</p>
    </div>

    <div class="card set-card">
      <div class="card-head"><div class="card-title">ℹ 关于</div></div>
      <div class="muted" style="font-size:13px;line-height:1.8">
        外贸人工作台 · 数据保存在 NAS 本地（内网）<br>
        消息接入（WhatsApp / 邮件收信）由 connectors 服务推送到「沟通」模块
      </div>
    </div>
  `;
  $('#setAi').onclick = () => { if (typeof openAiSettings === 'function') openAiSettings(); };
  $('#setUsers').onclick = () => openUserMgmt();
  $('#setImpClients').onclick = () => openImportModal('clients');
  $('#setImpComms').onclick = () => openImportModal('comms');

  // 询盘来源编辑
  let inqSources = [];
  const refreshSrcTags = () => {
    const wrap = $('#inqSrcTags');
    wrap.innerHTML = inqSources.map((s, i) => `<span class="attach-tag">${esc(s)} <button class="attach-del" data-si="${i}">&times;</button></span>`).join('');
    wrap.querySelectorAll('.attach-del').forEach((b) => b.addEventListener('click', () => {
      inqSources.splice(Number(b.dataset.si), 1);
      refreshSrcTags();
    }));
  };
  const loadSrc = async () => {
    try {
      const r = await api('/api/settings');
      if (r.ok) { const s = await r.json(); inqSources = (s.inquirySources || []).slice(); }
    } catch { inqSources = ['阿里巴巴', '官网', '展会', 'Google', 'LinkedIn', '客户介绍', '其他']; }
    refreshSrcTags();
  };
  loadSrc();
  $('#inqSrcAdd').onclick = () => {
    const v = $('#inqSrcInput').value.trim();
    if (!v) return;
    if (!inqSources.includes(v)) { inqSources.push(v); refreshSrcTags(); }
    $('#inqSrcInput').value = '';
  };
  $('#inqSrcSave').onclick = async () => {
    try {
      const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ inquirySources: inqSources }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || r.status)); return; }
      toast('来源已保存');
    } catch { toast('保存失败'); }
  };
}

// 进入设置页时渲染（app.js activateView 钩子）—— 包裹方式保留前序钩子链，避免覆盖其它模块的视图钩子
window.onViewActivated = (function (orig) {
  return function (view) {
    if (orig) { try { orig(view); } catch (e) { console.error('onViewActivated', e); } }
    if (view === 'settings') renderSettings();
  };
})(window.onViewActivated);

// ================= 批量导入（客户 / 沟通记录） =================
const IMPORT_SCHEMAS = {
  clients: {
    title: '导入客户记录',
    tip: '每行一个客户，列顺序：公司, 国家, 联系人, 邮箱, 电话, 来源（后面的列可省略）。支持从 Excel 直接复制粘贴。',
    keys: ['company', 'country', 'contactName', 'contactEmail', 'contactPhone', 'source'],
    headers: { '公司': 'company', 'company': 'company', '客户': 'company', '客户名称': 'company', '国家': 'country', 'country': 'country', '联系人': 'contactName', '邮箱': 'contactEmail', 'email': 'contactEmail', '电话': 'contactPhone', '手机': 'contactPhone', '来源': 'source' },
    required: 'company',
    url: '/api/clients/import',
    reload: () => loadAll(),
  },
  comms: {
    title: '导入沟通记录',
    tip: '每行一条记录，列顺序：客户, 通道, 日期, 内容（通道可选：微信/WhatsApp/电话/邮件/其他；也可以只用 客户,内容 两列）。',
    keys: ['clientName', 'channel', 'date', 'content'],
    headers: { '客户': 'clientName', '公司': 'clientName', '通道': 'channel', '渠道': 'channel', '日期': 'date', '内容': 'content', '记录': 'content', '小结': 'summary' },
    required: 'content',
    url: '/api/comms/import',
    reload: () => { if (typeof loadComms === 'function') loadComms(); },
  },
};
const COMM_CHANNEL_SET = ['微信', 'WhatsApp', '电话', '邮件', '其他'];

function parseDelimitedText(text, schema) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : (lines[0].split(',').length > 1 ? ',' : '\t');
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
  // 首行若能映射到已知字段则视为表头，按表头定位列；否则按默认列顺序
  const headMap = rows[0].map((h) => schema.headers[h] || schema.headers[String(h).toLowerCase()] || null);
  const hasHeader = headMap.some(Boolean);
  const out = [];
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const rec = {};
    row.forEach((cell, i) => {
      const key = hasHeader ? headMap[i] : schema.keys[i];
      if (key && cell) rec[key] = cell;
    });
    if (rec.channel && !COMM_CHANNEL_SET.includes(rec.channel)) rec.channel = '其他';
    if (rec[schema.required]) out.push(rec);
  }
  return out;
}

function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Excel 解析组件加载失败（需要外网访问 jsdelivr）'));
    document.head.appendChild(s);
  });
}

async function parseImportFile(file, schema) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    await loadSheetJS();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const headMap = (rows[0] || []).map((h) => schema.headers[String(h).trim()] || null);
    const hasHeader = headMap.some(Boolean);
    const out = [];
    for (const row of hasHeader ? rows.slice(1) : rows) {
      const rec = {};
      (row || []).forEach((cell, i) => {
        const key = hasHeader ? headMap[i] : schema.keys[i];
        const v = String(cell ?? '').trim();
        if (key && v) rec[key] = v;
      });
      if (rec.channel && !COMM_CHANNEL_SET.includes(rec.channel)) rec.channel = '其他';
      if (rec[schema.required]) out.push(rec);
    }
    return out;
  }
  return parseDelimitedText(await file.text(), schema);
}

// 结构化导入（客户 / 沟通记录）的弹窗内容，抽成可复用的片段，
// 供「设置导入」与「统一导入弹窗（聊天记录 / 沟通记录切换）」共用。
function importBodyHtml(schema) {
  return `
    <div class="field full muted" style="font-size:12px">${schema.tip}</div>
    <div class="field full"><label>方式一：粘贴文本</label>
      <textarea id="impText" rows="7" placeholder="从 Excel / 记事本复制内容粘贴到这里"></textarea>
      <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="impAI" /> 🤖 用 AI 自动提取字段（需已配置 AI 接口）
      </label>
      <button id="impAIBtn" class="btn-mini" style="margin-top:6px;display:none" type="button">✨ AI 解析并填入</button>
    </div>
    <div class="field full"><label>方式二：选择文件（.txt / .csv / .xlsx）</label>
      <input type="file" id="impFile" accept=".txt,.csv,.tsv,.xlsx,.xls" />
    </div>
    <div id="impPreview" class="field full muted" style="font-size:12px"></div>
    <div class="modal-foot">
      <button type="button" class="btn-ghost" id="impCancel">取消</button>
      <button type="button" class="btn-save" id="impGo" disabled>导入</button>
    </div>`;
}

function wireImportBody(type, schema, root) {
  const $ = (s) => root.querySelector(s);
  let parsed = [];
  const preview = (list) => {
    parsed = list;
    $('#impPreview').innerHTML = list.length
      ? `✅ 解析出 <b>${list.length}</b> 条记录，前 3 条：<br>` + list.slice(0, 3).map((r) => `<code>${esc(JSON.stringify(r)).slice(0, 120)}</code>`).join('<br>')
      : '暂无可导入记录';
    $('#impGo').disabled = !list.length;
  };
  $('#impAI').addEventListener('change', () => { $('#impAIBtn').style.display = $('#impAI').checked ? '' : 'none'; });
  $('#impAIBtn').addEventListener('click', async () => {
    const rawText = $('#impText').value.trim();
    if (!rawText) { toast('请先粘贴待解析的文本'); return; }
    $('#impAIBtn').disabled = true; $('#impAIBtn').textContent = '⏳ 解析中…';
    try {
      const prompt = type === 'clients'
        ? `从以下文本中提取客户信息，返回 JSON 数组 [{company, country, contactName, contactEmail, contactPhone, source}]。文本可以是邮件签名、WhatsApp 对话、名片文字、Excel 片段等。只提取明确存在的字段，缺失的字段留空。不要编造，不要多解释。`
        : `从以下文本中提取沟通记录，返回 JSON 数组 [{clientName, channel, date, content}]。channel 必须是"微信"/"WhatsApp"/"电话"/"邮件"/"其他"之一。只提取明确存在的字段，缺失的字段留空。`;
      const r = await api('/api/ai/chat', {
        method: 'POST', body: JSON.stringify({ messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: rawText.slice(0, 15000) }
        ], stream: false, jsonMode: true, temperature: 0.1 })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (r.status === 503 || r.status === 502)
          toast('AI 解析失败：请先在「设置 → AI 助手接口」中配置 AI 服务');
        else
          toast('AI 解析失败：' + (j.error || r.status));
        return;
      }
      const j = await r.json();
      const content = j.choices?.[0]?.message?.content || j.content || '';
      let extracted;
      try { extracted = JSON.parse(content); } catch {
        // 尝试从内容中提取 JSON 数组
        const m = content.match(/\[[\s\S]*\]/);
        if (m) extracted = JSON.parse(m[0]);
        else { toast('AI 返回的内容无法解析，请检查 AI 服务是否正常运行'); return; }
      }
      if (!Array.isArray(extracted) || !extracted.length) { toast('AI 未提取到有效记录，请检查文本内容是否正确'); return; }
      // 填充到 textarea 并解析，让用户可以在预览中人工校正
      const header = schema.keys.join('\t');
      const rows = extracted.map((rec) => schema.keys.map((k) => rec[k] || '').join('\t')).join('\n');
      $('#impText').value = header + '\n' + rows;
      preview(extracted);
      toast(`AI 提取出 ${extracted.length} 条记录，已填入预览区，请核对后导入`);
    } catch (err) {
      toast('AI 解析异常：' + (err.message || err));
    } finally {
      $('#impAIBtn').disabled = false; $('#impAIBtn').textContent = '✨ AI 解析并填入';
    }
  });
  $('#impText').addEventListener('input', (e) => preview(parseDelimitedText(e.target.value, schema)));
  $('#impFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { preview(await parseImportFile(f, schema)); } catch (err) { toast(err.message); }
  });
  $('#impCancel').onclick = closeModal;
  $('#impGo').onclick = async () => {
    $('#impGo').disabled = true;
    try {
      const r = await api(schema.url, { method: 'POST', body: JSON.stringify({ records: parsed }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      toast(`导入完成：新增 ${j.added} 条` + (j.skipped ? `，跳过 ${j.skipped} 条` : ''));
      closeModal();
      schema.reload();
    } catch (err) {
      toast('导入失败：' + err.message);
      $('#impGo').disabled = false;
    }
  };
}

function openImportModal(type) {
  const schema = IMPORT_SCHEMAS[type];
  openModal('📥 ' + schema.title, `<div id="impRoot">${importBodyHtml(schema)}</div>`, { plain: true, noFooter: true });
  wireImportBody(type, schema, document.getElementById('impRoot'));
}

// 客户页 / 沟通页的「📥 导入」按钮入口（settings.js 在 app.js 之后加载，DOM 已就绪）
(function bindImportEntries() {
  const ci = document.getElementById('clientImport');
  if (ci) ci.onclick = () => openImportModal('clients');
  const cm = document.getElementById('commImport');
  if (cm) cm.onclick = () => openUnifiedImport('comms');
})();
