// ====== 产品内容库模块（非业务：产品卖点/规格/描述集中管理） ======
let products = [];
let productSearchQ = '';

function loadProducts() {
  api('/api/products').then((r) => r.json()).then((a) => { products = a || []; renderProducts(); })
    .catch(() => { products = []; renderProducts(); });
}

function productFilter(list) {
  if (!productSearchQ) return list;
  const q = productSearchQ.toLowerCase();
  return list.filter((p) => [p.name, p.model, p.category, p.description].some((v) => (v || '').toLowerCase().includes(q)));
}

function renderProducts() {
  const list = productFilter(products).slice().sort(newestRecords);
  const body = $('#productBody');
  if (!body) return;
  if (!list.length) { body.innerHTML = '<tr><td colspan="6" class="empty">还没有产品，点右上角新增</td></tr>'; return; }
  body.innerHTML = list.map((p) => `<tr>
    <td>${esc(p.name || '未命名')}</td>
    <td>${esc(p.model || '-')}</td>
    <td>${esc(p.category || '-')}</td>
    <td class="pro-desc">${esc(p.description || '-')}</td>
    <td>${p.price ? Number(p.price).toLocaleString() + ' ' + esc(p.currency || 'USD') : '-'}</td>
    <td>
      <button class="link-btn" data-edit-p="${p.id}">编辑</button>
      <button class="link-btn danger" data-del-p="${p.id}">删除</button>
    </td>
  </tr>`).join('');
  body.querySelectorAll('[data-edit-p]').forEach((b) => b.onclick = () => openProductModal(b.dataset.editP));
  body.querySelectorAll('[data-del-p]').forEach((b) => b.onclick = async () => {
    if (confirm('确认删除该产品？')) { await api('/api/products/' + b.dataset.delP, { method: 'DELETE' }); toast('已删除'); loadProducts(); }
  });
}

function openProductModal(id) {
  const p = id ? products.find((x) => x.id === id) : {};
  openModal(id ? '编辑产品' : '新增产品', `
    <div class="field"><label>名称 *</label><input name="name" value="${esc(p.name)}" placeholder="如：链板输送机" required /></div>
    <div class="field"><label>型号</label><input name="model" value="${esc(p.model)}" /></div>
    <div class="field"><label>类目</label><input name="category" value="${esc(p.category)}" placeholder="如：输送设备" /></div>
    <div class="field"><label>参考价</label><input name="price" type="number" step="0.01" value="${esc(p.price)}" /></div>
    <div class="field"><label>币种</label><input name="currency" value="${esc(p.currency || 'USD')}" /></div>
    <div class="field full"><label>描述 / 卖点</label><textarea name="description" rows="5" placeholder="产品描述、核心卖点、适用场景…">${esc(p.description)}</textarea></div>
  `);
  $('#modalForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const url = id ? '/api/products/' + id : '/api/products';
    const m = id ? 'PUT' : 'POST';
    await api(url, { method: m, body: JSON.stringify(fd) });
    toast('已保存'); closeModal(); loadProducts();
  };
}

$('#productAdd').onclick = () => openProductModal();
$('#productSearch').oninput = (e) => { productSearchQ = e.target.value.trim().toLowerCase(); renderProducts(); };

window.loadProducts = loadProducts;
