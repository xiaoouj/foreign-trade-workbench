// ====== 聊天记录：整段导入 → 行级标注（客户 / 我）→ AI 接待建议 ======
// 与「沟通记录」(comms) 的区别：这里存的是原始聊天全文，进入后才逐行标注发言方，
// 并支持一键生成「我（业务员）」的回复建议。后端见 server.js 的 /api/chats（RBAC 复用 comms 模式）。
// 2026-08-28 UX 增强：导入时支持 AI 自动识别发言方 + 生成小结（少录入）。

let chats = [];
window.getAllChats = () => chats;

async function loadChatLogs() {
  try {
    const r = await api('/api/chats');
    chats = r.ok ? (await r.json()) : [];
  } catch { chats = []; }
  renderChatLogs();
}

function fmtDateShort(ts) {
  if (!ts) return '';
  try { return new Date(ts).toISOString().slice(0, 10); } catch { return ''; }
}

function renderChatLogs() {
  const list = document.getElementById('chatLogList');
  if (!list) return;
  if (!chats.length) {
    list.innerHTML = '<div class="empty">暂无聊天记录，点击右上角「📥 导入聊天记录」粘贴整段对话</div>';
    return;
  }
  list.innerHTML = chats.slice().sort(newestRecords).map((c) => {
    const n = (c.lines && c.lines.length) || 0;
    const tagged = c.lines ? c.lines.filter((l) => l.side && l.side !== 'unknown').length : 0;
    const preview = (c.raw || '').slice(0, 200);
    return `<div class="email-card">
      <div class="ec-head">
        <span class="ec-title">💬 ${esc(c.clientName || '未指定客户')}</span>
        ${c.title ? `<span class="tag">${esc(c.title)}</span>` : ''}
      </div>
      <div class="ec-meta">${esc(fmtDateShort(c.updatedAt || c.createdAt))} · ${esc(c.ownerName || '')} · ${n} 行${n ? '（已标 ' + tagged + '）' : ''}</div>
      ${c.summary ? `<div class="ec-summary"><b>小结：</b>${esc(c.summary)}</div>` : ''}
      <pre class="ec-body ec-preview">${esc(preview)}${preview.length >= 200 ? '…' : ''}</pre>
      <div class="ec-foot">
        <button class="link-btn" data-chopen="${c.id}">打开标注</button>
        <button class="link-btn danger" data-chdel="${c.id}">删除</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-chopen]').forEach((b) => b.onclick = () => openChatViewer(b.dataset.chopen));
  list.querySelectorAll('[data-chdel]').forEach((b) => b.onclick = async () => {
    if (confirm('确认删除该聊天记录？')) {
      try { await api('/api/chats/' + b.dataset.chdel, { method: 'DELETE' }); toast('已删除'); } catch (e) { toast('删除失败'); }
      loadChatLogs();
    }
  });
}

// 统一导入弹窗：类型切换「聊天记录（整段文本）/ 沟通记录（结构化）」。
// 沟通页与聊天记录页的导入按钮都指向它，避免两个"导入聊天"入口各做一套。
function openUnifiedImport(defaultType) {
  const cur = (defaultType === 'comms') ? 'comms' : 'chat';
  openModal('📥 导入', `
    <div class="field full">
      <label>导入类型</label>
      <div class="seg">
        <button type="button" class="seg-btn" data-ut="chat">💬 聊天记录（整段文本）</button>
        <button type="button" class="seg-btn" data-ut="comms">📋 沟通记录（结构化）</button>
      </div>
    </div>
    <div id="impBody" class="field full"></div>
  `, { wide: true, plain: true, noFooter: true });

  const body = document.getElementById('impBody');

  // —— 聊天记录：整段文本粘贴 → AI 自动识别发言方 + 小结 → 一键确认导入 ——
  function showChat() {
    body.innerHTML = `
      ${selectField('关联客户', 'clientName', '', ['', ...clients.map((c) => c.company)])}
      <div class="field full"><label>标题（可选）</label><input name="uiTitle" placeholder="如：WhatsApp 询价 2026-08" /></div>
      <div class="field full"><label>整段聊天文本</label><textarea name="uiRaw" rows="8" placeholder="直接粘贴一整段聊天记录，可自动识别发言方并生成小结"></textarea></div>
      <div class="field full">
        <button type="button" class="btn-ai" id="uiAutoTag">🤖 AI 自动识别（标注发言方 + 生成小结）</button>
      </div>
      <div class="field full hidden" id="uiTagWrap">
        <label>识别结果（点标签可切换：未定 / 客户 / 我）</label>
        <div class="chat-conv" id="uiTagList" style="max-height:220px;overflow:auto"></div>
      </div>
      <div class="field full"><label>小结（AI 自动生成，可编辑）</label><input id="uiSummary" placeholder="这次沟通的结论/下一步" /></div>
      <div class="field full muted">提示：不识别也可直接导入，导入后可在「打开标注」里逐行整理。</div>
      <div class="modal-foot">
        <button type="button" class="btn-ghost" id="uiCancel">取消</button>
        <button type="button" class="btn-save" id="uiChatGo">导入聊天记录</button>
      </div>`;
    let pending = [];
    const tagList = document.getElementById('uiTagList');
    const tagWrap = document.getElementById('uiTagWrap');
    const sideLabel = (s) => (s === 'me' ? '我' : s === 'client' ? '客户' : '未定');
    const renderTags = () => {
      tagList.innerHTML = pending.map((l, i) => {
        const cls = l.side === 'me' ? 'me' : l.side === 'client' ? 'client' : 'unknown';
        return `<div class="chat-line ${cls}" data-i="${i}">
          <button type="button" class="cl-side" data-tg="${i}">${sideLabel(l.side)}</button>
          <div class="cl-text">${esc(l.text)}</div>
        </div>`;
      }).join('');
      tagList.querySelectorAll('[data-tg]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.tg;
        const order = ['unknown', 'client', 'me'];
        pending[i].side = order[(order.indexOf(pending[i].side) + 1) % order.length];
        renderTags();
      });
    };

    document.getElementById('uiCancel').onclick = closeModal;
    document.getElementById('uiAutoTag').onclick = async () => {
      const raw = body.querySelector('[name=uiRaw]').value.trim();
      if (!raw) { toast('请先粘贴聊天文本'); return; }
      const btn = document.getElementById('uiAutoTag');
      btn.disabled = true; btn.textContent = '🤖 识别中…';
      try {
        const textLines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!textLines.length) throw new Error('没有可识别的内容');
        const sys = '你是一名外贸业务助理。下面是一段业务员(本公司)与海外客户的聊天记录，每一行是一条独立消息。'
          + '请判断每条消息的发言方：业务员自己发出→me；客户发出→client；无法判断→unknown。'
          + '再写一句不超过40字的简体中文小结，概括沟通结论与下一步动作。'
          + '只返回合法JSON：{"lines":[{"side":"me"或"client"或"unknown"}...],"summary":"一句话小结"}，'
          + 'lines数组长度必须与消息行数完全一致、顺序一一对应，不要返回其它内容。';
        const { content } = await aiChat([
          { role: 'system', content: sys },
          { role: 'user', content: textLines.join('\n').slice(0, 8000) },
        ], { temperature: 0.2, jsonMode: true });
        const parsed = parseJsonSafe(content);
        const sides = (parsed && Array.isArray(parsed.lines)) ? parsed.lines : [];
        pending = textLines.map((text, i) => {
          const raw = sides[i];
          const s = (typeof raw === 'string' && ['me', 'client', 'unknown'].includes(raw)) ? raw
            : (raw && ['me', 'client', 'unknown'].includes(raw.side)) ? raw.side
            : 'unknown';
          return { side: s, text };
        });
        if (parsed && parsed.summary) document.getElementById('uiSummary').value = parsed.summary;
        tagWrap.classList.remove('hidden');
        renderTags();
        toast('已识别 ' + pending.length + ' 行，可点标签修正后导入');
      } catch (err) {
        toast('AI 识别失败：' + (err && err.message ? err.message : err) + '（可直接导入后手动标注）');
      } finally {
        btn.disabled = false; btn.textContent = '🤖 AI 自动识别（标注发言方 + 生成小结）';
      }
    };
    document.getElementById('uiChatGo').onclick = async () => {
      const raw = body.querySelector('[name=uiRaw]').value.trim();
      if (!raw) { toast('请粘贴聊天文本'); return; }
      const clientName = body.querySelector('[name=clientName]').value || '';
      const title = body.querySelector('[name=uiTitle]').value || '';
      const summary = document.getElementById('uiSummary').value.trim() || '';
      const lines = pending.length ? pending : raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((text) => ({ side: 'unknown', text }));
      const btn = document.getElementById('uiChatGo');
      btn.disabled = true;
      try {
        await api('/api/chats', { method: 'POST', body: JSON.stringify({ clientName, title, raw, summary, lines }) });
        toast(summary ? '已导入（含 AI 小结）' : '已导入'); closeModal(); loadChatLogs();
      } catch (err) {
        toast('导入失败：' + (err && err.message ? err.message : err));
        btn.disabled = false;
      }
    };
  }

  // —— 沟通记录：复用 settings.js 的结构化导入片段 ——
  function showComms() {
    body.innerHTML = `<div id="impRoot">${importBodyHtml(IMPORT_SCHEMAS.comms)}</div>`;
    wireImportBody('comms', IMPORT_SCHEMAS.comms, document.getElementById('impRoot'));
  }

  const segBtns = document.querySelectorAll('.seg-btn');
  segBtns.forEach((b) => {
    b.classList.toggle('active', b.dataset.ut === cur);
    b.onclick = () => {
      segBtns.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      if (b.dataset.ut === 'chat') showChat(); else showComms();
    };
  });
  if (cur === 'chat') showChat(); else showComms();
}

// 向后兼容：原「导入聊天记录」按钮入口
function openChatImport() { openUnifiedImport('chat'); }
window.openUnifiedImport = openUnifiedImport;

// 行级标注查看器 + AI 接待建议
function openChatViewer(id) {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  if (!c.lines || !c.lines.length) {
    const raw = (c.raw || '').trim();
    c.lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((text) => ({ side: 'unknown', text }));
  }
  const sideLabel = (s) => (s === 'me' ? '我' : s === 'client' ? '客户' : '未定');
  const lineHtml = (l, i) => {
    const side = l.side || 'unknown';
    const cls = side === 'me' ? 'me' : side === 'client' ? 'client' : 'unknown';
    return `<div class="chat-line ${cls}" data-i="${i}">
      <button type="button" class="cl-side" data-toggle="${i}">${sideLabel(side)}</button>
      <div class="cl-text">${esc(l.text)}</div>
    </div>`;
  };
  openModal('聊天记录 · ' + (c.clientName || '未指定客户'), `
    ${c.summary ? `<div class="batch-note">📌 小结：${esc(c.summary)}</div>` : ''}
    <div class="chat-conv" id="chatConv">${c.lines.map(lineHtml).join('')}</div>
    <div class="chat-actions">
      <button type="button" class="btn-mini" id="chSaveTags">💾 保存标注</button>
      <button type="button" class="btn-ai" id="chSuggest">🤖 AI 接待建议</button>
    </div>
    <div class="hidden" id="chSugWrap">
      <div class="batch-note">🤖 AI 接待建议（可直接复制发给客户）</div>
      <pre class="ec-body" id="chSugText"></pre>
      <button type="button" class="btn-mini" id="chCopySug">📋 复制建议</button>
    </div>
  `, { wide: true, noFooter: true });

  // 切换发言方：未定 → 客户 → 我 → 未定（点一下切换一次）
  document.querySelectorAll('#chatConv [data-toggle]').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.toggle;
      const order = ['unknown', 'client', 'me'];
      const cur = c.lines[i].side || 'unknown';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      c.lines[i].side = next;
      const row = b.closest('.chat-line');
      row.classList.remove('client', 'me', 'unknown');
      row.classList.add(next === 'me' ? 'me' : next === 'client' ? 'client' : 'unknown');
      b.textContent = sideLabel(next);
    };
  });

  const sugWrap = document.getElementById('chSugWrap');
  const sugText = document.getElementById('chSugText');
  document.getElementById('chSaveTags').onclick = async () => {
    try {
      await api('/api/chats/' + id, { method: 'PUT', body: JSON.stringify({ lines: c.lines, raw: c.raw, title: c.title, clientName: c.clientName, summary: c.summary }) });
      toast('标注已保存'); closeModal(); loadChatLogs();
    } catch (err) { toast('保存失败：' + (err && err.message ? err.message : err)); }
  };
  document.getElementById('chSuggest').onclick = async () => {
    const btn = document.getElementById('chSuggest');
    btn.disabled = true; btn.textContent = '🤖 生成中…';
    try {
      const conv = c.lines.map((l) => ((l.side === 'me' ? '我' : l.side === 'client' ? '客户' : '？') + '：' + l.text)).join('\n');
      const sys = '你是外贸业务助理，代表中国机械设备出口公司（本公司）与海外客户沟通。下面是一段你与客户的聊天记录，'
        + '请基于上下文，用简体中文写一条「我（业务员）」接下来可以发送给客户的回复建议，语气专业、礼貌、促进成交。'
        + '只返回建议回复文本本身，不要解释、不要引号、不要 markdown。';
      const { content } = await aiChat([
        { role: 'system', content: sys },
        { role: 'user', content: (conv || '').slice(0, 4000) },
      ], { temperature: 0.5 });
      sugText.textContent = content || '（模型未返回内容）';
      sugWrap.classList.remove('hidden');
    } catch (err) {
      sugText.textContent = '生成失败：' + (err && err.message ? err.message : err) + '（请确认已在「🤖 AI 助手设置」配置本地模型）';
      sugWrap.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = '🤖 AI 接待建议';
    }
  };
  document.getElementById('chCopySug').onclick = () => {
    const t = sugText.textContent || '';
    if (t) navigator.clipboard.writeText(t).then(() => toast('已复制'), () => toast('复制失败'));
  };
}

// 进入视图时刷新（包裹式注册，不覆盖其它模块的钩子）
window.onViewActivated = (function (orig) {
  return function (view) {
    if (typeof orig === 'function') orig(view);
    if (view === 'chatlog') loadChatLogs();
  };
})(window.onViewActivated);

window.loadChatLogs = loadChatLogs;
