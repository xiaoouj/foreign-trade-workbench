// ====== 资料 / 知识库（融合 GoodJob：资料/知识库） ======
// 类目化 + 版本快照 + 审核流转（草稿/已发布/已归档）。数据经 /api/knowledge，RBAC 与服务端一致。
const KB_CATEGORIES = ['产品', '客户', '报价', '物流', '单证', '展会', '培训', '制度', '其他'];
const KB_STATUS_BADGE = { 草稿: 'info', 已发布: 'ok', 已归档: 'muted' };

let kbItems = [];
let kbFilter = { category: '', status: '', q: '' };

async function loadKnowledge() {
  try {
    const p = new URLSearchParams();
    if (kbFilter.category) p.set('category', kbFilter.category);
    if (kbFilter.status) p.set('status', kbFilter.status);
    if (kbFilter.q) p.set('q', kbFilter.q);
    const r = await api('/api/knowledge?' + p.toString(), { timeout: 10000 });
    if (!r.ok) throw new Error('加载失败');
    kbItems = await r.json();
    return kbItems;
  } catch (e) { console.error('loadKnowledge', e); return []; }
}

function kbCardHtml(it) {
  const canEdit = !!(currentUser && (['admin', 'manager'].includes(currentUser.role) || it.owner === currentUser.id));
  const isAdmin = !!(currentUser && ['admin', 'manager'].includes(currentUser.role));
  return `
    <div class="kb-card">
      <div class="kb-tt">${esc(it.title || '（无标题）')}</div>
      <div class="kb-desc">${esc(it.content || '')}</div>
      <div class="kb-tags">${(it.tags || []).slice(0, 4).map((t) => `<span class="badge info">${esc(t)}</span>`).join(' ')}</div>
      <div class="kb-foot">
        <span><span class="badge ${KB_STATUS_BADGE[it.status] || 'info'}">${esc(it.status || '草稿')}</span> <span class="muted">v${it.version || 1}</span></span>
        <span class="muted">${esc(it.ownerName || '')} · ${(it.updatedAt ? new Date(it.updatedAt) : new Date()).toLocaleDateString('zh-CN')}</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-ghost btn-mini" data-kb-view="${it.id}">查看</button>
        ${canEdit ? `<button class="btn-ghost btn-mini" data-kb-edit="${it.id}">编辑</button>` : ''}
        ${isAdmin && it.status !== '已发布' ? `<button class="btn-primary btn-mini" data-kb-pub="${it.id}">发布</button>` : ''}
        ${isAdmin && it.status !== '已归档' ? `<button class="btn-ghost btn-mini" data-kb-arc="${it.id}">归档</button>` : ''}
      </div>
    </div>`;
}

function renderKb() {
  const wrap = document.getElementById('kbGrid');
  if (!wrap) return;
  // 头部统计行
  const cats = Object.entries(
    kbItems.reduce((a, x) => { a[x.category || '其他'] = (a[x.category || '其他'] || 0) + 1; return a; }, {})
  );
  const catChips = ['<span class="chip active" data-cat="">全部</span>']
    .concat(cats.map(([c, n]) => `<span class="chip" data-cat="${esc(c)}">${esc(c)} ${n}</span>`)).join('');
  const cc = document.getElementById('kbCats'); if (cc) cc.innerHTML = catChips;
  cc.querySelectorAll('[data-cat]').forEach((c) => c.onclick = () => { cc.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); c.classList.add('active'); kbFilter.category = c.dataset.cat; refreshKb(); });

  if (!kbItems.length) { wrap.innerHTML = '<div class="empty">暂无资料，点右上角「+ 新建资料」添加</div>'; return; }
  wrap.innerHTML = kbItems.slice().sort(newestRecords).map(kbCardHtml).join('');
  wrap.querySelectorAll('[data-kb-view]').forEach((b) => b.onclick = () => kbDetail(b.dataset.kbView));
  wrap.querySelectorAll('[data-kb-edit]').forEach((b) => b.onclick = () => kbEdit(b.dataset.kbEdit));
  wrap.querySelectorAll('[data-kb-pub]').forEach((b) => b.onclick = () => kbReview(b.dataset.kbPub, 'publish'));
  wrap.querySelectorAll('[data-kb-arc]').forEach((b) => b.onclick = () => kbReview(b.dataset.kbArc, 'archive'));
}

async function refreshKb() { await loadKnowledge(); renderKb(); }

async function kbReview(id, action) {
  try {
    const r = await api('/api/knowledge/' + id + '/review', { method: 'POST', body: JSON.stringify({ action }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '操作失败');
    toast(action === 'publish' ? '已发布' : '已归档');
    refreshKb();
  } catch (e) { toast(ehK(e)); }
}
const ehK = (e) => (e && e.message) || '网络错误';

function kbEdit(id) {
  const it = kbItems.find((x) => x.id === id) || { category: '其他', status: '草稿', title: '', content: '', tags: [] };
  const catOpts = KB_CATEGORIES.map((c) => `<option ${c === it.category ? 'selected' : ''}>${c}</option>`).join('');
  openModal(id ? '编辑资料 v' + (it.version || 1) : '新建资料', `
    <div class="field"><label>标题</label><input name="title" required value="${esc(it.title || '')}" placeholder="资料标题"/></div>
    <div class="field"><label>类目</label><select name="category">${catOpts}</select></div>
    <div class="field"><label>状态</label><select name="status">
      <option ${(!it.status || it.status === '草稿') ? 'selected' : ''}>草稿</option>
      <option ${it.status === '已发布' ? 'selected' : ''}>已发布</option>
    </select></div>
    <div class="field"><label>标签（逗号分隔）</label><input name="tags" value="${esc((it.tags || []).join(', '))}" placeholder="如：规格, 材质"/></div>
    <div class="field"><label>正文</label><textarea name="content" rows="8" style="width:100%;resize:vertical">${esc(it.content || '')}</textarea></div>`, { wide: true });
  const form = document.getElementById('modalForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      title: (fd.get('title') || '').trim(),
      category: fd.get('category'),
      status: fd.get('status'),
      tags: String(fd.get('tags') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      content: fd.get('content'),
    };
    if (!body.title) { toast('请填写标题'); return; }
    try {
      let ok;
      if (id) { const r = await api('/api/knowledge/' + id + '/version', { method: 'POST', body: JSON.stringify(body) }); ok = r.ok; }
      else { const r = await api('/api/knowledge', { method: 'POST', body: JSON.stringify(body) }); ok = r.ok; }
      if (!ok) throw new Error('保存失败');
      closeModal(); toast('已保存'); refreshKb();
    } catch (err) { toast(ehK(err)); }
  };
}

async function kbDetail(id) {
  const it = kbItems.find((x) => x.id === id);
  if (!it) return;
  const vs = (it.versions || []).slice().reverse();
  openModal('资料详情', `
    <div style="font-size:13px;color:var(--ink-soft);margin-bottom:8px">
      <span class="badge ${KB_STATUS_BADGE[it.status] || 'info'}">${esc(it.status || '草稿')}</span>
      <span class="badge info">${esc(it.category || '')}</span>
      <span class="muted">v${it.version} · ${esc(it.ownerName || '')}</span>
      ${(it.tags || []).map((t) => `<span class="badge info">${esc(t)}</span>`).join(' ')}
    </div>
    <div style="white-space:pre-wrap;font-size:13.5px;line-height:1.7">${esc(it.content || '')}</div>
    ${vs.length ? `
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0"/>
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">历史版本</div>
      ${vs.map((v) => `<div style="font-size:12px;color:var(--ink-soft);display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line-2)">
        <span>v${v.version} · ${esc(v.title || '')}</span><span>${esc(v.by || '')} ${new Date(v.at).toLocaleString('zh-CN')}</span>
      </div>`).join('')}` : ''}`, { noFooter: true });
}

// 接入视图激活钩子
window.onViewActivated = (function (orig) {
  return function (view) {
    if (typeof orig === 'function') orig(view);
    if (view === 'knowledge') renderKnowledgeView();
  };
})(window.onViewActivated);

async function renderKnowledgeView() {
  const sec = document.getElementById('view-knowledge');
  if (!sec) return;
  sec.innerHTML = `
    <div class="view-head" style="justify-content:space-between">
      <div style="display:flex;align-items:center;gap:12px">
        <h2>资料 / 知识库</h2>
        <span class="muted">类目化沉淀产品、流程、经验，支持版本与审核</span>
      </div>
      <button class="btn-primary" id="kbNew">+ 新建资料</button>
    </div>
    <div class="kb-toolbar">
      <label>搜索 <input id="kbSearch" placeholder="标题 / 正文关键词"/></label>
      <label>状态 <select id="kbStatus">
        <option value="">全部</option><option value="草稿">草稿</option><option value="已发布">已发布</option><option value="已归档">已归档</option>
      </select></label>
      <button class="btn-ghost" id="kbRefresh">刷新</button>
    </div>
    <div id="kbCats" class="kb-cats"></div>
    <div id="kbGrid" class="kb-grid"></div>`;
  document.getElementById('kbNew').onclick = () => kbEdit('');
  document.getElementById('kbRefresh').onclick = () => refreshKb();
  const s = document.getElementById('kbSearch'); s.oninput = () => { kbFilter.q = s.value; refreshKb(); };
  const st = document.getElementById('kbStatus'); st.onchange = () => { kbFilter.status = st.value; refreshKb(); };
  sec.querySelector('#kbGrid').innerHTML = '<div class="empty">加载中…</div>';
  await refreshKb();
}