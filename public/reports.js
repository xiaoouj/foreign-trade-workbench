// ================= 自定义报表 / Excel 导出 =================
// 选实体 + 选字段 + 关键字筛选，前端取数（复用现有列表接口，RBAC 自动生效），导出 .xlsx。

const REPORT_SCHEMAS = {
  clients: { label: '客户', fields: [
    { k: 'company', label: '公司名' }, { k: 'country', label: '国家' }, { k: 'contactName', label: '联系人' },
    { k: 'contactEmail', label: '邮箱' }, { k: 'contactPhone', label: '电话' }, { k: 'stage', label: '等级' },
    { k: 'source', label: '来源' }, { k: 'annualValue', label: '累计采购额' }, { k: 'nextFollowUp', label: '下次跟进' },
    { k: 'ownerName', label: '跟进人' }, { k: 'notes', label: '备注' },
  ] },
  orders: { label: '订单/商机', fields: [
    { k: 'orderNo', label: '订单号' }, { k: 'clientName', label: '客户' }, { k: 'country', label: '国家' },
    { k: 'amount', label: '金额' }, { k: 'currency', label: '币种' }, { k: 'status', label: '状态' },
    { k: 'stage', label: '商机阶段' }, { k: 'probability', label: '成交概率%' }, { k: 'orderDate', label: '下单日期' },
    { k: 'deliveryDate', label: '交期' }, { k: 'paymentTerms', label: '付款方式' }, { k: 'ownerName', label: '责任人' }, { k: 'notes', label: '备注' },
  ] },
  inquiries: { label: '询盘', fields: [
    { k: 'clientName', label: '客户' }, { k: 'country', label: '国家' }, { k: 'product', label: '产品' },
    { k: 'source', label: '来源' }, { k: 'status', label: '状态' }, { k: 'expectedAmount', label: '预计金额' },
    { k: 'currency', label: '币种' }, { k: 'contactName', label: '联系人' }, { k: 'receivedAt', label: '收到日期' },
    { k: 'nextFollowAt', label: '下次跟进' }, { k: 'ownerName', label: '跟进人' },
  ] },
  contacts: { label: '联系人', fields: [
    { k: 'clientCompany', label: '客户' }, { k: 'name', label: '姓名' }, { k: 'role', label: '角色' },
    { k: 'title', label: '职位' }, { k: 'phone', label: '电话' }, { k: 'email', label: '邮箱' },
    { k: 'isPrimary', label: '主联系人' }, { k: 'notes', label: '备注' }, { k: 'ownerName', label: '责任人' },
  ] },
};

let _repInited = false;
let _repEntity = 'clients';
let _repRows = [];
let _repClientsMap = {};

function repEntApi(e) { return '/api/' + e; }

function repFieldsHtml() {
  const schema = REPORT_SCHEMAS[_repEntity];
  return schema.fields.map((f) => `<label class="rep-chk"><input type="checkbox" data-k="${f.k}" checked/> ${f.label}</label>`).join('');
}

async function repLoad() {
  const host = $('#repTableHost'); if (!host) return;
  const cnt = $('#repCount'); if (cnt) cnt.textContent = '加载中…';
  try {
    const rows = await api(repEntApi(_repEntity)).then((r) => r.json());
    _repRows = Array.isArray(rows) ? rows : [];
    // 联系人需映射客户公司名
    if (_repEntity === 'contacts') {
      try { const cs = await api('/api/clients').then((r) => r.json()); _repClientsMap = {}; (cs || []).forEach((c) => { _repClientsMap[c.id] = c.company; }); } catch {}
    }
    const q = ($('#repFilter').value || '').trim().toLowerCase();
    if (q) {
      _repRows = _repRows.filter((r) => {
        const hay = [r.company, r.clientName, r.orderNo, r.country, r.name, r.product].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    if (cnt) cnt.textContent = '共 ' + _repRows.length + ' 条';
    repRenderTable();
  } catch (e) {
    if (cnt) cnt.textContent = '加载失败：' + e.message;
    host.innerHTML = '<div class="empty">加载失败</div>';
  }
}

function repSelectedFields() {
  const set = new Set([...document.querySelectorAll('#repFields input:checked')].map((i) => i.dataset.k));
  return REPORT_SCHEMAS[_repEntity].fields.filter((f) => set.has(f.k));
}

function repRenderTable() {
  const host = $('#repTableHost'); if (!host) return;
  const fields = repSelectedFields();
  if (!_repRows.length) { host.innerHTML = '<div class="empty">没有数据（可调整筛选条件后重新查询）</div>'; return; }
  const head = '<tr>' + fields.map((f) => `<th>${f.label}</th>`).join('') + '</tr>';
  const body = _repRows.map((r) => '<tr>' + fields.map((f) => {
    let v = (f.k === 'clientCompany') ? (_repClientsMap[r.clientId] || '') : r[f.k];
    if (f.k === 'isPrimary') v = r.isPrimary ? '是' : '';
    return `<td>${esc(String(v == null ? '' : v))}</td>`;
  }).join('') + '</tr>').join('');
  host.innerHTML = `<div class="table-scroll"><table class="rep-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

async function repExport() {
  const fields = repSelectedFields();
  if (!fields.length) return toast('请至少勾选一个字段');
  if (!_repRows.length) return toast('没有可导出的数据');
  try {
    if (window.loadSheetJS) await window.loadSheetJS();
    if (typeof XLSX === 'undefined') return toast('Excel 组件未加载（需外网）');
    const data = _repRows.map((r) => {
      const o = {};
      for (const f of fields) {
        let v = (f.k === 'clientCompany') ? (_repClientsMap[r.clientId] || '') : r[f.k];
        if (f.k === 'isPrimary') v = r.isPrimary ? '是' : '';
        o[f.label] = v == null ? '' : v;
      }
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, REPORT_SCHEMAS[_repEntity].label.slice(0, 28));
    const fn = '报表_' + _repEntity + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(wb, fn);
    toast('已导出 ' + _repRows.length + ' 条');
  } catch (e) {
    toast('导出失败：' + e.message);
  }
}

function initReports() {
  if (_repInited) { repLoad(); return; }
  _repInited = true;
  const ent = $('#repEntity'); if (ent) {
    ent.value = _repEntity;
    ent.addEventListener('change', () => { _repEntity = ent.value; $('#repFields').innerHTML = repFieldsHtml(); repLoad(); });
  }
  const fl = $('#repFields'); if (fl) fl.innerHTML = repFieldsHtml();
  $('#repLoad')?.addEventListener('click', repLoad);
  $('#repExport')?.addEventListener('click', repExport);
  $('#repFields')?.addEventListener('change', repRenderTable);
  repLoad();
}

// 视图激活钩子（包裹既有 onViewActivated，避免覆盖 tasks 的钩子）
window.onViewActivated = (function (orig) {
  return function (view) {
    if (typeof orig === 'function') orig(view);
    if (view === 'reports') initReports();
  };
})(window.onViewActivated);
