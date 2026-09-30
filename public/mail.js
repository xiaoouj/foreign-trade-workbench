// ====== 邮件中心：收件箱 + 已发送 + 撰写 ======
// 2026-08-28 UX 增强：发信成功后自动归档到「沟通记录」（通道=邮件），业务员无需再补录（少重复操作）。
let mailTab = 'inbox';
let sentMails = [], currentSMTP = null;

function fmtTS(ts) { const d = new Date(ts); return d.toISOString().slice(0, 16).replace('T', ' '); }
function fmtPreview(text, max) { return (text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, max || 80); }

async function loadMail() {
  try { const r = await api('/api/mail/accounts'); if (r.ok) currentSMTP = await r.json(); } catch { currentSMTP = null; }
  try { const r = await api('/api/mail/sent'); if (r.ok) sentMails = await r.json(); } catch { sentMails = []; }
  renderInbox(); renderSent(); fillMailTemplates(); switchMailTab(mailTab);
}

// 收件人 → 客户名匹配（优先公司名包含，其次联系人邮箱）
function matchClientByEmail(to) {
  const s = String(to || '').toLowerCase();
  const email = (s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [null])[0];
  for (const cl of (clients || [])) {
    const cn = String(cl.company || '');
    if (cn && s.includes(cn.toLowerCase())) return cl.company;
    if (email && [cl.contactEmail, cl.email].some((e) => String(e || '').toLowerCase() === email)) return cl.company;
  }
  return null;
}

// ====== 收件箱 ======
function renderInbox() {
  const list = $('#mailInboxList');
  const mails = (comms || []).filter((c) => c.channel === '邮件').sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
  if (!mails.length) {
    list.innerHTML = '<div class="mail-empty">📭 暂无邮件</div>';
    return;
  }
  list.innerHTML = mails.map((m, i) => {
    const sender = m.contactName || '未知';
    const initial = (sender[0] || '?').toUpperCase();
    const subj = (m.summary || '(无主题)').slice(0, 60);
    const preview = fmtPreview(m.content || '', 80);
    return `<div class="mail-card" data-mi="${i}">
      <div class="mail-avatar">${esc(initial)}</div>
      <div class="mail-card-body">
        <div class="mail-card-top"><span class="mail-card-sender">${esc(sender)}</span><span class="mail-card-date">${esc(m.date || '')}</span></div>
        <div class="mail-card-subj">${esc(subj)}</div>
        <div class="mail-card-prev">${esc(preview)}</div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.mail-card').forEach((card) => card.addEventListener('click', () => {
    const mi = Number(card.dataset.mi); const m = mails[mi]; if (!m) return;
    $('#mailDetailHead').innerHTML = '<div class="mail-detail-sender"><div class="mail-avatar large">' + esc((m.contactName || '?')[0].toUpperCase()) + '</div><div><div class="mail-detail-name">' + esc(m.contactName || '未知') + '</div><div class="muted" style="font-size:12px">' + esc(m.date || '') + '</div></div></div>';
    $('#mailDetailSubj').textContent = m.summary || '(无主题)';
    $('#mailDetailBody').innerHTML = '<pre class="mail-content">' + esc(m.content || '（空）') + '</pre>';
    $('#mailDetail').classList.remove('hidden'); $('#mailInboxList').classList.add('hidden');
    $('#mailDetail').dataset.mailData = JSON.stringify({ to: m.contactName || '', subj: m.summary || '', body: m.content || '' });
  }));
}

// ====== 已发送 ======
function renderSent() {
  const list = $('#mailSentList');
  sentMails.sort((a, b) => b.sentAt - a.sentAt);
  if (!sentMails.length) { list.innerHTML = '<div class="mail-empty">📤 暂无已发送邮件</div>'; return; }
  list.innerHTML = sentMails.map((s) => `<div class="mail-card">
    <div class="mail-avatar">📤</div>
    <div class="mail-card-body">
      <div class="mail-card-top"><span class="mail-card-sender">发至 ${esc(s.to)}</span><span class="mail-card-date">${esc(fmtTS(s.sentAt))}</span></div>
      <div class="mail-card-subj">${esc(s.subject || '(无主题)')}</div>
      <div class="mail-card-prev">${esc(fmtPreview(s.body, 80))}</div>
    </div>
  </div>`).join('');
}

// ====== 撰写 ======
function fillMailTemplates() {
  if (typeof emails === 'undefined') return;
  const sel = $('#mailTmpl');
  sel.innerHTML = '<option value="">— 模板 —</option>' + emails.map((e) => '<option value="' + e.id + '">' + esc(e.subject || '(无主题)') + '</option>').join('');
  sel.onchange = () => { const t = emails.find((e) => e.id === sel.value); if (t) { $('#mailSubject').value = t.subject || ''; $('#mailBody').value = t.body || ''; } };
}
async function sendMail() {
  const to = $('#mailTo').value.trim();
  if (!to) { toast('请输入收件人'); return; }
  if (!currentSMTP || !currentSMTP.user) { toast('当前账号未启用邮件发送'); return; }
  const body = $('#mailBody').value, subject = $('#mailSubject').value;
  $('#mailSendBtn').disabled = true; $('#mailResult').textContent = '发送中…';
  try {
    const r = await api('/api/mail/send', { method: 'POST', body: JSON.stringify({ to, cc: $('#mailCc').value, subject, text: body }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); $('#mailResult').textContent = '❌ ' + (j.error || '发送失败'); return; }
    $('#mailResult').textContent = '✅ 已发送';
    await api('/api/mail/sent', { method: 'POST', body: JSON.stringify({ to, cc: $('#mailCc').value, subject, body }) });
    try { const sr = await api('/api/mail/sent'); if (sr.ok) sentMails = await sr.json(); } catch {}
    renderSent();
    // ③ 自动归档到「沟通记录」（通道=邮件），业务员无需再补录
    try {
      const cname = matchClientByEmail(to) || String(to).replace(/.*<([^>]+)>.*/, '$1').trim().slice(0, 60);
      await api('/api/comms', { method: 'POST', body: JSON.stringify({
        clientName: cname || '未指定客户', channel: '邮件', date: new Date().toISOString().slice(0, 10),
        summary: subject || '(无主题)', content: body || ''
      }) });
      if (typeof loadComms === 'function') loadComms();
    } catch (e) { /* 归档失败不阻塞发信主流程 */ }
    $('#mailTo').value = ''; $('#mailCc').value = ''; $('#mailSubject').value = ''; $('#mailBody').value = '';
  } catch (e) { $('#mailResult').textContent = '❌ ' + e.message; }
  finally { $('#mailSendBtn').disabled = false; }
}
function replyMail() {
  const d = JSON.parse($('#mailDetail').dataset.mailData || '{}');
  $('#mailTo').value = d.to || '';
  $('#mailSubject').value = 'Re: ' + (d.subj || '').replace(/^Re:\s*/i, '');
  switchMailTab('compose');
}

// ====== 页签 ======
function switchMailTab(tab) {
  if(!['inbox','sent','compose'].includes(tab))tab='inbox';
  mailTab = tab;
  ['inbox', 'sent', 'compose'].forEach((t) => {
    const el = $('#mail' + t[0].toUpperCase() + t.slice(1)); if (el) el.classList.toggle('hidden', t !== tab);
  });
  ['mailTabInbox', 'mailTabSent', 'mailTabCompose'].forEach((id) => { const b = $('#' + id); if (b) b.classList.toggle('active', id === 'mailTab' + tab[0].toUpperCase() + tab.slice(1)); });
}

// ====== 绑定 ======
(function () {
  const bnd = (id, fn) => { const b = $('#' + id); if (b) b.addEventListener('click', fn); };
  bnd('mailTabInbox', () => { renderInbox(); switchMailTab('inbox'); });
  bnd('mailTabSent', () => { renderSent(); switchMailTab('sent'); });
  bnd('mailTabCompose', () => switchMailTab('compose'));
  bnd('mailSendBtn', sendMail);
  bnd('mailReply', replyMail);
  bnd('mailDetailBack', () => { $('#mailDetail').classList.add('hidden'); $('#mailInboxList').classList.remove('hidden'); });
})();
window.loadMail = loadMail;
