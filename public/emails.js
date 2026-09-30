// ====== 开发信草稿模块（非业务：可复用邮件/开发信模板） ======
let emails = [];
let emailSearchQ = '';

function loadEmails() {
  api('/api/emails').then((r) => r.json()).then((a) => { emails = a || []; renderEmails(); })
    .catch(() => { emails = []; renderEmails(); });
}

function emailFilter(list) {
  if (!emailSearchQ) return list;
  const q = emailSearchQ.toLowerCase();
  return list.filter((e) => [e.title, e.body, e.tags].some((v) => (v || '').toLowerCase().includes(q)));
}

function renderEmails() {
  const list = emailFilter(emails).slice().sort(newestRecords);
  const wrap = $('#emailList');
  if (!wrap) return;
  if (!list.length) { wrap.innerHTML = '<div class="empty">还没有开发信草稿，点右上角新建</div>'; return; }
  wrap.innerHTML = list.map((e) => {
    const body = (e.body || '').replace(/\s+/g, ' ').trim();
    const preview = body.length > 150 ? body.slice(0, 150) + '…' : body;
    const tags = (e.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
      .map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    return `<div class="email-card" data-id="${e.id}">
      <div class="ec-head">
        <div class="ec-title">${esc(e.title || '未命名草稿')}</div>
        ${tags ? `<div class="ec-tags">${tags}</div>` : ''}
      </div>
      <div class="ec-body">${esc(preview)}</div>
      <div class="ec-foot">
        <button class="link-btn" data-edit-e="${e.id}">编辑</button>
        <button class="link-btn" data-copy-e="${e.id}">复制正文</button>
        <button class="link-btn danger" data-del-e="${e.id}">删除</button>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-edit-e]').forEach((b) => b.onclick = () => openEmailModal(b.dataset.editE));
  wrap.querySelectorAll('[data-del-e]').forEach((b) => b.onclick = async () => {
    if (confirm('确认删除该草稿？')) { await api('/api/emails/' + b.dataset.delE, { method: 'DELETE' }); toast('已删除'); loadEmails(); }
  });
  wrap.querySelectorAll('[data-copy-e]').forEach((b) => b.onclick = () => copyEmail(b.dataset.copyE));
}

async function copyEmail(id) {
  const e = emails.find((x) => x.id === id);
  if (!e) return;
  let body = e.body || '';
  for (const v of ['客户', '产品', '国家']) {
    const re = new RegExp('\\{' + v + '\\}', 'g');
    if (re.test(body)) {
      const val = prompt('请填写变量「' + v + '」：', '');
      body = body.replace(re, val != null && val !== '' ? val : ('{' + v + '}'));
    }
  }
  try {
    await navigator.clipboard.writeText(body);
    toast('正文已复制到剪贴板');
  } catch {
    const ta = document.createElement('textarea'); ta.value = body; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    toast('正文已复制到剪贴板');
  }
}

function openEmailModal(id) {
  const e = id ? emails.find((x) => x.id === id) : { tags: '' };
  openModal(id ? '编辑开发信' : '新建开发信', `
    <div class="field"><label>标题</label><input name="title" value="${esc(e.title)}" placeholder="如：首封开发信-链板输送机" /></div>
    <div class="field"><label>标签（逗号分隔）</label><input name="tags" value="${esc(e.tags)}" placeholder="如：首封,链板,欧美" /></div>
    <div class="field full"><label>正文（支持变量 {客户} {产品} {国家}，点「复制正文」时填写）</label><textarea name="body" rows="10" placeholder="Dear {客户},&#10;&#10;We are glad to introduce our {产品}...">${esc(e.body)}</textarea></div>
  `);
  $('#modalForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const url = id ? '/api/emails/' + id : '/api/emails';
    const m = id ? 'PUT' : 'POST';
    await api(url, { method: m, body: JSON.stringify(fd) });
    toast('已保存'); closeModal(); loadEmails();
  };
}

$('#emailAdd').onclick = () => openEmailModal();
$('#emailSearch').oninput = (e) => { emailSearchQ = e.target.value.trim().toLowerCase(); renderEmails(); };

window.loadEmails = loadEmails;
