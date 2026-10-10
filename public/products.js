// 产品档案、图文浏览与报价选品复用系统的登录权限。
let products = [];
const catalogState = { page:1, pageSize:10, q:'', category:'', status:'', incomplete:'', industry:'', unit:'', priceMode:'', layout:'list', expandedCategories:false, selected:new Set(), request:0, canManage:false, data:null };
let catalogSearchTimer;
const catalogNumber = value => value == null || value === '' ? '未填写' : Number(value).toLocaleString('zh-CN',{maximumFractionDigits:4});
const catalogStatus = status => `<span class="badge ${status==='停用'?'muted':status==='待完善'?'info':'ok'}">${esc(status||'在用')}</span>`;
function catalogIcon(name='box') {
  const paths = {box:'<path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8M7 5.8l9 5"/>',check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',categories:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',filter:'<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.box}</svg>`;
}
async function catalogApi(path,options) { const r=await api(path,options),data=await r.json();if(!r.ok)throw Error(data.error||'请求失败，请重试');return data; }
function catalogThumbnail(product,className='') {
  const image=(product.attachments||[]).find(f=>f.type==='image');
  return `<span class="catalog-thumbnail ${image?'has-image':''} ${className}">${image?`<img data-catalog-image src="${esc(image.url)}" alt="${esc(product.name)}" loading="lazy">`:''}<span class="catalog-placeholder">${catalogIcon()}</span></span>`;
}
function bindCatalogImages(host) { host.querySelectorAll('[data-catalog-image]').forEach(img=>img.onerror=()=>{img.hidden=true;img.parentElement.classList.remove('has-image');}); }
function catalogShell() {
  const sec=document.getElementById('view-products');if(!sec||sec.querySelector('#catalogProducts'))return sec;
  sec.innerHTML=`<div class="catalog-workspace" id="catalogWorkspace"><div class="catalog-main"><div class="sales-page-heading catalog-heading"><div><h2>产品库</h2><p>统一管理产品资料、技术参数、图片及历史报价，支持快速查找和用于报价</p></div><div class="sales-actions"><button type="button" class="btn-primary" id="productAdd">＋ 新增产品</button></div></div><div class="catalog-kpis" id="catalogStats"></div><nav id="catalogCategories" class="catalog-categories" aria-label="产品分类快捷筛选"></nav>
  <div class="sales-card" id="catalogProducts"><div class="sales-filters catalog-filters catalog-toolbar"><input id="productSearch" placeholder="搜索名称 / 型号 / 编码" aria-label="搜索产品"><select id="catalogCategory" aria-label="产品分类" data-no-combo></select><select id="catalogStatusFilter" aria-label="产品状态" data-no-combo><option value="">全部状态</option><option>在用</option><option>待完善</option><option>停用</option></select><select id="catalogIndustry" aria-label="应用行业" data-no-combo></select><button type="button" class="btn-ghost" id="catalogMoreFilters" aria-expanded="false">${catalogIcon('filter')}更多筛选</button><button type="button" class="btn-ghost" id="catalogReset">重置</button><div class="catalog-view-toggle" role="group" aria-label="浏览方式"><button type="button" id="catalogListView" aria-label="列表视图">${catalogIcon('list')}</button><button type="button" id="catalogGridView" aria-label="卡片视图">${catalogIcon('categories')}</button></div><button type="button" class="btn-ghost" id="catalogExport">${catalogIcon('download')}导出</button><span id="catalogColumnTools" class="catalog-column-tools"></span></div>
  <div class="catalog-advanced" id="catalogAdvanced" hidden><label id="catalogIncompleteLabel"><input id="catalogIncomplete" type="checkbox">资料未完整</label><label>计价单位 <select id="catalogUnit" data-no-combo></select></label><label>价格 <select id="catalogPriceMode" data-no-combo><option value="">全部价格资料</option><option value="history">有可见历史价格</option><option value="manual">已设置参考价</option><option value="missing">暂无可见价格</option></select></label></div>
  <div class="catalog-bulk" id="catalogBulk" hidden></div><div id="catalogMessage" role="status"></div><div class="table-wrap catalog-table"><table class="data-table" data-column-toolbar="#catalogColumnTools"><thead id="catalogHead"></thead><tbody id="productBody"></tbody></table></div><div id="catalogCards" class="catalog-product-cards" hidden></div><div class="catalog-footer"><span class="muted" id="catalogCount"></span><div class="pagination" id="catalogPager"></div><label class="catalog-page-size"><select id="catalogPageSize" aria-label="每页产品数量" data-no-combo><option value="10">10 条/页</option><option value="25">25 条/页</option><option value="50">50 条/页</option></select></label><label class="catalog-page-jump">跳至 <input id="catalogPageJump" type="number" min="1" aria-label="跳转到页码"> 页</label></div></div></div><aside id="catalogDrawer" class="catalog-drawer" aria-label="产品详情" hidden></aside></div>`;
  sec.querySelector('#productAdd').onclick=()=>openProductModal();
  sec.querySelector('#productSearch').oninput=e=>{catalogState.q=e.target.value;catalogState.page=1;clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(loadProducts,220);};
  for(const [id,field] of [['catalogCategory','category'],['catalogStatusFilter','status'],['catalogIndustry','industry'],['catalogUnit','unit'],['catalogPriceMode','priceMode']])sec.querySelector('#'+id).onchange=e=>{catalogState[field]=e.target.value;catalogState.page=1;loadProducts();};
  sec.querySelector('#catalogIncomplete').onchange=e=>{catalogState.incomplete=e.target.checked?'1':'';catalogState.page=1;loadProducts();};
  sec.querySelector('#catalogMoreFilters').onclick=e=>{const button=e.currentTarget,box=sec.querySelector('#catalogAdvanced');box.hidden=!box.hidden;button.setAttribute('aria-expanded',String(!box.hidden));};
  sec.querySelector('#catalogReset').onclick=()=>{for(const field of ['q','category','status','industry','unit','priceMode','incomplete'])catalogState[field]='';sec.querySelector('#productSearch').value='';sec.querySelector('#catalogIncomplete').checked=false;catalogState.page=1;loadProducts();};
  for(const [id,mode] of [['catalogListView','list'],['catalogGridView','grid']])sec.querySelector('#'+id).onclick=()=>{catalogState.layout=mode;if(catalogState.data)renderCatalogProducts(sec,catalogState.data);};
  sec.querySelector('#catalogPageSize').onchange=e=>{catalogState.pageSize=Number(e.target.value);catalogState.page=1;loadProducts();};
  sec.querySelector('#catalogPageJump').onkeydown=e=>{if(e.key!=='Enter')return;e.preventDefault();const page=Number(e.target.value);if(!Number.isInteger(page)||page<1||page>(catalogState.data?.pages||1))return toast('请填写有效页码');catalogState.page=page;loadProducts();};
  sec.querySelector('#catalogExport').onclick=exportCatalog;
  return sec;
}
function catalogOptions(id,values,label,selected) { const el=document.getElementById(id);el.innerHTML=`<option value="">${label}</option>`+(values||[]).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=selected||''; }
function catalogPager(element,result,onPage) {
  const nums=[1,...Array.from({length:5},(_,i)=>result.page-2+i),result.pages].filter(n=>n>=1&&n<=result.pages).sort((a,b)=>a-b),unique=[...new Set(nums)];let previous=0;
  const pages=unique.map(n=>{const gap=previous&&n-previous>1?'<span class="muted">…</span>':'';previous=n;return gap+`<button type="button" class="page-btn ${n===result.page?'active':''}" data-page="${n}" ${n===result.page?'aria-current="page"':''}>${n}</button>`;}).join('');
  element.innerHTML=`<button type="button" class="page-btn" ${result.page<=1?'disabled':''} data-page="${result.page-1}" aria-label="上一页">‹</button>${pages}<button type="button" class="page-btn" ${result.page>=result.pages?'disabled':''} data-page="${result.page+1}" aria-label="下一页">›</button>`;
  element.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>onPage(Number(b.dataset.page)));
}
function catalogParams(page=catalogState.page,pageSize=catalogState.pageSize) { const p=new URLSearchParams({page,pageSize,q:catalogState.q});for(const field of ['category','status','incomplete','industry','unit','priceMode'])if(catalogState[field])p.set(field,catalogState[field]);return p; }
function renderCatalogCategories(sec,data) {
  const categories=data.categories||[],items=catalogState.expandedCategories?categories:categories.slice(0,6);
  const card=(name,count,image)=>`<button type="button" class="catalog-category ${catalogState.category===name?'active':''}" data-catalog-category="${esc(name)}"><span class="catalog-category-visual ${image?'has-image':''}">${image?`<img data-catalog-image src="${esc(image)}" alt="" loading="lazy">`:''}<span class="catalog-placeholder">${catalogIcon(name?'categories':'box')}</span></span><b title="${esc(name||'全部产品')}">${esc(name||'全部产品')}</b><small>${count.toLocaleString()}</small></button>`;
  sec.querySelector('#catalogCategories').innerHTML=card('',data.stats.total,'')+items.map(c=>card(c.name,c.count,c.image)).join('')+(categories.length>6?`<button type="button" class="catalog-category catalog-category-more" id="catalogMoreCategories"><span class="catalog-category-visual">${catalogIcon('categories')}</span><b>${catalogState.expandedCategories?'收起分类':'更多分类'}</b><small>${categories.length} 个分类</small></button>`:'');
  sec.querySelectorAll('[data-catalog-category]').forEach(b=>b.onclick=()=>{catalogState.category=b.dataset.catalogCategory;catalogState.page=1;loadProducts();});
  sec.querySelector('#catalogMoreCategories')?.addEventListener('click',()=>{catalogState.expandedCategories=!catalogState.expandedCategories;renderCatalogCategories(sec,data);});bindCatalogImages(sec.querySelector('#catalogCategories'));
}
async function loadProducts() {
  const sec=catalogShell();if(!sec||!currentUser)return;const version=++catalogState.request,uid=currentUser.id;sec.querySelector('#catalogMessage').textContent='加载中…';
  try {
    const data=await catalogApi('/api/products/catalog?'+catalogParams());if(version!==catalogState.request||uid!==currentUser?.id)return;
    catalogState.page=data.page;catalogState.canManage=['admin','manager'].includes(currentUser.role);catalogState.data=data;
    sec.querySelector('#catalogMessage').textContent='';for(const [id,field,label]of [['catalogCategory','category','全部分类'],['catalogIndustry','industry','全部应用行业'],['catalogUnit','unit','全部单位']])catalogOptions(id,data.facets?.[field],label,catalogState[field]);
    sec.querySelector('#catalogStatusFilter').value=catalogState.status;sec.querySelector('#catalogPriceMode').value=catalogState.priceMode;sec.querySelector('#catalogPageSize').value=String(catalogState.pageSize);sec.querySelector('#catalogPageJump').max=data.pages;sec.querySelector('#catalogPageJump').value='';
    const stats=data.stats;sec.querySelector('#catalogStats').innerHTML=[['产品总数',stats.total,'box'],['在用产品',stats.active,'check'],['待完善',stats.pending,'clock'],['产品分类',stats.categories,'categories']].map(([label,n,icon])=>`<div class="catalog-stat"><span class="catalog-stat-icon ${icon}">${catalogIcon(icon)}</span><section><span>${label}</span><strong>${n.toLocaleString()}</strong></section></div>`).join('');
    renderCatalogCategories(sec,data);products=data.items;renderCatalogProducts(sec,data);sec.querySelector('#catalogCount').textContent=data.total?`共 ${data.total.toLocaleString()} 条 · 显示 ${(data.page-1)*data.pageSize+1}–${Math.min(data.page*data.pageSize,data.total)}`:'暂无匹配记录';catalogPager(sec.querySelector('#catalogPager'),data,page=>{catalogState.page=page;loadProducts();});renderCatalogBulk();
  }catch(error){if(version!==catalogState.request||uid!==currentUser?.id)return;sec.querySelector('#catalogMessage').innerHTML=`<div class="catalog-error">${esc(error.message)} <button type="button" class="btn-ghost btn-mini" id="catalogRetry">重试</button></div>`;sec.querySelector('#catalogRetry').onclick=loadProducts;}
}
window.loadProducts=loadProducts;
function catalogPriceAmount(g) { const amount=g.min===g.max?catalogNumber(g.min):catalogNumber(g.min)+'–'+catalogNumber(g.max);return `${amount} ${esc(g.currency||'币种未识别')} / ${esc(g.unit||'单位未识别')}`; }
function catalogListPrices(p) {
  const manual=p.price!=null&&p.price!==''?`<b>参考价 ${catalogNumber(p.price)} ${esc(p.currency||'币种未填写')}</b><small>${esc(p.unit||'单位未填写')}</small>`:'';
  const g=p.prices?.[0],history=g?`<b>${catalogPriceAmount(g)}</b><small>${esc(g.kind||'资料类别未识别')} · ${g.latest?esc(g.latest.date):'日期未识别'}</small>`:'';
  return `<div class="catalog-list-price">${manual||history||'<span class="muted">暂无可见价格</span>'}${manual&&history?'<small>另有历史价格</small>':''}${(p.prices?.length||0)>1?`<small>另有 ${p.prices.length-1} 组价格</small>`:''}</div>${p.historyCount?`<button type="button" class="sales-link catalog-history-count" data-product-history="${esc(p.id)}">历史报价 ${p.historyCount} 条</button>`:''}`;
}
function catalogParameters(p) { return String(p.parameters||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
function catalogCompleteness(p) {const n=Number(p.completeness)||0;return `<span class="catalog-completeness-label">资料 ${n}%</span><span class="catalog-completeness-track"><i style="width:${Math.min(100,Math.max(0,n))}%"></i></span>`;}
function catalogProductInfo(p) {return `<button type="button" class="catalog-product-info" data-product-detail="${esc(p.id)}">${catalogThumbnail(p)}<span><b title="${esc(p.name)}">${esc(p.name)}</b><small>${esc(p.code||'编码待补充')}</small>${p.tags?.length?`<span class="catalog-tags">${p.tags.slice(0,3).map(t=>`<span>${esc(t)}</span>`).join('')}</span>`:''}</span></button>`;}
function renderCatalogProducts(sec,data) {
  const columns=[...(catalogState.canManage?[['check','<input type="checkbox" id="catalogSelectAll" aria-label="选择本页产品">']]:[]),['name','产品信息'],['category','分类'],['model','型号 / 规格'],['parameters','核心参数'],['price','价格 / 历史报价'],['completeness','资料状态'],['status','状态'],['ops','操作']];
  sec.querySelector('#catalogHead').innerHTML='<tr>'+columns.map(([key,label])=>`<th data-col="${key}">${label}</th>`).join('')+'</tr>';
  sec.querySelector('#productBody').innerHTML=data.items.map(p=>{const params=catalogParameters(p);return `<tr data-catalog-item="${esc(p.id)}" tabindex="0" aria-label="查看${esc(p.name)}" class="${window.catalogDrawerId===p.id?'catalog-active-row':''}">${catalogState.canManage?`<td data-col="check"><input type="checkbox" data-product-select="${esc(p.id)}" ${catalogState.selected.has(p.id)?'checked':''} aria-label="选择${esc(p.name)}"></td>`:''}<td data-col="name">${catalogProductInfo(p)}</td><td data-col="category"><span class="catalog-clamp">${esc(p.category||'未分类')}</span></td><td data-col="model"><span class="catalog-clamp" title="${esc(p.model||'')}">${esc(p.model||'待填写')}</span><small>${esc(p.unit||'')}</small></td><td data-col="parameters"><span class="catalog-parameter-preview">${params.length?params.slice(0,3).map(x=>`<span>${esc(x)}</span>`).join(''):'<span class="muted">参数待补充</span>'}</span></td><td data-col="price" class="catalog-price-cell">${catalogListPrices(p)}</td><td data-col="completeness">${catalogCompleteness(p)}</td><td data-col="status">${catalogStatus(p.status)}</td><td data-col="ops" class="sales-nowrap"><button type="button" class="sales-link" data-product-edit="${esc(p.id)}">编辑</button><button type="button" class="sales-link" data-product-quote="${esc(p.id)}" ${p.status==='停用'?'disabled':''}>用于报价</button></td></tr>`;}).join('')||`<tr><td colspan="${columns.length}" class="empty">没有匹配产品，可调整筛选或新增产品档案</td></tr>`;
  sec.querySelector('#catalogCards').innerHTML=data.items.map(p=>`<article class="catalog-product-card ${window.catalogDrawerId===p.id?'active':''}" data-catalog-item="${esc(p.id)}">${catalogState.canManage?`<label class="catalog-card-select"><input type="checkbox" data-product-select="${esc(p.id)}" ${catalogState.selected.has(p.id)?'checked':''} aria-label="选择${esc(p.name)}"></label>`:''}<button type="button" class="catalog-card-image" data-product-detail="${esc(p.id)}">${catalogThumbnail(p)}</button><div class="catalog-card-content"><button type="button" class="sales-link catalog-card-title" data-product-detail="${esc(p.id)}">${esc(p.name)}</button><small>${esc(p.code||'编码待补充')} · ${esc(p.category||'未分类')}</small>${catalogListPrices(p)}${catalogCompleteness(p)}<div class="catalog-card-footer">${catalogStatus(p.status)}<button type="button" class="sales-link" data-product-edit="${esc(p.id)}">编辑</button><button type="button" class="sales-link" data-product-quote="${esc(p.id)}" ${p.status==='停用'?'disabled':''}>用于报价</button></div></div></article>`).join('')||'<div class="empty">没有匹配产品</div>';
  sec.querySelector('.catalog-table').hidden=catalogState.layout!=='list';sec.querySelector('#catalogCards').hidden=catalogState.layout!=='grid';sec.querySelector('#catalogColumnTools').hidden=catalogState.layout!=='list';for(const [id,layout]of [['catalogListView','list'],['catalogGridView','grid']]){const b=sec.querySelector('#'+id);b.classList.toggle('active',catalogState.layout===layout);b.setAttribute('aria-pressed',String(catalogState.layout===layout));}
  sec.querySelectorAll('[data-product-detail]').forEach(b=>b.onclick=()=>openProductDetail(b.dataset.productDetail));sec.querySelectorAll('[data-product-history]').forEach(b=>b.onclick=()=>openProductDetail(b.dataset.productHistory,1,'history'));sec.querySelectorAll('[data-product-edit]').forEach(b=>b.onclick=()=>openProductModal(b.dataset.productEdit));sec.querySelectorAll('[data-product-quote]').forEach(b=>b.onclick=()=>quoteFromProduct(products.find(p=>p.id===b.dataset.productQuote)));
  sec.querySelectorAll('[data-product-select]').forEach(box=>box.onchange=()=>{box.checked?catalogState.selected.add(box.dataset.productSelect):catalogState.selected.delete(box.dataset.productSelect);renderCatalogBulk();});
  sec.querySelectorAll('tr[data-catalog-item]').forEach(row=>{row.onclick=e=>{if(!e.target.closest('button,input,a'))openProductDetail(row.dataset.catalogItem);};row.onkeydown=e=>{if(e.target!==row||!['Enter',' '].includes(e.key))return;e.preventDefault();openProductDetail(row.dataset.catalogItem);};});
  const all=sec.querySelector('#catalogSelectAll');if(all)all.onchange=()=>{sec.querySelectorAll('[data-product-select]').forEach(box=>{box.checked=all.checked;all.checked?catalogState.selected.add(box.dataset.productSelect):catalogState.selected.delete(box.dataset.productSelect);});renderCatalogBulk();};bindCatalogImages(sec);
}
async function exportCatalog() {
  const button=document.getElementById('catalogExport');button.disabled=true;const previous=button.innerHTML;button.textContent='正在导出…';const params=catalogParams(1,100),rows=[],uid=currentUser?.id;
  try {let page=1,pages=1;do{params.set('page',page);const data=await catalogApi('/api/products/catalog?'+params);if(currentUser?.id!==uid)throw Error('登录用户已变化，请重新导出');rows.push(...data.items);pages=data.pages;page++;}while(page<=pages);
    const cell=value=>{let v=String(value??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};const header=['产品名称','编码','分类','型号/规格','技术参数','单位','参考价','币种','历史价格分组','历史报价条数','状态','适用行业','产品标签'];const csv=[header,...rows.map(p=>[p.name,p.code,p.category,p.model,p.parameters,p.unit,p.price,p.currency,(p.prices||[]).map(g=>`${g.min===g.max?g.min:g.min+'–'+g.max} ${g.currency||'币种未识别'} / ${g.unit||'单位未识别'} · ${g.kind||''}`).join('\n'),p.historyCount,p.status,(p.industries||[]).join('、'),(p.tags||[]).join('、')])].map(row=>row.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='产品库-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出 ${rows.length} 个产品`);
  }catch(e){toast(e.message);}finally{button.disabled=false;button.innerHTML=previous;}
}
function historyTableRows(rows, review = false) {
  return rows.map(r => `<tr><td><b>${esc(r.name || r.filename)}</b><small class="catalog-spec">${esc(r.model || '')}</small></td><td>${esc(r.clientName || '未识别')}<small>${esc(r.country || '')}</small></td><td>${esc(r.date || '日期未识别')}<small>${esc(r.quoteNo || '单号未识别')}</small></td><td>${catalogNumber(r.qty)} ${esc(r.unit || '')}</td><td class="sales-nowrap">${catalogNumber(r.unitPrice)} ${esc(r.currency || '')}</td><td>${esc(r.kind)}<small>${esc(r.tradeTerms || '')}</small></td><td>${r.disposition === 'linked' ? '<span class="badge ok">已关联</span>' : r.disposition === 'fee' ? '<span class="badge muted">服务 / 费用</span>' : '<span class="badge info">待整理</span>'}${r.reason ? `<small>${esc(r.reason)}</small>` : ''}</td><td><button type="button" class="sales-link" data-history-source="${esc(r.id)}">来源</button>${review ? ` <button type="button" class="sales-link" data-history-review="${esc(r.id)}">整理</button>` : r.productId ? ` <button type="button" class="sales-link" data-product-detail="${esc(r.productId)}">产品</button>` : ''}</td></tr>`).join('');
}
function bindHistoryActions(container, rows) {
  container.querySelectorAll('[data-history-source]').forEach(b => b.onclick = () => {
    const r = rows.find(r => r.id === b.dataset.historySource);
    openModal('历史报价来源', `<div class="catalog-source"><p><b>${esc(r.name || r.filename)}</b></p><p>来源文件：${esc(r.filename)}</p><p>原始路径：${esc(r.sourcePath)}</p><p>报价单号：${esc(r.quoteNo || '未识别')} · 日期：${esc(r.date || '未识别')}</p><p>资料类别：${esc(r.kind)}</p><p>规格原文：${esc(r.model || '未填写')}</p><p>备注：${esc(r.notes || '未填写')}</p><p class="muted">历史文件抽取记录；原文件需按路径查阅。</p></div>`, { wide: true, plain: true, noFooter: true });
  });
  container.querySelectorAll('[data-history-review]').forEach(b => b.onclick = () => reviewHistoryLine(rows.find(r => r.id === b.dataset.historyReview)));
  container.querySelectorAll('[data-product-detail]').forEach(b => b.onclick = () => openProductDetail(b.dataset.productDetail));
}
function renderCatalogBulk() {
  const box = document.getElementById('catalogBulk'); if (!box) return;
  box.hidden = !catalogState.canManage || !catalogState.selected.size;
  box.innerHTML = `<span>已选 ${catalogState.selected.size} 个产品</span><button type="button" class="btn-ghost btn-mini" id="catalogBulkEdit">批量分类 / 状态</button><button type="button" class="btn-ghost btn-mini" id="catalogMerge">合并产品</button><button type="button" class="btn-ghost btn-mini" id="catalogClearSelect">清空选择</button>`;
  box.querySelector('#catalogClearSelect').onclick = () => { catalogState.selected.clear(); loadProducts(); };
  box.querySelector('#catalogBulkEdit').onclick = () => {
    openModal('批量更新产品', '<div class="field"><label>分类（留空保留原分类）</label><input name="category"></div><div class="field"><label>状态</label><select name="status"><option value="">保留原状态</option><option>在用</option><option>待完善</option><option>停用</option></select></div>');
    document.getElementById('modalForm').onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target), patch = {}; for (const field of ['category','status']) if (fd.get(field)) patch[field] = fd.get(field); try { await catalogApi('/api/products/bulk', { method: 'POST', body: JSON.stringify({ ids: [...catalogState.selected], patch }) }); closeModal(); catalogState.selected.clear(); loadProducts(); toast('已更新'); } catch (error) { toast(error.message); } };
  };
  box.querySelector('#catalogMerge').onclick = async () => {
    if (catalogState.selected.size < 2) return toast('请选择至少两个产品');
    try {
      const selected = await Promise.all([...catalogState.selected].map(id => catalogApi('/api/products/' + id + '/detail')));
      openModal('合并产品', `<div class="field full"><label>保留产品档案</label><select name="keepId">${selected.map(({product:p}) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.model || '未填规格')}</option>`).join('')}</select><p class="muted">请确认这些记录属于同一产品。来源规格和旧报价内容会保留，其他档案设为已合并。</p></div>`);
      document.getElementById('modalForm').onsubmit = async e => { e.preventDefault(); const keepId = new FormData(e.target).get('keepId'); try { await catalogApi('/api/products/merge', { method:'POST', body:JSON.stringify({keepId, removeIds:[...catalogState.selected].filter(id=>id!==keepId)}) }); closeModal(); catalogState.selected.clear(); loadProducts(); toast('已合并'); } catch(error) { toast(error.message); } };
    } catch(error) { toast(error.message); }
  };
}
async function openProductModal(id, prefill = {}, onSaved, reviewRow) {
  let p = prefill;
  try { if (id) p = (await catalogApi('/api/products/' + id + '/detail')).product; } catch (error) { return toast(error.message); }
  let supplierOptions = [];
  try { supplierOptions = await catalogApi('/api/suppliers'); } catch {}
  const supplierSelect = `<div class="field"><label>供应商</label><select name="supplierId"><option value="">暂未关联</option>${p.supplierId && !supplierOptions.some(s => s.id === p.supplierId) ? `<option value="${esc(p.supplierId)}" selected>已关联供应商</option>` : ''}${supplierOptions.map(s => `<option value="${esc(s.id)}" ${s.id === p.supplierId ? 'selected' : ''}>${esc(s.name || '未命名供应商')}</option>`).join('')}</select></div>`;
  const attachments = [...(p.attachments || [])];
  openModal(id ? '编辑产品档案' : '新增产品档案', `<div class="form-grid">
    ${field('产品名称 *','name',p.name || '', 'text','required maxlength="150"')}${field('英文名称','nameEn',p.nameEn || '')}${field('产品编码','code',p.code || '')}${field('产品标签（逗号分隔）','tags',(p.tags || []).join('、'))}${field('适用行业（逗号分隔）','industries',(p.industries || []).join('、'))}${field('产品分类','category',p.category || '')}${field('计价单位','unit',p.unit || '', 'text','placeholder="如 SET / PCS / M"')}
    <div class="field"><label>状态</label><select name="status">${['在用','待完善','停用'].map(s=>`<option ${s===(p.status||'在用')?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="field full"><label>型号 / 规格</label><textarea name="model" rows="3">${esc(p.model || '')}</textarea></div>${field('参考价','price',p.price ?? '', 'number','min="0" step="any"')}${field('参考价币种','currency',p.currency || '', 'text','placeholder="如 USD / CNY"')}
    <div class="field full"><label>别名（每行一个）</label><textarea name="aliases" rows="2">${esc((p.aliases || []).join('\n'))}</textarea></div><div class="field full"><label>描述 / 卖点</label><textarea name="description" rows="4">${esc(p.description || '')}</textarea></div><div class="field full"><label>英文描述 / 卖点</label><textarea name="descriptionEn" rows="4">${esc(p.descriptionEn || '')}</textarea></div><div class="field full"><label>技术参数（每行一个参数） <button type="button" class="btn-ghost btn-mini" id="catalogParamTemplate">插入参数模板</button></label><textarea name="parameters" rows="4" placeholder="电压：380V\n材质：304不锈钢">${esc(p.parameters || '')}</textarea></div>${supplierSelect}${field('供货周期','leadTime',p.leadTime || '')}<div class="field full"><label>图片 / 视频 / 图纸 / 说明书</label><input id="catalogFiles" type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"><p class="muted">单份不超过20 MB，产品资料随档案共享；历史报价原件保留在来源记录中。</p><div id="catalogFileList"></div><div id="catalogUploadStatus" role="status"></div></div><div class="field full"><label>资料备注</label><textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></div></div>`, {wide:true});
  const form = document.getElementById('modalForm'); let saving = false, uploading = false;
  const renderFiles = () => {
    form.querySelector('#catalogFileList').innerHTML = attachments.map((file, index) => `<div class="catalog-file-row"><a href="${esc(file.url)}" target="_blank" rel="noopener">${esc(file.name)}</a><button type="button" class="sales-link" data-remove-file="${index}">移除</button></div>`).join('');
    form.querySelectorAll('[data-remove-file]').forEach(b => b.onclick = () => { attachments.splice(Number(b.dataset.removeFile), 1); renderFiles(); });
  };
  renderFiles();
  form.querySelector('#catalogParamTemplate').onclick = () => {
    const input = form.querySelector('[name="parameters"]'),category=form.querySelector('[name="category"]').value;
    const names = /输送/.test(category) ? ['长度','宽度','高度','材质','电压','功率','速度','载荷'] : ['型号','尺寸','材质','电压','功率','产能'];
    const missing = names.filter(name => !input.value.includes(name + '：'));
    input.value = [input.value, missing.map(name => name + '：').join('\n')].filter(Boolean).join('\n');
  };
  form.querySelector('#catalogFiles').onchange = async event => {
    if (uploading) return; const files = [...event.target.files]; if (!files.length) return;
    if (attachments.length + files.length > 50) return toast('每个产品最多50份资料');
    uploading = true; const status = form.querySelector('#catalogUploadStatus'), save=document.querySelector('#modalFoot [type="submit"]'); if (save) save.disabled=true;
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw Error(file.name + ' 超过20 MB');
        status.textContent='正在上传：' + file.name;
        const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});
        const uploaded=await catalogApi('/api/upload',{method:'POST',timeout:120000,body:JSON.stringify({filename:file.name,data:encoded})});
        if (!status.isConnected) return;
        attachments.push({name:uploaded.name,url:uploaded.url,size:uploaded.size});renderFiles();
      }
      status.textContent='已上传，保存产品后关联资料';
    } catch(error){status.textContent=error.message;toast(error.message);} finally{uploading=false;if(save)save.disabled=false;}
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (saving || uploading) return; saving = true;
    const data = Object.fromEntries(new FormData(form)); data.attachments = attachments; for (const field of ['tags','industries']) data[field] = String(data[field] || '').split(/[,，、\n]/).map(s=>s.trim()).filter(Boolean); data.aliases = data.aliases.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); if (id) data.expectedUpdatedAt = p.updatedAt;
    try { const result = await catalogApi(reviewRow ? '/api/products/review/' + reviewRow.id : '/api/products' + (id ? '/' + id : ''), {method:id?'PUT':'POST',body:JSON.stringify(reviewRow ? { action: 'create', product: data, expectedDisposition: reviewRow.disposition } : data)}); const saved = reviewRow ? result.product : result; closeModal(); toast('已保存产品'); loadProducts(); window.refreshHistoricalQuotes?.(); if (onSaved) onSaved(saved); else window.refreshCatalogDrawer?.(saved.id); } catch(error) { toast(error.message); } finally { saving=false; }
  };
}
function quoteFromProduct(product, history) {
  if (!product || product.status==='停用' || product.mergedInto) return toast('该产品已停用');
  window.openQuoteModal(null,{ currency:history?.currency || product.currency || 'USD', items:[{type:product.category?.startsWith('配件')?'spare':'equipment',name:product.name,description:history?.model || product.model || product.description || '',qty:1,unit:history?.unit || product.unit || '',unitPrice:history?.unitPrice ?? product.price ?? null,productId:product.id,sourceHistoryId:history?.id || ''}] });
}
async function reviewHistoryLine(row) {
  openModal('整理历史产品', `<div class="catalog-detail"><p class="catalog-pre"><b>抽取原文</b>\n${esc(row.name)}\n${esc(row.model)}</p><p class="muted">${esc(row.reason)} · ${esc(row.filename)}</p><div class="field"><label>搜索已有产品</label><input id="reviewProductSearch" placeholder="名称 / 型号"></div><div id="reviewProductResults"></div><button type="button" class="btn-ghost" id="reviewCreate">整理后新建产品</button> <button type="button" class="btn-ghost" id="reviewFee">归为服务 / 费用</button></div>`,{plain:true,wide:true,noFooter:true});
  const form=document.getElementById('modalForm');let timer,sequence=0;
  const apply=async payload=>{try{await catalogApi('/api/products/review/'+row.id,{method:'POST',body:JSON.stringify({ ...payload, expectedDisposition: row.disposition })});closeModal();loadProducts();window.refreshHistoricalQuotes?.();toast('已整理');}catch(error){toast(error.message);}};
  form.querySelector('#reviewProductSearch').oninput=event=>{clearTimeout(timer);const q=event.target.value,version=++sequence;timer=setTimeout(async()=>{try{const data=await catalogApi('/api/products/catalog?pageSize=10&q='+encodeURIComponent(q));if(version!==sequence||!form.querySelector('#reviewProductResults'))return;const host=form.querySelector('#reviewProductResults');host.innerHTML=data.items.filter(p=>p.status!=='停用').map(p=>`<button type="button" class="catalog-picker-item" data-link="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.model)}</small></button>`).join('')||'<p class="muted">没有匹配产品</p>';host.querySelectorAll('[data-link]').forEach(b=>b.onclick=()=>apply({action:'link',productId:b.dataset.link}));}catch(error){toast(error.message);}},220);};
  form.querySelector('#reviewFee').onclick=()=>apply({action:'fee'});
  form.querySelector('#reviewCreate').onclick=()=>{
    openProductModal(null,{name:'',model:row.model||row.name,category:row.category,unit:row.unit,status:'待完善'},null,row);
  };
}
// A chooser embedded in the quotation modal keeps all unsaved customer and line inputs.
window.openQuoteProductPicker = function(row) {
  const form=document.getElementById('modalForm'),host=form.querySelector('#qtProductPicker');if(!host)return;
  host.hidden=false;host.innerHTML='<div class="catalog-picker-head"><b>选择产品与历史价格</b><button type="button" class="btn-ghost btn-mini" id="qtPickerClose">关闭</button></div><input id="qtPickerSearch" aria-label="搜索产品" placeholder="搜索产品名称 / 型号"><div id="qtPickerResults"></div><div id="qtPickerPager" class="pagination"></div>';
  host.querySelector('#qtPickerClose').onclick=()=>{host.hidden=true;};let sequence=0,timer;
  const load=async(page=1)=>{const version=++sequence;try{const data=await catalogApi('/api/products/catalog?pageSize=8&page='+page+'&q='+encodeURIComponent(host.querySelector('#qtPickerSearch').value));if(version!==sequence||!host.isConnected)return;const results=host.querySelector('#qtPickerResults');results.innerHTML=data.items.filter(p=>p.status!=='停用').map(p=>`<div class="catalog-picker-item"><div><b>${esc(p.name)}</b><small>${esc(p.model||p.description||'规格未填写')}</small></div><button type="button" class="btn-ghost btn-mini" data-pick-product="${esc(p.id)}">选择</button><button type="button" class="btn-ghost btn-mini" data-pick-prices="${esc(p.id)}">历史价格</button></div>`).join('')||'<p class="muted">暂无匹配产品</p>';
    const pick=(p,h)=>{row.dataset.productId=p.id;row.dataset.sourceHistoryId=h?.id||'';row.querySelector('.qt-name').value=p.name;row.querySelector('.qt-desc').value=h?.model||p.model||p.description||'';row.querySelector('.qt-unit').value=h?.unit||p.unit||'';const currency=form.querySelector('[name="currency"]').value;const price=h?.unitPrice??(p.currency===currency?p.price:null);row.querySelector('.qt-price').value=price??'';const badge=row.querySelector('.qt-product-label');if(badge)badge.textContent='已关联：'+p.name+(h?' · 已引用历史价格':'');updateQuoteLine(Number(row.dataset.idx));host.hidden=true;};
    results.querySelectorAll('[data-pick-product]').forEach(b=>b.onclick=()=>pick(data.items.find(p=>p.id===b.dataset.pickProduct)));
    results.querySelectorAll('[data-pick-prices]').forEach(b=>b.onclick=async()=>{const product=data.items.find(p=>p.id===b.dataset.pickPrices),currency=form.querySelector('[name="currency"]').value;try{const history=await catalogApi('/api/products/history?productId='+product.id+'&currency='+encodeURIComponent(currency)+'&pageSize=100');if(!host.isConnected)return;results.innerHTML=`<p><b>${esc(product.name)}</b> · 当前报价币种 ${esc(currency)}</p>`+history.items.filter(h=>h.unitPrice!=null&&h.unitPrice>=0).map(h=>`<button type="button" class="catalog-picker-item" data-pick-history="${esc(h.id)}"><b>${catalogNumber(h.unitPrice)} ${esc(h.currency)} / ${esc(h.unit)}</b><small>${esc(h.clientName)} · ${esc(h.date||'日期未识别')} · 数量 ${catalogNumber(h.qty)} · ${esc(h.kind)} · ${esc(h.tradeTerms)}</small><small>${esc(h.model)}</small></button>`).join('')+'<button type="button" class="btn-ghost btn-mini" id="qtPickerBack">返回产品</button>';if(!history.items.some(h=>h.unitPrice!=null&&h.unitPrice>=0))results.insertAdjacentHTML('afterbegin','<p class="muted">暂无同币种可见历史价格</p>');results.querySelectorAll('[data-pick-history]').forEach(button=>button.onclick=()=>pick(product,history.items.find(h=>h.id===button.dataset.pickHistory)));results.querySelector('#qtPickerBack').onclick=()=>load(page);}catch(error){toast(error.message);}});
    catalogPager(host.querySelector('#qtPickerPager'),data,load);
  }catch(error){toast(error.message);}};
  host.querySelector('#qtPickerSearch').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(),220);};load();
};
window.onViewActivated=(function(original){return function(view){if(typeof original==='function')original(view);if(view==='products')loadProducts();else window.closeCatalogDrawer?.(false);};})(window.onViewActivated);
