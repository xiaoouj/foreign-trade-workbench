// ================= 联系人（Contact）模块 =================
// 一个客户公司可挂多个联系人（采购/老板/收货人/财务等），替代原单联系人字段。
// 主联系人会同步回客户档案的 contactName/contactEmail/contactPhone，供 WhatsApp/邮件等旧模块继续使用。

let contacts = [];
const CONTACT_ROLES = ['采购', '老板', '收货人', '财务', '技术', '其他'];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function fetchContacts() {
  try { contacts = await api('/api/contacts').then((r) => r.json()); } catch { contacts = []; }
  return contacts;
}
window.fetchContacts = fetchContacts;
window.getAllContacts = () => contacts;
window.getContactsByClient = (clientId) => contacts.filter((c) => c.clientId === clientId);

// 渲染某个客户的联系人区块（注入到客户详情弹窗的 #cdContacts 容器）
async function renderContactsInto(clientId, mount) {
  if (!mount) return;
  let rows = [];
  try { rows = await api('/api/contacts?clientId=' + encodeURIComponent(clientId)).then((r) => r.json()); } catch { rows = []; }
  if (!rows.length) {
    mount.innerHTML = '<div class="muted" style="font-size:12px">暂无联系人，点击下方「+ 添加联系人」记录采购 / 老板 / 收货人等。</div>'
      + '<button class="btn-mini" id="cdAddContact" type="button">+ 添加联系人</button>';
    bindContactBtns(clientId, mount);
    return;
  }
  mount.innerHTML = rows.map((c) => `
    <div class="contact-row ${c.isPrimary ? 'primary' : ''}">
      <div class="contact-avatar">${esc((c.name || '?')[0].toUpperCase())}</div>
      <div class="contact-main">
        <div class="contact-name">${esc(c.name || '未命名')} ${c.isPrimary ? '<span class="tag-primary">主联系人</span>' : ''}</div>
        <div class="contact-meta">${esc(c.role || '')}${c.title ? ' · ' + esc(c.title) : ''}${c.phone ? ' · 📞 ' + esc(c.phone) : ''}${c.email ? ' · ✉️ ' + esc(c.email) : ''}</div>
      </div>
      <div class="contact-ops">
        ${c.isPrimary ? '' : '<button class="link-btn" data-setprim="' + c.id + '">设为主</button>'}
        <button class="link-btn" data-edit-c="' + c.id + '">编辑</button>
        <button class="link-btn danger" data-del-c="' + c.id + '">删除</button>
      </div>
    </div>`).join('') + '<button class="btn-mini" id="cdAddContact" type="button">+ 添加联系人</button>';
  bindContactBtns(clientId, mount, rows);
}

function bindContactBtns(clientId, mount, rows) {
  const add = mount.querySelector('#cdAddContact');
  if (add) add.onclick = () => openContactModal(clientId, null, mount);
  mount.querySelectorAll('[data-edit-c]').forEach((b) => b.onclick = () => {
    const c = (rows || []).find((x) => x.id === b.dataset.editC) || null;
    openContactModal(clientId, b.dataset.editC, mount, c);
  });
  mount.querySelectorAll('[data-del-c]').forEach((b) => b.onclick = async () => {
    if (!confirm('确定删除该联系人？')) return;
    const r = await api('/api/contacts/' + b.dataset.delC, { method: 'DELETE' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('删除失败：' + (j.error || r.status)); return; }
    toast('已删除'); renderContactsInto(clientId, mount);
  });
  mount.querySelectorAll('[data-setprim]').forEach((b) => b.onclick = async () => {
    const r = await api('/api/contacts/' + b.dataset.setprim, { method: 'PUT', body: JSON.stringify({ isPrimary: true }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('操作失败：' + (j.error || r.status)); return; }
    toast('已设为主联系人');
    // 同步客户主联系人字段
    const c = (rows || []).find((x) => x.id === b.dataset.setprim) || {};
    if (window.updateClientLegacyContact) window.updateClientLegacyContact(clientId, { contactName: c.name, contactEmail: c.email, contactPhone: c.phone });
    renderContactsInto(clientId, mount);
  });
}

function openContactModal(clientId, id, mount, existing) {
  const c = existing || (id ? (contacts.find((x) => x.id === id) || {}) : {});
  const roleOpts = ['<option value="">— 角色 —</option>',
    ...CONTACT_ROLES.map((r) => `<option ${r === c.role ? 'selected' : ''}>${r}</option>`)].join('');
  openModal(id ? '编辑联系人' : '新增联系人', `
    ${field('姓名 *', 'name', c.name, 'text', 'required')}
    <div class="form-grid">
      <div class="field"><label>角色</label><select name="role">${roleOpts}</select>
        <input name="roleFree" value="${esc(c.role && !CONTACT_ROLES.includes(c.role) ? c.role : '')}" placeholder="或自定义角色" style="margin-top:6px"/></div>
      ${field('职位', 'title', c.title)}
    </div>
    <div class="form-grid">
      ${field('电话', 'phone', c.phone)}
      ${field('邮箱', 'email', c.email, 'email')}
    </div>
    <div class="field"><label class="chk-inline"><input type="checkbox" name="isPrimary" ${c.isPrimary ? 'checked' : ''}/> 设为主联系人（同步到客户档案的联系人字段）</label></div>
    <div class="field full"><label>备注</label><textarea name="notes" rows="2">${esc(c.notes)}</textarea></div>
  `);
  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    let role = fd.role || '';
    if (!role && fd.roleFree) role = fd.roleFree;
    const body = {
      clientId,
      name: fd.name,
      role,
      title: fd.title || '',
      phone: fd.phone || '',
      email: fd.email || '',
      isPrimary: !!fd.isPrimary,
      notes: fd.notes || '',
    };
    const url = id ? '/api/contacts/' + id : '/api/contacts';
    const m = id ? 'PUT' : 'POST';
    const r = await api(url, { method: m, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || ('HTTP ' + r.status))); return; }
    const saved = await r.json();
    // 主联系人同步回客户档案
    if (saved.isPrimary && window.updateClientLegacyContact) {
      window.updateClientLegacyContact(clientId, { contactName: saved.name, contactEmail: saved.email, contactPhone: saved.phone });
    }
    toast('已保存'); closeModal();
    if (mount) renderContactsInto(clientId, mount);
    fetchContacts();
  };
}

// 预加载（随客户/订单一起）供报表模块使用
window.addEventListener('ftw:dataReady', () => { fetchContacts(); });
