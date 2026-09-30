// ====== 出货 / 物流 / 供应商 / 财务 模块 ======
// 数据接口与既有模块一致；owner 隔离由后端保证。

const SHIP_STATUS = ['待发货', '已发货', '在途', '已到港', '已签收'];
const FIN_TYPES = ['应收', '已收', '应付供应商', '其他'];

// ---------- 出货 / 物流 ----------
let shipments = [];
async function loadShipments() {
  try { const r = await api('/api/shipments'); shipments = r.ok ? await r.json() : []; } catch { shipments = []; }
  if (document.querySelector('#view-order-detail.active') && typeof renderSalesOrder==='function') renderSalesOrder();
  renderShipments();
}
// 未出货订单（状态不是 已发货/已完成/已取消）
function orderHasShipment(orderNo) {
  return shipments.some((s) => s.orderNo && s.orderNo === orderNo);
}
function unshippedOrders() {
  if (typeof orders === 'undefined') return [];
  return orders.filter((o) => o.orderNo && !orderHasShipment(o.orderNo));
}
function renderShipments() {
  const body = document.querySelector('#shipBody');
  if (!body) return;
  if (!shipments.length) { body.innerHTML = '<tr><td colspan="10" class="empty">暂无出货单，点击右上角新增</td></tr>'; return; }
  body.innerHTML = shipments.slice().sort(newestRecords).map((s) => {
    const linkedOrder = (typeof orders !== 'undefined') ? orders.find((o) => o.orderNo && o.orderNo === s.orderNo) : null;
    return `<tr>
    <td>${esc(s.shipmentNo || '-')}</td>
    <td>${esc(s.clientName || '-')}</td>
    <td>${s.orderNo ? `<a class="link-name" data-detail-o="${esc(s.orderNo)}">${esc(s.orderNo)}</a>` : '-'}</td>
    <td><span class="stage st-${linkedOrder?.status || ''}">${esc(linkedOrder?.status || '-')}</span></td>
    <td><span class="stage st-${s.status || '待发货'}">${esc(s.status || '待发货')}</span></td>
    <td>${esc(s.carrier || '-')}</td>
    <td>${esc(s.trackingNo || '-')}</td>
    <td>${esc(s.eta || '-')}</td>
    <td>${esc(s.destination || '-')}</td>
    <td>
      <button class="link-btn" data-sh="${s.id}">编辑</button>
      <button class="link-btn" data-shdoc="${s.id}">单证</button>
      <button class="link-btn danger" data-shdel="${s.id}">删除</button>
    </td>
  </tr>`;
  }).join('');
  body.querySelectorAll('[data-sh]').forEach((b) => b.onclick = () => openShipmentModal(b.dataset.sh));
  body.querySelectorAll('[data-shdoc]').forEach((b) => b.onclick = () => openShipDoc(b.dataset.shdoc));
  body.querySelectorAll('[data-shdel]').forEach((b) => b.onclick = async () => {
    if (confirm('确认删除该出货单？')) { await api('/api/shipments/' + b.dataset.shdel, { method: 'DELETE' }); toast('已删除'); loadShipments(); }
  });
  body.querySelectorAll('[data-detail-o]').forEach((b) => b.addEventListener('click', () => {
    const o = orders.find((x) => x.orderNo === b.dataset.detailO);
    if (o && typeof openOrderModal !== 'undefined') openOrderModal(o.id);
  }));
}
function openShipmentModal(id, prefill = {}) {
  const s = id ? shipments.find((x) => x.id === id) : prefill;
  const clientOpts = ['', ...(typeof clients !== 'undefined' ? clients : []).map((c) => c.company)];
  const unshipped = unshippedOrders();
  // 关联订单：未出货订单列表 + 当前已关联的订单（保证编辑时可见）
  const orderOpts = ['<option value="">— 未选择订单 —</option>',
    ...unshipped.map((o) => `<option value="${esc(o.orderNo)}" ${o.orderNo === s.orderNo ? 'selected' : ''}>${esc(o.orderNo)} · ${esc(o.clientName || '')} · ${esc(o.status)}</option>`)];
  // 如果当前出货单关联的订单不在未出货列表（历史已发货），单独追加
  if (s.orderNo && !unshipped.some((o) => o.orderNo === s.orderNo)) {
    orderOpts.push(`<option value="${esc(s.orderNo)}" selected>${esc(s.orderNo)} · (已关联)</option>`);
  }
  openModal(id ? '编辑出货单' : '新增出货单', `
    ${field('出货单号 *', 'shipmentNo', s.shipmentNo, 'text', 'required')}
    ${selectField('客户', 'clientName', s.clientName || '', clientOpts)}
    <div class="field full"><label>关联订单（一键选择未出货订单）</label>
      <select name="orderNo" id="shipOrderNo">${orderOpts.join('')}</select>
    </div>
    ${selectField('状态', 'status', s.status || '待发货', SHIP_STATUS)}
    ${field('发货日期', 'shipDate', s.shipDate, 'date')}
    ${field('ETD 预计离港', 'etd', s.etd, 'date')}
    ${field('ETA 预计到港', 'eta', s.eta, 'date')}
    ${field('承运/船司', 'carrier', s.carrier)}
    ${field('运单号', 'trackingNo', s.trackingNo)}
    ${field('柜号', 'containerNo', s.containerNo)}
    ${field('起运地', 'origin', s.origin)}
    ${field('目的港', 'destination', s.destination)}
    ${field('件数', 'packages', s.packages, 'number')}
    ${field('重量(kg)', 'weight', s.weight, 'number', 'step="0.1"')}
    ${field('体积(CBM)', 'volume', s.volume, 'number', 'step="0.01"')}
    ${field('运费', 'freightCost', s.freightCost, 'number', 'step="0.01"')}
    ${selectField('币种', 'currency', s.currency || 'USD', CURRENCIES)}
    <div class="field full"><label>单证备注（提单号/发票号等）</label><textarea name="docsNote" rows="2">${esc(s.docsNote)}</textarea></div>
    <div class="field full"><label>备注</label><textarea name="remark">${esc(s.remark)}</textarea></div>
  `, { wide: true });
  // 选择订单时自动填入客户名
  const orderSelect = document.querySelector('#shipOrderNo');
  const clientSelect = document.querySelector('[name="clientName"]');
  if (orderSelect && clientSelect) {
    orderSelect.addEventListener('change', () => {
      const o = (typeof orders !== 'undefined') ? orders.find((x) => x.orderNo === orderSelect.value) : null;
      if (o && o.clientName) clientSelect.value = o.clientName;
    });
  }
  document.querySelector('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const url = id ? '/api/shipments/' + id : '/api/shipments';
    const m = id ? 'PUT' : 'POST';
    const r = await api(url, { method: m, body: JSON.stringify(fd) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || r.status)); return; }
    // 若关联了未发货订单，自动更新订单状态为"已发货"
    if (fd.orderNo && !orderHasShipment(fd.orderNo)) {
      const o = (typeof orders !== 'undefined') ? orders.find((x) => x.orderNo === fd.orderNo && !['已发货','已完成'].includes(x.status)) : null;
      if (o) {
        await api('/api/orders/' + o.id, { method: 'PUT', body: JSON.stringify({ status: '已发货' }) });
        // 同步本地数据
        o.status = '已发货';
        if (typeof renderOrders === 'function') renderOrders();
      }
    }
    toast('已保存'); closeModal(); loadShipments();
  };
}
// 一键发货：从订单页跳转，预填订单号和客户
function quickShip(order) {
  if (!order) return;
  switchView('shipments');
  // 等出货页面切换到可见后打开弹窗（延迟一帧确保 DOM 切换完成）
  setTimeout(() => {
    openShipmentModal(null, {
      clientName: order.clientName || '',
      orderNo: order.orderNo || '',
      currency: order.currency || 'USD',
      freightCost: order.amount || '',
      status: '待发货',
    });
  }, 80);
}
window.quickShip = quickShip;
// 单证草稿（出货通知 / 提单草稿，可打印）
function openShipDoc(id) {
  const s = shipments.find((x) => x.id === id);
  if (!s) return;
  const rows = [
    ['出货单号', s.shipmentNo], ['客户', s.clientName], ['关联订单号', s.orderNo],
    ['状态', s.status], ['承运/船司', s.carrier], ['运单号', s.trackingNo], ['柜号', s.containerNo],
    ['起运地', s.origin], ['目的港', s.destination], ['ETD', s.etd], ['ETA', s.eta],
    ['件数', s.packages], ['重量(kg)', s.weight], ['体积(CBM)', s.volume],
    ['运费', (Number(s.freightCost) || 0).toLocaleString() + ' ' + (s.currency || 'USD')],
    ['单证备注', s.docsNote], ['备注', s.remark],
  ];
  openModal('单证草稿 · ' + (s.shipmentNo || '未编号'), `
    <div class="doc-preview" id="shipDocPrev">
      <h2 style="text-align:center;margin:0 0 4px">SHIPPING ADVICE / 出货通知</h2>
      <div style="text-align:center;color:#888;margin-bottom:10px">${esc(s.clientName || '')} · ${esc(s.shipmentNo || '')}</div>
      <table class="cd-table">
        ${rows.map((r) => `<tr><td style="width:38%;background:#f7f8fa">${esc(r[0])}</td><td>${esc(r[1] || '-')}</td></tr>`).join('')}
      </table>
      <p class="muted" style="margin-top:10px;font-size:12px">本单据为业务草稿，对外使用前请核对卖方、包装、支付与合规字段。</p>
    </div>
  `, { wide: true, noFooter: true });
  const box = document.querySelector('.modal-box');
  const bar = document.createElement('div');
  bar.className = 'modal-foot';
  bar.innerHTML = `<button type="button" class="btn-ghost" id="mCancel">关闭</button><button type="button" class="btn-save" id="mPrint">🖨 打印 / 保存 PDF</button>`;
  box.appendChild(bar);
  bar.querySelector('#mCancel').onclick = closeModal;
  bar.querySelector('#mPrint').onclick = () => { const w = window.open('', '_blank'); w.document.write('<html><head><title>出货通知</title><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td{border:1px solid #ddd;padding:6px 8px;font-size:13px}.h{background:#f7f8fa}</style></head><body>' + document.querySelector('#shipDocPrev').innerHTML + '</body></html>'); w.document.close(); w.print(); };
}

// ---------- 供应商（公司主数据，共享） ----------
let suppliers = [];
// 供应商附件数量 { supplierId: count }，列表页显示用
let suppFileCounts = {};
async function loadSuppliers() {
  try { const r = await api('/api/suppliers'); suppliers = r.ok ? await r.json() : []; } catch { suppliers = []; }
  // 附件数量单独取，失败也不影响主列表渲染
  try {
    const cr = await api('/api/supplier-file-counts');
    suppFileCounts = cr.ok ? await cr.json() : {};
  } catch { suppFileCounts = {}; }
  renderSuppliers();
}
function renderSuppliers() {
  const body = document.querySelector('#suppBody');
  if (!body) return;
  if (!suppliers.length) { body.innerHTML = '<tr><td colspan="8" class="empty">暂无供应商，点击右上角新增</td></tr>'; return; }
  body.innerHTML = suppliers.slice().sort(newestRecords).map((s) => {
    const fc = suppFileCounts[s.id] || 0;
    return `<tr>
    <td>${esc(s.name || '-')}</td>
    <td>${esc(s.category || '-')}</td>
    <td>${esc(s.contact || '-')}</td>
    <td>${esc(s.phone || '-')}</td>
    <td>${esc(s.email || '-')}</td>
    <td>${esc(s.products || '-')}</td>
    <td><button class="link-btn" data-supfiles="${s.id}" title="打开该供应商的资料附件夹">${fc ? '📎 ' + fc + ' 个文件' : '📁 打开附件夹'}</button></td>
    <td>
      <button class="link-btn" data-su="${s.id}">编辑</button>
      <button class="link-btn danger" data-sudel="${s.id}">删除</button>
    </td>
  </tr>`;
  }).join('');
  body.querySelectorAll('[data-su]').forEach((b) => b.onclick = () => openSupplierModal(b.dataset.su));
  body.querySelectorAll('[data-supfiles]').forEach((b) => b.onclick = () => openSupplierFiles(b.dataset.supfiles));
  body.querySelectorAll('[data-sudel]').forEach((b) => b.onclick = async () => {
    if (confirm('确认删除该供应商？该供应商的资料附件夹会一并删除。')) { await api('/api/suppliers/' + b.dataset.sudel, { method: 'DELETE' }); toast('已删除'); loadSuppliers(); }
  });
}

// ---------- 供应商资料附件夹 ----------
// 存放目录为两级结构：<产品分类>/<公司名称>（后端按供应商 category / name 自动生成），文件直接放在第二层
function suppFileIcon(ext) {
  const m = {
    '.pdf': '📕', '.doc': '📝', '.docx': '📝', '.xls': '📊', '.xlsx': '📊', '.ppt': '📽️', '.pptx': '📽️',
    '.txt': '📄', '.csv': '📊',
    '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.webp': '🖼️', '.bmp': '🖼️', '.svg': '🖼️',
    '.dwg': '📐', '.dxf': '📐', '.step': '📐', '.stp': '📐', '.igs': '📐', '.iges': '📐',
    '.zip': '📦', '.rar': '📦', '.7z': '📦', '.mp4': '🎬',
  };
  return m[String(ext || '').toLowerCase()] || '📄';
}
function fmtFileSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtFileTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function suppFileListHtml(files) {
  if (!files.length) return '<div class="empty">该供应商还没有资料。点上方「选择文件」即可上传到本供应商的资料夹。</div>';
  return files.map((f) => `<div class="supfile-row">
    <span class="supfile-ico">${suppFileIcon(f.ext)}</span>
    <a class="supfile-name" href="${esc(f.url)}" target="_blank" rel="noopener" title="点击下载 / 预览">${esc(f.name)}</a>
    <span class="supfile-size">${esc(fmtFileSize(f.size))}</span>
    <span class="supfile-time">${esc(fmtFileTime(f.mtime))}</span>
    <button class="link-btn danger" data-sfdel="${esc(f.stored)}">删除</button>
  </div>`).join('');
}
// 附件有增删后，同步列表页的 📎 数量（失败不影响弹窗内容）
async function refreshSuppCounts() {
  try {
    const cr = await api('/api/supplier-file-counts');
    if (cr.ok) { suppFileCounts = await cr.json(); renderSuppliers(); }
  } catch { /* 忽略 */ }
}
async function openSupplierFiles(id) {
  const s = suppliers.find((x) => x.id === id);
  if (!s) return;
  let relPath = '';
  let files = [];
  try {
    const r = await api('/api/suppliers/' + id + '/files');
    if (r.ok) {
      const j = await r.json();
      files = Array.isArray(j.files) ? j.files : [];
      relPath = j.path || '';
    }
  } catch { /* 按空列表渲染 */ }
  const loc = relPath || ((s.category || '未分类') + ' / ' + (s.name || '供应商'));

  openModal('资料附件夹 · ' + (s.name || '未命名供应商'), `
    <div class="supfile-head">
      <div class="field full">
        <label>资料存放位置（产品分类 / 公司名称）</label>
        <div class="supfile-path">📁 ${esc(loc)}</div>
      </div>
      <div class="field full">
        <label>选择文件上传（可多选，单个 ≤ 20MB）</label>
        <input type="file" id="supFileInput" multiple
          accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.mp4,.dwg,.dxf,.step,.stp,.igs,.iges" />
      </div>
    </div>
    <div id="supFileStatus" class="muted" style="font-size:12px;min-height:18px"></div>
    <div class="field full"><label>已有资料（<span id="supFileCount">${files.length}</span> 个）</label>
      <div id="supFileList" class="supfile-list">${suppFileListHtml(files)}</div>
    </div>
  `, { wide: true, noFooter: true });

  // 附件弹窗内没有"保存"语义：阻止回车触发表单提交，并只放一个关闭按钮
  const form = document.querySelector('#modalForm');
  if (form) form.onsubmit = (e) => e.preventDefault();
  const box = document.querySelector('.modal-box');
  const bar = document.createElement('div');
  bar.className = 'modal-foot';
  bar.innerHTML = '<button type="button" class="btn-ghost" id="mCancel">关闭</button>';
  box.appendChild(bar);
  bar.querySelector('#mCancel').onclick = closeModal;

  async function refresh() {
    try {
      const r = await api('/api/suppliers/' + id + '/files');
      if (!r.ok) return;
      const j = await r.json();
      const list = Array.isArray(j.files) ? j.files : [];
      const listEl = document.querySelector('#supFileList');
      const cntEl = document.querySelector('#supFileCount');
      if (listEl) listEl.innerHTML = suppFileListHtml(list);
      if (cntEl) cntEl.textContent = list.length;
      bindDelete();
    } catch { /* 忽略 */ }
  }
  function bindDelete() {
    const listEl = document.querySelector('#supFileList');
    if (!listEl) return;
    listEl.querySelectorAll('[data-sfdel]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认删除该附件？删除后不可恢复。')) return;
        const r = await api('/api/suppliers/' + id + '/files?f=' + encodeURIComponent(b.dataset.sfdel), { method: 'DELETE' });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toast('删除失败：' + (j.error || r.status));
          return;
        }
        toast('已删除');
        await refresh();
        refreshSuppCounts();
      };
    });
  }

  bindDelete();
  const input = document.querySelector('#supFileInput');
  const status = document.querySelector('#supFileStatus');
  if (input) {
    input.onchange = async () => {
      const picked = Array.from(input.files || []);
      if (!picked.length) return;
      let ok = 0, fail = 0, lastErr = '';
      for (const f of picked) {
        try {
          if (f.size > 20 * 1024 * 1024) throw new Error(f.name + '：超过 20MB');
          const dataUrl = await new Promise((resolve, reject) => {
            const rd = new FileReader();
            rd.onload = () => resolve(rd.result);
            rd.onerror = () => reject(new Error(f.name + '：读取失败'));
            rd.readAsDataURL(f);
          });
          if (status) status.textContent = `上传中…（${ok + fail + 1}/${picked.length}）${f.name}`;
          const r = await api('/api/suppliers/' + id + '/files', {
            method: 'POST',
            timeout: 120000, // 大文件走 base64，放宽超时
            body: JSON.stringify({ filename: f.name, data: dataUrl }),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(f.name + '：' + (j.error || ('HTTP ' + r.status)));
          }
          ok++;
        } catch (err) {
          fail++;
          lastErr = err.message || String(err);
        }
      }
      input.value = '';
      if (status) {
        status.textContent = fail
          ? `成功 ${ok} 个，失败 ${fail} 个${lastErr ? '（' + lastErr + '）' : ''}`
          : `已上传 ${ok} 个文件到「${loc}」`;
      }
      await refresh();
      refreshSuppCounts();
    };
  }
}
function openSupplierModal(id) {
  const s = id ? suppliers.find((x) => x.id === id) : {};
  openModal(id ? '编辑供应商' : '新增供应商', `
    ${field('名称 *', 'name', s.name, 'text', 'required')}
    ${field('类别', 'category', s.category, 'text', 'placeholder="如 电机/型材/包装"')}
    ${field('联系人', 'contact', s.contact)}
    ${field('电话', 'phone', s.phone)}
    ${field('邮箱', 'email', s.email, 'email')}
    <div class="field full"><label>供应产品</label><textarea name="products">${esc(s.products)}</textarea></div>
    <div class="field full"><label>备注</label><textarea name="remark">${esc(s.remark)}</textarea></div>
  `);
  document.querySelector('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const url = id ? '/api/suppliers/' + id : '/api/suppliers';
    const m = id ? 'PUT' : 'POST';
    await api(url, { method: m, body: JSON.stringify(fd) });
    toast('已保存'); closeModal(); loadSuppliers();
  };
}

// ---------- 财务（应收 / 应付汇总） ----------
let finances = [];
async function loadFinance() {
  try { const r = await api('/api/finance'); finances = r.ok ? await r.json() : []; } catch { finances = []; }
  renderFinance();
}
function finCny(amount, cur) {
  const v = toCNY(Number(amount) || 0, cur);
  return v != null ? v : null;
}
function renderFinance() {
  const body = document.querySelector('#finBody');
  if (!body) return;
  // 汇总（折算 CNY）
  let recv = 0, collected = 0, pay = 0, paid = 0;
  for (const f of finances) {
    const c = finCny(f.amount, f.currency);
    if (c == null) continue;
    if (f.type === '应收' && f.status !== '已收') recv += c;
    if (f.type === '已收' || (f.type === '应收' && f.status === '已收')) collected += c;
    if (f.type === '应付供应商' && f.status !== '已付') pay += c;
    if (f.type === '应付供应商' && f.status === '已付') paid += c;
  }
  // 订单自动汇总（与「订单」页待收款同口径）：应收=未收款订单，已收=已收款/已完成订单
  const AR_STATUS = ['待确认', '已确认', '生产中', '已发货'];
  const DONE_STATUS = ['已收款', '已完成'];
  const orderRecv = orders.filter((o) => AR_STATUS.includes(o.status)).reduce((s, o) => s + (finCny(o.amount, o.currency) || 0), 0);
  const orderCollected = orders.filter((o) => DONE_STATUS.includes(o.status)).reduce((s, o) => s + (finCny(o.amount, o.currency) || 0), 0);
  recv += orderRecv;
  collected += orderCollected;
  const sumEl = document.querySelector('#finSummary');
  if (sumEl) sumEl.innerHTML = `
    <div class="stat-card"><div class="stat-num">${fmtMoney(recv)}</div><div class="stat-label">应收未收</div></div>
    <div class="stat-card"><div class="stat-num">${fmtMoney(collected)}</div><div class="stat-label">已收</div></div>
    <div class="stat-card"><div class="stat-num">${fmtMoney(pay)}</div><div class="stat-label">应付未付</div></div>
    <div class="stat-card"><div class="stat-num">${fmtMoney(paid)}</div><div class="stat-label">已付</div></div>
    ${(orderRecv || orderCollected) ? `<div class="fin-auto-note">已自动汇总订单：应收未收 ${fmtMoney(orderRecv)} ／ 已收 ${fmtMoney(orderCollected)}（财务模块未单独录入时以订单为准）</div>` : ''}`;
  // 客户维度应收
  const byClient = {};
  for (const f of finances) {
    if (f.type === '应收' && f.status !== '已收') {
      const c = finCny(f.amount, f.currency);
      if (c == null) continue;
      byClient[f.clientName || '未指定'] = (byClient[f.clientName || '未指定'] || 0) + c;
    }
  }
  // 订单应收并入客户维度
  for (const o of orders) {
    if (AR_STATUS.includes(o.status)) {
      const c = finCny(o.amount, o.currency);
      if (c == null) continue;
      byClient[o.clientName || '未指定'] = (byClient[o.clientName || '未指定'] || 0) + c;
    }
  }
  const bc = document.querySelector('#finByClient');
  if (bc) {
    const keys = Object.keys(byClient);
    bc.innerHTML = keys.length ? keys.map((k) => `<div class="bar-row"><span class="lbl">${esc(k)}</span><span class="bar"><i style="width:100%;background:var(--c-blue)"></i></span><span class="v">${fmtMoney(byClient[k])}</span></div>`).join('') : '<div class="empty">暂无应收未收</div>';
  }
  if (!finances.length) { body.innerHTML = '<tr><td colspan="8" class="empty">暂无财务记录，点击右上角新增</td></tr>'; return; }
  body.innerHTML = finances.slice().sort(newestRecords).map((f) => `<tr>
    <td>${esc(f.type || '-')}</td>
    <td>${esc(f.clientName || '-')}</td>
    <td>${esc(f.orderNo || '-')}</td>
    <td>${(Number(f.amount) || 0).toLocaleString()} ${esc(f.currency || '')}</td>
    <td>${finCny(f.amount, f.currency) != null ? fmtMoney(finCny(f.amount, f.currency)) : '—'}</td>
    <td><span class="stage st-${f.status || ''}">${esc(f.status || '-')}</span></td>
    <td>${esc(f.dueDate || f.paidDate || '-')}</td>
    <td>
      <button class="link-btn" data-fin="${f.id}">编辑</button>
      <button class="link-btn danger" data-findel="${f.id}">删除</button>
    </td>
  </tr>`).join('');
  body.querySelectorAll('[data-fin]').forEach((b) => b.onclick = () => openFinanceModal(b.dataset.fin));
  body.querySelectorAll('[data-findel]').forEach((b) => b.onclick = async () => {
    if (confirm('确认删除该财务记录？')) { await api('/api/finance/' + b.dataset.findel, { method: 'DELETE' }); toast('已删除'); loadFinance(); }
  });
}
function openFinanceModal(id) {
  const f = id ? finances.find((x) => x.id === id) : {};
  const clientOpts = ['', ...clients.map((c) => c.company)];
  openModal(id ? '编辑财务记录' : '新增财务记录', `
    ${selectField('类型', 'type', f.type || '应收', FIN_TYPES)}
    ${selectField('客户', 'clientName', f.clientName || '', clientOpts)}
    ${field('关联订单号', 'orderNo', f.orderNo)}
    ${field('金额', 'amount', f.amount, 'number', 'step="0.01"')}
    ${selectField('币种', 'currency', f.currency || 'USD', CURRENCIES)}
    ${selectField('状态', 'status', f.status || '未收', ['未收', '已收', '未付', '已付'])}
    ${field('应收日期/到期日', 'dueDate', f.dueDate, 'date')}
    ${field('实收/实付日期', 'paidDate', f.paidDate, 'date')}
    <div class="field full"><label>备注</label><textarea name="remark">${esc(f.remark)}</textarea></div>
  `);
  document.querySelector('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const url = id ? '/api/finance/' + id : '/api/finance';
    const m = id ? 'PUT' : 'POST';
    await api(url, { method: m, body: JSON.stringify(fd) });
    toast('已保存'); closeModal(); loadFinance();
  };
}

let opsBound = false;
function bindOps() {
  if (opsBound) return; opsBound = true;
  const q = (id) => document.querySelector('#' + id);
  if (q('shipAdd')) q('shipAdd').onclick = () => openShipmentModal();
  if (q('suppAdd')) q('suppAdd').onclick = () => openSupplierModal();
  if (q('finAdd')) q('finAdd').onclick = () => openFinanceModal();
}

// 注意：直接用 window.loadXxx = function(){ ... loadXxx() } 会覆盖同名全局函数导致无限递归，
// 必须先保存原始引用再包装（此前出货/供应商/财务三个模块因此一直加载失败）。
const _loadShipments = loadShipments;
const _loadSuppliers = loadSuppliers;
const _loadFinance = loadFinance;
window.loadShipments = function () { bindOps(); return _loadShipments(); };
window.loadSuppliers = function () { bindOps(); return _loadSuppliers(); };
window.loadFinance = function () { bindOps(); return _loadFinance(); };
// 订单加载完成后刷新财务汇总（订单应收/已收自动并入）
window.addEventListener('ftw:dataReady', () => { try { renderFinance(); } catch (e) { console.error('finance', e); } });
window.addEventListener('ftw:ratesReady', () => { try { renderFinance(); } catch (e) { console.error('finance', e); } });
// 财务视图激活时重新渲染（保证打开财务页时订单汇总一定正确）
window.onViewActivated = (function (orig) {
  return function (view) {
    if (orig) { try { orig(view); } catch (e) { console.error('onViewActivated', e); } }
    if (view === 'finance') { try { renderFinance(); } catch (e) { console.error('finance', e); } }
  };
})(window.onViewActivated);
