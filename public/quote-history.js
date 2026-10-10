// 全库历史报价属于资料 / 知识库；产品详情只展示与该产品关联的历史。
const quoteHistoryState = { tab: 'history', page: 1, q: '', category: '', clientName: '', country: '', currency: '', kind: '', year: '', request: 0 };
let quoteHistoryTimer;
function historyShell() {
  const host = document.getElementById('kbHistoryPanel');
  if (!host || host.querySelector('#historyTabs')) return host;
  const manager = ['admin', 'manager'].includes(currentUser?.role);
  host.innerHTML = `<div class="sales-card"><div class="sales-card-head"><div><h3>客户历史报价</h3><span class="muted">查询历史价格、原始单据与来源；整理确认后关联产品档案</span></div>${manager ? '<button type="button" class="btn-primary" id="historyImport">导入报价数据</button>' : ''}</div>
    <div class="sales-tabs" id="historyTabs"><button type="button" data-history-tab="history">报价明细</button><button type="button" data-history-tab="documents">来源单据</button>${manager ? '<button type="button" data-history-tab="review">待整理</button><button type="button" data-history-tab="imports">导入记录</button>' : ''}</div>
    <div class="sales-filters catalog-filters" id="historyFilters"><input id="historySearch" placeholder="搜索产品 / 客户 / 单号" aria-label="搜索历史报价"><select id="historyCategory" aria-label="历史产品分类" data-no-combo></select><select id="historyClient" aria-label="历史客户" data-no-combo></select><select id="historyCountry" aria-label="国家" data-no-combo></select><select id="historyCurrency" aria-label="币种" data-no-combo></select><select id="historyKind" aria-label="资料类别" data-no-combo></select><select id="historyYear" aria-label="年份" data-no-combo></select><button type="button" class="btn-ghost" id="historyReset">重置</button></div>
    <div id="historyMessage" role="status"></div><div class="table-wrap catalog-table"><table class="data-table"><thead id="historyHead"></thead><tbody id="historyBody"></tbody></table></div><div class="catalog-footer"><span class="muted" id="historyCount"></span><div class="pagination" id="historyPager"></div></div></div>`;
  host.querySelector('#historyImport')?.addEventListener('click', openQuoteDataImport);
  host.querySelectorAll('[data-history-tab]').forEach(b => b.onclick = () => switchHistoryTab(b.dataset.historyTab));
  host.querySelector('#historySearch').oninput = e => { quoteHistoryState.q = e.target.value; quoteHistoryState.page = 1; clearTimeout(quoteHistoryTimer); quoteHistoryTimer = setTimeout(loadQuoteHistory, 220); };
  for (const [id, field] of [['historyCategory','category'],['historyClient','clientName'],['historyCountry','country'],['historyCurrency','currency'],['historyKind','kind'],['historyYear','year']]) host.querySelector('#' + id).onchange = e => { quoteHistoryState[field] = e.target.value; quoteHistoryState.page = 1; loadQuoteHistory(); };
  host.querySelector('#historyReset').onclick = () => switchHistoryTab(quoteHistoryState.tab);
  return host;
}
function switchHistoryTab(tab) {
  quoteHistoryState.tab = tab; quoteHistoryState.page = 1;
  for (const field of ['q','category','clientName','country','currency','kind','year']) quoteHistoryState[field] = '';
  const host = historyShell(); if (host) host.querySelector('#historySearch').value = '';
  loadQuoteHistory();
}
async function loadQuoteHistory() {
  const host = historyShell(); if (!host || host.hidden || !currentUser) return;
  const version = ++quoteHistoryState.request, uid = currentUser.id, tab = quoteHistoryState.tab;
  host.querySelector('#historyMessage').textContent = '加载中…';
  try {
    const params = new URLSearchParams({ page: quoteHistoryState.page, pageSize: 25 });
    for (const field of ['q','category','clientName','country','currency','kind','year']) if (quoteHistoryState[field]) params.set(field, quoteHistoryState[field]);
    if (tab === 'review') params.set('disposition', 'review');
    const endpoint = tab === 'documents' ? 'documents' : tab === 'imports' ? 'imports' : 'history';
    const data = await catalogApi('/api/products/' + endpoint + '?' + params);
    if (version !== quoteHistoryState.request || uid !== currentUser?.id || !host.isConnected) return;
    host.querySelector('#historyMessage').textContent = '';
    host.querySelectorAll('[data-history-tab]').forEach(b => b.classList.toggle('active', b.dataset.historyTab === tab));
    host.querySelector('#historyFilters').hidden = tab === 'imports';
    host.querySelector('#historyPager').hidden = tab === 'imports';
    const head = host.querySelector('#historyHead'), body = host.querySelector('#historyBody');
    if (tab === 'imports') {
      head.innerHTML = '<tr><th>来源</th><th>导入时间 / 人员</th><th>明细 / 单据</th><th>新增产品</th><th>状态</th></tr>';
      body.innerHTML = data.map(b => `<tr><td><b>${esc(b.filename || '客户报价知识库')}</b>${b.sourceUrl ? `<small><a href="${esc(b.sourceUrl)}" target="_blank" rel="noopener">查看 WorkBuddy 来源</a></small>` : ''}<small>${esc(b.sourceGeneratedDate || '')}</small></td><td>${new Date(b.importedAt).toLocaleString('zh-CN')}<small>${esc(b.importedByName || '管理员')}</small></td><td>${catalogNumber(b.counts?.total)} 条 / ${catalogNumber(b.documents)} 份</td><td>${catalogNumber(b.counts?.created)}</td><td><span class="badge ok">已导入</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无导入记录，点击「导入报价数据」上传</td></tr>';
      host.querySelector('#historyCount').textContent = `共 ${data.length} 次导入`;
      return;
    }
    quoteHistoryState.page = data.page;
    for (const [id, field, label] of [['historyCategory','category','全部分类'],['historyClient','clientName','全部客户'],['historyCountry','country','全部国家'],['historyCurrency','currency','全部币种'],['historyKind','kind','全部资料类别']]) catalogOptions(id, data.facets?.[field], label, quoteHistoryState[field]);
    catalogOptions('historyYear', data.years, '全部年份', quoteHistoryState.year);
    host.querySelector('#historyCategory').hidden = tab === 'documents'; host.querySelector('#historyYear').hidden = tab === 'documents';
    if (tab === 'documents') {
      head.innerHTML = '<tr><th>来源文件 / 单号</th><th>客户 / 国家</th><th>日期</th><th>单据总额</th><th>明细数</th><th>资料类别</th><th>来源路径</th></tr>';
      body.innerHTML = data.items.map(d => `<tr><td><b>${esc(d.filename)}</b><small>${esc(d.quoteNo || '未识别')}</small></td><td>${esc(d.clientName || '未识别')}<small>${esc(d.country || '')}</small></td><td>${esc(d.date || '未识别')}</td><td>${catalogNumber(d.amount)} ${esc(d.currency)}</td><td>${d.detailCount}</td><td>${esc(d.kind)}</td><td class="catalog-spec" title="${esc(d.sourcePath)}">${esc(d.sourcePath)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">暂无可见单据</td></tr>';
    } else {
      head.innerHTML = '<tr><th>产品 / 规格原文</th><th>客户 / 国家</th><th>日期 / 单号</th><th>数量 / 单位</th><th>历史单价</th><th>资料 / 条款</th><th>整理状态</th><th>操作</th></tr>';
      body.innerHTML = historyTableRows(data.items, tab === 'review') || '<tr><td colspan="8" class="empty">暂无匹配的历史明细</td></tr>';
      bindHistoryActions(host, data.items);
    }
    host.querySelector('#historyCount').textContent = data.total ? `显示 ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} / 共 ${data.total.toLocaleString()} 条` : '暂无匹配记录';
    catalogPager(host.querySelector('#historyPager'), data, page => { quoteHistoryState.page = page; loadQuoteHistory(); });
  } catch (error) {
    if (version !== quoteHistoryState.request || uid !== currentUser?.id || !host.isConnected) return;
    host.querySelector('#historyMessage').innerHTML = `<div class="catalog-error">${esc(error.message)} <button type="button" class="btn-ghost btn-mini" id="historyRetry">重试</button></div>`;
    host.querySelector('#historyRetry').onclick = loadQuoteHistory;
  }
}
window.refreshHistoricalQuotes = loadQuoteHistory;

async function openQuoteDataImport() {
  openModal('导入报价数据', `<div class="catalog-detail"><div class="field"><label>选择报价数据文件（CSV / JSON）</label><input type="file" id="historyImportFile" accept=".csv,.json"><p class="muted">可下载 CSV 模板填写报价明细，Excel 文件请另存为 UTF-8 CSV。也支持结构化 JSON 格式，单份最多20 MB。</p></div><button type="button" class="btn-ghost" id="historyTemplate">下载 CSV 模板</button><div id="historyImportPreview" role="status"><p class="muted">选择文件后先预览，不会直接写入产品或报价。</p></div></div>`, { plain: true, wide: true, noFooter: true });
  const form = document.getElementById('modalForm'), host = form.querySelector('#historyImportPreview'); let sequence = 0;
  form.querySelector('#historyTemplate').onclick = async () => {
    try {
      const { columns } = await catalogApi('/api/products/import-template');
      const url = URL.createObjectURL(new Blob(['\uFEFF' + columns.map(v => '"' + v.replaceAll('"','""') + '"').join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = '历史报价明细模板.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast(e.message); }
  };
  form.querySelector('#historyImportFile').onchange = async event => {
    const version = ++sequence, file = event.target.files[0]; host.textContent = ''; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw Error('文件不能超过20 MB');
      if (!/\.(csv|json)$/i.test(file.name)) throw Error('请选择 CSV 或 JSON 文件');
      host.textContent = '正在读取并预览…';
      const upload = { format: /\.csv$/i.test(file.name) ? 'csv' : 'json', filename: file.name, content: await file.text() };
      const data = await catalogApi('/api/products/import-preview', { method: 'POST', timeout: 120000, body: JSON.stringify(upload) });
      if (version !== sequence || !host.isConnected) return;
      const c = data.counts, done = c.total === c.alreadyImported;
      host.innerHTML = `<div class="catalog-import-counts"><b>${c.total.toLocaleString()} 条明细</b><b>${data.documents.toLocaleString()} 份单据</b><b>${c.created.toLocaleString()} 个新产品</b></div><p>新关联 ${c.linked.toLocaleString()} 条，费用 ${c.fee.toLocaleString()} 条，待整理 ${c.review.toLocaleString()} 条；已导入 ${c.alreadyImported.toLocaleString()} 条。</p><p class="muted">新增产品标记为待完善。相同文件再次导入会跳过已有记录。</p>${data.samples.slice(0, 5).map(p => `<p>${esc(p.name)} · ${esc(p.model?.slice(0,80) || '规格未填写')}</p>`).join('')}${done ? '<p class="badge ok">这批明细已导入，无需重复操作</p>' : '<button type="button" class="btn-primary" id="historyConfirmImport">确认导入并关联产品</button>'}`;
      host.querySelector('#historyConfirmImport')?.addEventListener('click', async e => {
        const button = e.target, input = form.querySelector('#historyImportFile'); button.disabled = true; input.disabled = true; button.textContent = '正在导入…';
        try {
          const result = await catalogApi('/api/products/import-history', { method: 'POST', timeout: 120000, body: JSON.stringify({ batchId: data.batchId, upload }) });
          closeModal(); switchHistoryTab('imports'); toast(result.imported ? '已导入报价数据并关联产品' : '该批数据已导入');
        } catch (err) { button.disabled = false; input.disabled = false; button.textContent = '重试导入'; toast(err.message); }
      });
    } catch (error) { if (version === sequence && host.isConnected) host.innerHTML = `<p class="catalog-error">${esc(error.message)}</p>`; }
  };
}
