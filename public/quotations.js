// ====== 项目型报价管理模块 ======
// 支持：分项报价（设备/安装/运输/备件/其他）、版本管理、状态流转、关联询盘/订单、转订单、生成报价单

const QT_STATUSES = ['草稿', '已发送', '客户确认', '客户拒绝', '已过期', '已转订单'];
const QT_LINE_TYPES = [
  { code: 'equipment', name: '设备费' },
  { code: 'installation', name: '安装调试费' },
  { code: 'shipping', name: '运输费' },
  { code: 'spare', name: '备品备件' },
  { code: 'tax', name: '税费' },
  { code: 'other', name: '其他' },
];

let quotations = [];
let qtSearchQ = '';
let qtFilterStatus = '';

const getAllQuotations = () => quotations;
window.getAllQuotations = getAllQuotations;

async function loadQuotations() {
  try {
    const r = await api('/api/quotations');
    if (r.ok) quotations = await r.json();
  } catch (e) { console.error('loadQuotations', e); quotations = []; }
  renderQuotations();
  window.dispatchEvent(new Event('ftw:quotationsChanged'));
}
window.loadQuotations = loadQuotations;

function qtTotal(lines) {
  return (lines || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
}

function qtStatusBadge(st) {
  const map = {
    '草稿': 'draft',
    '已发送': 'sent',
    '客户确认': 'confirmed',
    '客户拒绝': 'rejected',
    '已过期': 'expired',
    '已转订单': 'ordered',
  };
  return `<span class="status-tag status-${map[st] || 'draft'}">${esc(st || '草稿')}</span>`;
}

let qtPage = 1;
const QT_PAGE_SIZE = 10;

let qtSelectedId = null;
function renderQuotations() {
  const body=$('#qtBody');if(!body)return;
  const now=todayStr(), month=now.slice(0,7),soon=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  $('#qkMonth').textContent=quotations.filter(q=>q.createdAt&&new Date(q.createdAt).toISOString().slice(0,7)===month).length;
  $('#qkPending').textContent=quotations.filter(q=>q.status==='已发送').length;
  $('#qkOrdered').textContent=quotations.filter(q=>['客户确认','已转订单'].includes(q.status)).length;
  $('#qkAmount').textContent=quotations.filter(q=>['草稿','已发送'].includes(q.status||'草稿')&&q.validUntil>=now&&q.validUntil<=soon).length;
  const currency=$('#qtCurrencyFilter'),oldCurrency=currency.value;
  currency.innerHTML='<option value="">全部币种</option>'+[...new Set(quotations.map(q=>q.currency||'USD'))].sort().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');currency.value=oldCurrency;
  let list=quotations.slice().sort(byDocNo('quoteNo')).filter(q=>!qtFilterStatus||q.status===qtFilterStatus);
  if(qtSearchQ)list=list.filter(q=>[q.quoteNo,q.clientName,q.projectName,q.contactName].some(v=>String(v||'').toLowerCase().includes(qtSearchQ)));
  if(currency.value)list=list.filter(q=>(q.currency||'USD')===currency.value);
  const from=$('#qtDateFrom').value,to=$('#qtDateTo').value;
  if(from||to)list=list.filter(q=>{const day=q.createdAt?new Date(q.createdAt).toISOString().slice(0,10):'';return day&&(!from||day>=from)&&(!to||day<=to);});
  $('#qtStatusTabs').innerHTML=['',...QT_STATUSES].map(status=>`<button data-qt-status="${esc(status)}" class="${qtFilterStatus===status?'active':''}" aria-pressed="${qtFilterStatus===status}">${esc(status||'全部报价')} <small>${quotations.filter(q=>!status||q.status===status).length}</small></button>`).join('');
  $('#qtStatusTabs').querySelectorAll('button').forEach(button=>button.onclick=()=>{qtFilterStatus=button.dataset.qtStatus;$('#qtStatusFilter').value=qtFilterStatus;qtPage=1;renderQuotations();});
  $('#qtMeta').textContent='共 '+list.length+' 份报价';
  const totalPages=Math.max(1,Math.ceil(list.length/QT_PAGE_SIZE));qtPage=Math.min(qtPage,totalPages);
  const pageList=list.slice((qtPage-1)*QT_PAGE_SIZE,qtPage*QT_PAGE_SIZE);renderQtPagination(list.length,totalPages);
  if(!pageList.some(q=>q.id===qtSelectedId))qtSelectedId=pageList[0]?.id||null;
  if(!pageList.length){body.innerHTML='<tr><td colspan="10" class="empty">暂无符合条件的报价</td></tr>';$('#qtSelectedDetail').innerHTML='';return;}
  body.innerHTML=pageList.map(q=>`<tr class="${q.id===qtSelectedId?'sales-selected':''}" data-select-quote="${esc(q.id)}"><td data-col="quoteNo"><button class="sales-link" data-qt-select="${esc(q.id)}">${esc(q.quoteNo||'未填写')}</button></td><td data-col="clientName">${esc(q.clientName||'未填写')}</td><td data-col="amount" class="sales-nowrap">${salesMoney(qtTotal(q.items),q.currency)}</td><td data-col="tradeTerms">${esc(q.tradeTerms||'—')}</td><td data-col="validUntil" class="sales-nowrap">${esc(q.validUntil||'—')}</td><td data-col="status">${qtStatusBadge(q.status)}</td><td data-col="revision"><span class="sales-round">${Math.max(0,(Number(q.version)||1)-1)} 轮</span></td><td data-col="owner">${esc(q.ownerName||'—')}</td><td data-col="projectName">${esc(q.projectName||'—')}</td><td data-col="ops" class="sales-nowrap"><button class="sales-link" data-qt-edit="${esc(q.id)}">编辑</button><button class="sales-link" data-qt-doc="${esc(q.id)}">预览</button><button class="sales-link danger" data-qt-del="${esc(q.id)}">删除</button></td></tr>`).join('');
  body.querySelectorAll('[data-select-quote]').forEach(row=>row.onclick=e=>{if(e.target.closest('[data-qt-edit],[data-qt-doc],[data-qt-del]'))return;qtSelectedId=row.dataset.selectQuote;renderQuotations();});
  body.querySelectorAll('[data-qt-edit]').forEach(b=>b.onclick=()=>openQuoteModal(b.dataset.qtEdit));
  body.querySelectorAll('[data-qt-doc]').forEach(b=>b.onclick=()=>openQuoteDoc(b.dataset.qtDoc));
  body.querySelectorAll('[data-qt-del]').forEach(b=>b.onclick=async()=>{if(!confirm('确认删除该报价单？'))return;const r=await api('/api/quotations/'+b.dataset.qtDel,{method:'DELETE'});if(!r.ok)return toast('删除失败');toast('已删除');loadQuotations();});
  renderQuoteSelected();
}
function quoteItemsTable(q){return `<div class="sales-item-scroll"><table><thead><tr><th>产品 / 规格</th><th>数量</th><th>单价</th><th>金额（${esc(q.currency||'USD')}）</th></tr></thead><tbody>${(q.items||[]).map(it=>`<tr><td><b>${esc(it.name||'—')}</b><small>${esc(it.description||'')}</small></td><td>${esc(it.qty??'')} ${esc(it.unit||'')}</td><td>${Number(it.unitPrice||0).toLocaleString()}</td><td>${(Number(it.qty||0)*Number(it.unitPrice||0)).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="4">未登记产品明细</td></tr>'}</tbody></table></div>`;}
function renderQuoteSelected(){
  const q=quotations.find(q=>q.id===qtSelectedId),host=$('#qtSelectedDetail');if(!q){host.innerHTML='';return;}
  const history=Array.isArray(q.revisionHistory)?q.revisionHistory:[],client=clients.find(c=>c.id===q.clientId||c.company===q.clientName);
  host.innerHTML=`<div class="sales-quote-detail"><section class="sales-card sales-quote-overview"><h3>${esc(q.quoteNo||'未填写')} ${qtStatusBadge(q.status)}</h3><dl class="sales-info"><dt>客户</dt><dd>${esc(q.clientName||'—')}</dd><dt>邮箱</dt><dd>${esc(client?.contactEmail||'未填写')}</dd><dt>贸易条款</dt><dd>${esc(q.tradeTerms||'未填写')}</dd><dt>付款条款</dt><dd>${esc(q.paymentTerms||'未填写')}</dd><dt>定金比例</dt><dd>${q.depositPercent==null?'未设置':q.depositPercent+'%'}</dd><dt>交货期</dt><dd>${q.deliveryDays?esc(q.deliveryDays)+' 天':'未填写'}</dd></dl><p class="sales-quote-note">${esc(q.notes||'暂无备注')}</p></section><section class="sales-card sales-quote-products"><h3>产品明细 <span class="muted">${(q.items||[]).length} 项</span></h3>${quoteItemsTable(q)}<div class="sales-total">合计 <strong>${salesMoney(qtTotal(q.items),q.currency)}</strong></div></section><section class="sales-card sales-quote-history"><h3>修改节点 <span class="sales-round">${Math.max(0,(Number(q.version)||1)-1)} 轮 · V${Number(q.version)||1}</span></h3><p class="muted">内容实际变更时记录；状态切换不增加轮次。</p><ol>${history.slice().reverse().map((node,i)=>`<li><span class="sales-history-dot"></span><div><b>${node.kind==='created'?'初始报价':node.kind==='baseline'?'历史版本起点':'第 '+(node.version-1)+' 轮修改'} · V${esc(node.version)}</b><small>${esc(new Date(node.at).toLocaleString('zh-CN',{hour12:false}))} · ${esc(node.userName||'—')}</small><p>${esc((node.changes||[]).join('、'))}</p><button class="sales-link" data-qt-revision="${history.length-1-i}">查看此版内容</button></div></li>`).join('')||`<li><div><b>历史报价 V${Number(q.version)||1}</b><p>原版本号已保留；详细修改节点从本次升级后开始记录。</p></div></li>`}</ol></section></div><div class="sales-detail-actions"><button class="btn-ghost" id="qtDetailEdit">编辑报价</button><button class="btn-ghost" id="qtDetailDoc">预览 / 导出 PDF</button><button class="btn-ghost" id="qtDetailCopy">复制报价</button><button class="btn-primary" id="qtDetailOrder" ${q.status!=='客户确认'?'disabled':''} title="客户确认后可转订单">转为订单</button></div>`;
  $('#qtDetailEdit').onclick=()=>openQuoteModal(q.id);$('#qtDetailDoc').onclick=()=>openQuoteDoc(q.id);
  $('#qtDetailCopy').onclick=()=>openQuoteModal(null,{...q,id:undefined,quoteNo:suggestQuoteNo(),status:'草稿',orderId:null});
  $('#qtDetailOrder').onclick=()=>convertQuoteToOrder(q.id);
  host.querySelectorAll('[data-qt-revision]').forEach(button=>button.onclick=()=>{const node=history[Number(button.dataset.qtRevision)],snapshot=node.snapshot||{};openModal('报价历史版本 V'+node.version,`<div class="sales-history-preview"><p>${esc(snapshot.clientName||'—')} · ${esc(snapshot.quoteNo||'—')}</p>${quoteItemsTable(snapshot)}<p>币种：${esc(snapshot.currency||'—')} · 有效期：${esc(snapshot.validUntil||'未填')}</p><p>付款：${esc(snapshot.paymentTerms||'未填')} · 定金：${snapshot.depositPercent==null?'未设置':snapshot.depositPercent+'%'}</p><p>贸易条款：${esc(snapshot.tradeTerms||'未填')} · 交货期：${esc(snapshot.deliveryDays||'未填')} 天</p><p>${esc(snapshot.notes||'')}</p></div>`,{plain:true,wide:true,noFooter:true});});
}

function renderQtPagination(total, totalPages) {
  const footMeta = $('#qtFootMeta');
  if (footMeta) footMeta.textContent = total ? `显示 ${Math.min((qtPage - 1) * QT_PAGE_SIZE + 1, total)} - ${Math.min(qtPage * QT_PAGE_SIZE, total)} / ${total} 条` : '0 条';
  const pager = $('#qtPagination');
  if (!pager) return;
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  const pages = [];
  pages.push(`<button class="page-btn" data-qt-page="prev" ${qtPage === 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>`);
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= qtPage - 1 && i <= qtPage + 1)) {
      pages.push(`<button class="page-btn ${i === qtPage ? 'active' : ''}" data-qt-page="${i}">${i}</button>`);
    } else if (i === qtPage - 2 || i === qtPage + 2) {
      pages.push(`<span class="page-btn" style="cursor:default;border:none;background:transparent">…</span>`);
    }
  }
  pages.push(`<button class="page-btn" data-qt-page="next" ${qtPage === totalPages ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>`);
  pager.innerHTML = pages.join('');
  pager.querySelectorAll('[data-qt-page]').forEach((b) => b.onclick = () => {
    const p = b.dataset.qtPage;
    if (p === 'prev') qtPage = Math.max(1, qtPage - 1);
    else if (p === 'next') qtPage = Math.min(totalPages, qtPage + 1);
    else qtPage = Number(p);
    renderQuotations();
  });
}

function defaultQuoteLine(type) {
  const t = type || 'equipment';
  return { type: t, name: QT_LINE_TYPES.find((x) => x.code === t)?.name || '', description: '', qty: 1, unit: 'SET', unitPrice: 0 };
}

function openQuoteModal(id, prefill) {
  const q = (id && quotations.find((x) => x.id === id)) || prefill || {};
  const editId = id || (prefill && prefill.id) || '';
  const companyKey = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const knownClient = clients.find(c => c.id === q.clientId && companyKey(c.company) === companyKey(q.clientName)) || clients.find(c => companyKey(c.company) === companyKey(q.clientName));
  const clientOpts = ['<option value="">— 选择客户 —</option>', ...(q.clientName && !knownClient ? [`<option value="${esc(q.clientName)}" selected>${esc(q.clientName)}（未建档）</option>`] : []), ...clients.map((c) => `<option value="${esc(c.company)}" ${c.id === knownClient?.id ? 'selected' : ''}>${esc(c.company)}</option>`)].join('');
  const curOpts = CURRENCIES.map((c) => `<option ${c === (q.currency || 'USD') ? 'selected' : ''}>${c}</option>`).join('');
  const statusOpts = QT_STATUSES.map((s) => `<option ${s === (q.status || '草稿') ? 'selected' : ''}>${s}</option>`).join('');
  const users = window.assignableUsers();
  const ownerDef = q.owner || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
  const ownerSel = ['<option value="">— 默认本人 —</option>',
    ...users.map((u) => `<option value="${u.id}" ${u.id === ownerDef ? 'selected' : ''}>${esc(u.name || u.username)}</option>`)].join('');

  const lines = (q.items && q.items.length) ? q.items : [defaultQuoteLine('equipment')];
  const linesHtml = lines.map((it, idx) => renderQuoteLineRow(it, idx)).join('');

  openModal(editId ? '编辑报价单' : '新增报价单', `
    <div class="form-grid">
      ${field('报价单号 *', 'quoteNo', q.quoteNo || suggestQuoteNo(), 'text', 'required')}
      <div class="field"><label>客户公司 *</label><select name="clientName" required>${clientOpts}</select><div class="qt-client-create"><button type="button" class="btn-ghost btn-mini" id="qtCreateClient" hidden>＋ 一键建档客户</button><span id="qtClientArchiveStatus" class="muted" role="status"></span></div></div>
      ${field('项目名称', 'projectName', q.projectName || '')}
      ${field('联系人', 'contactName', q.contactName || '')}
      ${field('买方国家', 'country', q.country || '')}
      ${field('买方邮箱', 'contactEmail', q.contactEmail || '')}
      ${field('买方电话', 'contactPhone', q.contactPhone || '')}
      ${field('买方网站', 'website', q.website || '')}
      <div class="field"><label>币种</label><select name="currency">${curOpts}</select></div>
      <div class="field"><label>状态</label><select name="status">${statusOpts}</select></div>
      ${field('有效期至', 'validUntil', q.validUntil || '', 'date')}
      ${field('交货期(天)', 'deliveryDays', q.deliveryDays || '', 'number')}
      ${field('贸易条款', 'tradeTerms', q.tradeTerms || '', 'text', 'placeholder="如 FOB Shenzhen"')}
      ${salesPercentControl('depositPercent','约定定金比例',q.depositPercent)}
      <div class="field full"><label>付款方式</label><input name="paymentTerms" value="${esc(q.paymentTerms || '')}" placeholder="如：30% deposit, 70% before shipment" /></div>
      <div class="field"><label>责任人</label><select name="owner">${ownerSel}</select></div>
      <div class="field full"><label>备注 / 条款</label><textarea name="notes" rows="3">${esc(q.notes || '')}</textarea></div>
    </div>
    <div class="qt-lines-head">
      <b>报价明细</b>
      <button type="button" class="btn-mini" id="qtAddLine">+ 添加分项</button>
    </div>
    <div id="qtLines" class="qt-lines">${linesHtml}</div>
    <div class="qt-total">合计：<span id="qtTotalDisplay">--</span></div>
    <input type="hidden" name="inquiryId" value="${esc(q.inquiryId || '')}" />
    <input type="hidden" name="orderId" value="${esc(q.orderId || '')}" />
  `, { wide: true });

  bindSalesPercentControls($('#modalForm'));
  bindQuoteLineEvents();
  updateQuoteTotal();

  const form = $('#modalForm');
  const clientSel = form.querySelector('select[name="clientName"]');
  const normCompany = companyKey;
  let archivedClient = null, creatingClient = false;
  const archiveButton = form.querySelector('#qtCreateClient');
  const archiveStatus = form.querySelector('#qtClientArchiveStatus');
  const linkedForName = name => (archivedClient && normCompany(archivedClient.company) === normCompany(name) ? archivedClient : clients.find(c => normCompany(c.company) === normCompany(name)));
  const syncArchiveAction = () => {
    const name = clientSel.value, linked = linkedForName(name);
    archiveButton.hidden = !name || !!linked;
    archiveButton.disabled = creatingClient;
    archiveStatus.textContent = linked ? '已关联客户档案' : name ? '客户尚未建档，可直接带入已有资料' : '';
  };
  archiveButton.onclick = async () => {
    if (creatingClient || !clientSel.value) return;
    const uid = currentUser?.id, name = clientSel.value;
    const ownQuoteName = normCompany(name) === normCompany(q.clientName);
    const data = {
      company: name, contactName: form.querySelector('[name="contactName"]').value,
      owner: form.querySelector('[name="owner"]').value || uid,
      ...(editId ? { quoteId: editId } : {}),
    };
    if (ownQuoteName) for (const key of ['country', 'contactEmail', 'contactPhone', 'website']) if (form.elements[key]?.value) data[key] = form.elements[key].value;
    creatingClient = true; archiveButton.disabled = true; archiveButton.textContent = '正在建档…';
    const save = document.querySelector('#modalFoot [type="submit"]'); if (save) save.disabled = true;
    try {
      const r = await api('/api/clients/from-quotation', { method: 'POST', body: JSON.stringify(data) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error || '建档失败，请重试');
      if (uid !== currentUser?.id) return;
      const client = result.client;
      const index = clients.findIndex(c => c.id === client.id);
      if (index < 0) clients.push(client); else clients[index] = client;
      // 更新当前选择和客户缓存，不重建报价表单，保留分项、价格和所有未保存输入。
      if (!form.contains(clientSel) || !archiveButton.isConnected) return;
      archivedClient = client;
      if (clientSel.value === name) {
        let option = [...clientSel.options].find(o => o.value === name);
        if (!option) { option = document.createElement('option'); clientSel.append(option); }
        option.value = client.company; option.textContent = client.company; clientSel.value = client.company;
        clientSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncArchiveAction();
      if (normCompany(clientSel.value) === normCompany(client.company)) archiveStatus.textContent = result.created ? '客户已建档；保存报价单后完成关联' : '已找到现有客户；保存报价单后完成关联';
      toast(result.created ? '客户建档成功' : '已关联现有客户，未重复建档');
    } catch (error) { if (archiveButton.isConnected && uid === currentUser?.id) { archiveStatus.textContent = error.message || '建档失败，请重试'; toast(archiveStatus.textContent); } }
    finally { creatingClient = false; archiveButton.disabled = false; archiveButton.textContent = '＋ 一键建档客户'; if (save?.isConnected) save.disabled = false; }
  };
  syncArchiveAction();
  if (clientSel) {
    clientSel.addEventListener('change', () => {
      const name = clientSel.value;
      const linked = linkedForName(name);
      syncArchiveAction();
      if (linked) {
        const cn = form.querySelector('input[name="contactName"]');
        if (cn && !cn.value && linked.contactName) cn.value = linked.contactName;
        const ow = form.querySelector('select[name="owner"]');
        if (ow && linked.owner && !q.owner) ow.value = linked.owner;
      }
    });
  }

  let quoteSaving=false;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if(quoteSaving)return;
    if (creatingClient) return toast('正在建档，请稍候再保存报价单');
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const ownerId = fd.owner || (currentUser ? currentUser.id : '');
    const ownerName = (allUsers.find((u) => u.id === ownerId) || {}).name || (currentUser ? currentUser.name : '');
    const linkedClient = linkedForName(fd.clientName);
    const items = collectQuoteLines();
    const total = qtTotal(items);
    const body = {
      ...fd,
      ...salesPercentValues(form,['depositPercent']),
      ...(editId?{baseVersion:q.version||1}:{}),
      clientId: linkedClient ? linkedClient.id : (fd.clientName === q.clientName ? (q.clientId || null) : null),
      owner: ownerId,
      ownerName,
      items,
      totalAmount: total,
    };
    const url = editId ? '/api/quotations/' + editId : '/api/quotations';
    const m = editId ? 'PUT' : 'POST';
    quoteSaving=true;
    try {
    const r = await api(url, { method: m, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || r.status)); return; }
    const saved=await r.json();qtSelectedId=saved.id;toast('已保存'); closeModal(); loadQuotations();
    } catch(error){toast('保存失败：'+error.message);} finally {quoteSaving=false;}
  };
}
window.openQuoteModal = openQuoteModal;

function renderQuoteLineRow(it, idx) {
  const typeOpts = QT_LINE_TYPES.map((t) => `<option value="${t.code}" ${t.code === it.type ? 'selected' : ''}>${t.name}</option>`).join('');
  return `<div class="qt-line" data-idx="${idx}">
    <div class="qt-line-grid">
      <div class="field"><label>类型</label><select class="qt-type" data-idx="${idx}">${typeOpts}</select></div>
      <div class="field"><label>名称</label><input class="qt-name" data-idx="${idx}" value="${esc(it.name || '')}" placeholder="项目名称" /></div>
      <div class="field"><label>数量</label><input class="qt-qty" data-idx="${idx}" type="number" value="${esc(it.qty ?? '')}" min="0" step="any" required /></div>
      <div class="field"><label>单位</label><input class="qt-unit" data-idx="${idx}" value="${esc(it.unit ?? 'SET')}" /></div>
      <div class="field"><label>单价</label><input class="qt-price" data-idx="${idx}" type="number" value="${esc(it.unitPrice ?? '')}" step="any" min="0" required /></div>
      <div class="field"><label>小计</label><div class="qt-subtotal" data-idx="${idx}">${((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)).toLocaleString()}</div></div>
    </div>
    <div class="field full"><label>描述 / 规格</label><textarea class="qt-desc" data-idx="${idx}" rows="2" placeholder="如：PP Mesh Belt Conveyor, L5000, 含电控柜">${esc(it.description || '')}</textarea></div>
    <button type="button" class="link-btn danger qt-del-line" data-idx="${idx}">删除分项</button>
  </div>`;
}

function bindQuoteLineEvents() {
  const wrap = $('#qtLines');
  if (!wrap) return;
  wrap.querySelectorAll('.qt-type').forEach((el) => el.onchange = () => {
    const idx = +el.dataset.idx;
    const line = getQuoteLine(idx);
    const t = QT_LINE_TYPES.find((x) => x.code === el.value);
    if (t && !line.name) line.name = t.name;
    updateQuoteLine(idx);
  });
  wrap.querySelectorAll('.qt-name, .qt-qty, .qt-unit, .qt-price, .qt-desc').forEach((el) => {
    el.oninput = () => updateQuoteLine(+el.dataset.idx);
  });
  wrap.querySelectorAll('.qt-del-line').forEach((b) => b.onclick = () => {
    const row = b.closest('.qt-line');
    row.remove();
    reindexQuoteLines();
    updateQuoteTotal();
  });
  $('#qtAddLine').onclick = () => {
    const wrap = $('#qtLines');
    const idx = wrap.querySelectorAll('.qt-line').length;
    const div = document.createElement('div');
    div.innerHTML = renderQuoteLineRow(defaultQuoteLine('equipment'), idx);
    wrap.appendChild(div.firstElementChild);
    bindQuoteLineEvents();
    updateQuoteTotal();
  };
}

function getQuoteLine(idx) {
  const row = $('#qtLines').querySelector(`.qt-line[data-idx="${idx}"]`);
  if (!row) return defaultQuoteLine();
  return {
    type: row.querySelector('.qt-type').value,
    name: row.querySelector('.qt-name').value,
    qty: Number(row.querySelector('.qt-qty').value) || 0,
    unit: row.querySelector('.qt-unit').value,
    unitPrice: Number(row.querySelector('.qt-price').value) || 0,
    description: row.querySelector('.qt-desc').value,
  };
}

function updateQuoteLine(idx) {
  const line = getQuoteLine(idx);
  const row = $('#qtLines').querySelector(`.qt-line[data-idx="${idx}"]`);
  if (row) row.querySelector('.qt-subtotal').textContent = (line.qty * line.unitPrice).toLocaleString();
  updateQuoteTotal();
}

function reindexQuoteLines() {
  $('#qtLines').querySelectorAll('.qt-line').forEach((row, i) => {
    row.dataset.idx = i;
    row.querySelectorAll('[data-idx]').forEach((el) => el.dataset.idx = i);
  });
  bindQuoteLineEvents();
}

function collectQuoteLines() {
  const rows = $('#qtLines').querySelectorAll('.qt-line');
  return Array.from(rows).map((_, i) => getQuoteLine(i));
}

function updateQuoteTotal() {
  const total = qtTotal(collectQuoteLines());
  const cur = ($('#modalForm')?.querySelector('select[name="currency"]')?.value) || 'USD';
  const el = $('#qtTotalDisplay');
  if (el) el.textContent = total.toLocaleString() + ' ' + cur;
  const check=$('#qtAiAmountCheck');
  if(check){
    const expected=Number(check.dataset.sourceAmount),sourceCur=check.dataset.sourceCurrency;
    const incomplete=[...$('#qtLines').querySelectorAll('.qt-qty,.qt-price')].some(input=>input.value.trim()===''||!input.validity.valid);
    const sameCurrency=cur===sourceCur,diff=Math.round((total-expected)*100)/100;
    const ok=!incomplete&&sameCurrency&&Math.abs(diff)<0.01;
    check.style.color=ok?'var(--success)':'var(--danger)';
    check.textContent='原文件总额：'+expected.toLocaleString()+' '+sourceCur+'；表单合计：'+total.toLocaleString()+' '+cur+'。'+(incomplete?'明细数量或单价缺失，请补齐核对。':!sameCurrency?'币种不一致，请核对。':ok?'金额核对一致。':'相差 '+Math.abs(diff).toLocaleString()+' '+cur+'，请检查是否遗漏或重复识别分项。');
  }
}

function suggestQuoteNo() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `QT${ymd}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}
window.suggestQuoteNo = suggestQuoteNo;

// 从询盘生成报价
function createQuoteFromInquiry(inq) {
  const q = {
    clientName: inq.clientName || '',
    clientId: inq.clientId || null,
    contactName: inq.contactName || '',
    projectName: inq.product || '',
    currency: inq.currency || 'USD',
    inquiryId: inq.id,
    items: [{
      type: 'equipment',
      name: inq.product || '设备费',
      description: inq.model || '',
      qty: 1,
      unit: 'SET',
      unitPrice: Number(inq.expectedAmount) || 0,
    }],
  };
  openQuoteModal(null, q);
}
window.createQuoteFromInquiry = createQuoteFromInquiry;

// 报价确认后转订单
async function convertQuoteToOrder(qid) {
  const q = quotations.find((x) => x.id === qid);
  if (!q) return toast('报价单不存在');
  if (q.status !== '客户确认') return toast('只有「客户确认」的报价单才能转订单');
  const linked = clients.find((c) => c.id === q.clientId || c.company === q.clientName);
  if (!await orderItemsReady()) return;
  const orderNo = String(q.quoteNo || '').trim();
  if (!orderNo) return toast('请先填写报价单号，再转订单');
  const body = {
    orderNo,
    clientName: q.clientName || '',
    clientId: linked ? linked.id : (q.clientId || null),
    country: linked ? linked.country : '',
    amount: qtTotal(q.items),
    currency: q.currency || 'USD',
    status: '待确认',
    paymentTerms: q.paymentTerms || '',
    depositPercent:q.depositPercent??null,
    deliveryDate: q.deliveryDays ? futureDate(q.deliveryDays) : '',
    notes: `由报价单 ${q.quoteNo} (V${q.version || 1}) 转化\n${q.notes || ''}`,
    owner: q.owner || (currentUser ? currentUser.id : ''),
    ownerName: q.ownerName || (currentUser ? currentUser.name : ''),
    quoteId: q.id,
    items: JSON.parse(JSON.stringify(q.items || [])),
  };
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast('转订单失败：' + (j.error || r.status)); return; }
  const order = await r.json();
  const qr = await api('/api/quotations/' + q.id, { method: 'PUT', body: JSON.stringify({ status: '已转订单', orderId: order.id }) });
  if (!qr.ok) { console.error('更新报价单状态失败', qr.status); }
  toast('已生成订单：' + orderNo);
  loadQuotations();
  if (typeof loadAll === 'function') loadAll();
}
window.convertQuoteToOrder = convertQuoteToOrder;

function suggestOrderNo() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `ST${y}${m}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// 生成报价单 PDF：跳转单证生成页并预填
function openQuoteDoc(qid) {
  const q = quotations.find((x) => x.id === qid);
  if (!q) return;
  window._quoteForDoc = q;
  switchView('docs');
  if (typeof window.loadQuoteIntoDoc === 'function') window.loadQuoteIntoDoc(q);
  else setTimeout(() => { if (typeof window.loadQuoteIntoDoc === 'function') window.loadQuoteIntoDoc(q); }, 200);
}
window.openQuoteDoc = openQuoteDoc;

function initQuotationsView() {
  const search = $('#qtSearch');
  if (search) search.addEventListener('input', (e) => { qtPage=1;qtSearchQ = e.target.value.trim().toLowerCase(); renderQuotations(); });
  const filter = $('#qtStatusFilter');
  if (filter) filter.addEventListener('change', (e) => { qtPage=1;qtFilterStatus = e.target.value; renderQuotations(); });
  ['qtCurrencyFilter','qtDateFrom','qtDateTo'].forEach(id=>$('#'+id).addEventListener('change',()=>{qtPage=1;renderQuotations();}));
  $('#qtReset').onclick=()=>{['qtSearch','qtStatusFilter','qtCurrencyFilter','qtDateFrom','qtDateTo'].forEach(id=>$('#'+id).value='');qtSearchQ='';qtFilterStatus='';qtPage=1;renderQuotations();};
  const add = $('#qtAdd');
  if (add) add.onclick = () => openQuoteModal();
  const aiAdd=$('#qtAiAdd');if(aiAdd)aiAdd.onclick=()=>openAiOrderRegister('quote');
  // 视图激活钩子：进入报价管理页时重新渲染
  window.onViewActivated = (function (orig) {
    return function (view) {
      if (view === 'quotations') renderQuotations();
      if (typeof orig === 'function') orig(view);
    };
  })(window.onViewActivated);
}

// 页面加载后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuotationsView);
} else {
  initQuotationsView();
}
