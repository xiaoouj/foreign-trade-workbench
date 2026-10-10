// 产品浏览用右侧面板；表单编辑继续使用系统统一的保存弹窗。
const catalogDrawerState={id:null,tab:'basic',data:null,request:0,image:0,focus:null};
window.catalogDrawerId=null;
function closeCatalogDrawer(restoreFocus=true) {
  catalogDrawerState.id=null;catalogDrawerState.data=null;catalogDrawerState.request++;window.catalogDrawerId=null;const host=document.getElementById('catalogDrawer');if(host){host.hidden=true;host.innerHTML='';}document.getElementById('catalogWorkspace')?.classList.remove('has-detail');document.querySelectorAll('[data-catalog-item]').forEach(row=>row.classList.remove('catalog-active-row','active'));if(restoreFocus&&catalogDrawerState.focus?.isConnected)catalogDrawerState.focus.focus();
}
window.closeCatalogDrawer=closeCatalogDrawer;
window.refreshCatalogDrawer=id=>{if(catalogDrawerState.id===id)openProductDetail(id);};
async function openProductDetail(id,page=1,tab) {
  if(location.hash!=='#/products') {
    location.hash='#/products';catalogShell();
  }
  const host=document.getElementById('catalogDrawer');if(!host||!currentUser)return;
  const changed=catalogDrawerState.id!==id,version=++catalogDrawerState.request,uid=currentUser.id;
  if(changed){catalogDrawerState.tab=tab||'basic';catalogDrawerState.image=0;catalogDrawerState.focus=document.activeElement;}else if(tab)catalogDrawerState.tab=tab;
  catalogDrawerState.id=id;window.catalogDrawerId=id;host.hidden=false;document.getElementById('catalogWorkspace')?.classList.add('has-detail');
  document.querySelectorAll('[data-catalog-item]').forEach(row=>{row.classList.toggle('catalog-active-row',row.dataset.catalogItem===id&&row.tagName==='TR');row.classList.toggle('active',row.dataset.catalogItem===id&&row.tagName!=='TR');});
  host.innerHTML='<div class="catalog-drawer-loading"><button type="button" class="catalog-drawer-close" aria-label="关闭产品详情">×</button><p>正在加载产品档案…</p></div>';host.querySelector('button').onclick=()=>closeCatalogDrawer();
  try {const data=await catalogApi('/api/products/'+encodeURIComponent(id)+'/detail?page='+page);if(version!==catalogDrawerState.request||currentUser?.id!==uid||!host.isConnected)return;catalogDrawerState.data=data;renderCatalogDrawer();}
  catch(error){if(version!==catalogDrawerState.request||currentUser?.id!==uid)return;host.innerHTML=`<div class="catalog-drawer-loading"><button type="button" class="catalog-drawer-close" aria-label="关闭产品详情">×</button><p class="catalog-error">${esc(error.message)}</p><button type="button" class="btn-ghost" id="catalogDrawerRetry">重试</button></div>`;host.querySelector('.catalog-drawer-close').onclick=()=>closeCatalogDrawer();host.querySelector('#catalogDrawerRetry').onclick=()=>openProductDetail(id,page,tab);}
}
window.openProductDetail=openProductDetail;
function drawerBasic(p) {
  const date=value=>value?new Date(value).toLocaleString('zh-CN'):'未填写';
  const fields=[['产品分类',p.category],['型号 / 规格',p.model],['计价单位',p.unit],['状态',p.status||'在用'],['英文名称',p.nameEn],['创建时间',date(p.createdAt)],['最后更新',date(p.updatedAt)],['创建人',p.ownerName],['供货周期',p.leadTime],['别名',(p.aliases||[]).join('、')],['备注',p.notes]];
  return `<dl class="catalog-drawer-info">${fields.map(([label,value])=>`<dt>${label}</dt><dd>${esc(value||'待补充')}</dd>`).join('')}</dl>${p.description?`<section class="catalog-drawer-section"><h4>产品描述</h4><p class="catalog-pre">${esc(p.description)}</p>${p.descriptionEn?`<p class="catalog-pre muted">${esc(p.descriptionEn)}</p>`:''}</section>`:''}<section class="catalog-drawer-section"><h4>应用行业</h4>${p.industries?.length?`<div class="catalog-tags">${p.industries.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'<p class="muted">行业资料待补充，可在编辑产品时录入</p>'}</section>`;
}
function drawerParameters(p) {
  const rows=catalogParameters(p);
  return `<h4>技术参数</h4>${rows.length?`<dl class="catalog-parameter-list">${rows.map(line=>{const pos=line.search(/[:：]/);return pos>0?`<dt>${esc(line.slice(0,pos))}</dt><dd>${esc(line.slice(pos+1)||'待填写')}</dd>`:`<dt>参数</dt><dd>${esc(line)}</dd>`;}).join('')}</dl>`:'<div class="catalog-drawer-empty">技术参数待补充<br><small>可在编辑中填写参数或插入参数模板</small></div>'}<section class="catalog-drawer-section"><h4>原始型号 / 规格</h4><p class="catalog-pre">${esc(p.model||'规格待补充')}</p></section>`;
}
function drawerFiles(p) {
  const files=p.attachments||[];
  return `<h4>图片与资料文件 <small>${files.length} 份</small></h4>${files.length?files.map(file=>`<a class="catalog-drawer-file" href="${esc(file.url)}" target="_blank" rel="noopener">${catalogIcon(file.type==='image'?'categories':'download')}<span><b>${esc(file.name)}</b><small>${file.type==='image'?'产品图片':file.type==='video'?'产品视频':'资料文件'}${file.size?' · '+(file.size/1024).toFixed(1)+' KB':''}</small></span><span>↗</span></a>`).join(''):'<div class="catalog-drawer-empty">暂无产品图片或资料文件<br><small>在编辑产品中上传图片、视频、图纸或说明书</small></div>'}`;
}
function drawerHistory(data) {
  return `<h4>历史价格分组</h4><p class="muted">按资料类别、币种、单位、规格和条款分组。</p>${data.prices.length?data.prices.map(g=>`<div class="catalog-price"><b>${catalogPriceAmount(g)}</b><small>${esc(g.kind||'资料类别未识别')} · ${g.count} 条 · ${esc(g.tradeTerms||'条款未填写')}</small><small>${g.latest?'最近已知日期 '+esc(g.latest.date)+' · 单价 '+catalogNumber(g.latest.price):'日期未识别'}</small>${g.model?`<small class="catalog-clamp" title="${esc(g.model)}">${esc(g.model)}</small>`:''}</div>`).join(''):'<p class="muted">暂无可见的历史价格</p>'}<section class="catalog-drawer-section"><h4>历史报价明细 <small>${data.history.total} 条</small></h4>${data.history.items.length?data.history.items.map(r=>`<article class="catalog-drawer-history"><b>${catalogNumber(r.unitPrice)} ${esc(r.currency||'币种未识别')} / ${esc(r.unit||'单位未识别')}</b><small>${esc(r.clientName||'客户未识别')} · ${esc(r.date||'日期未识别')}</small><small>${esc(r.quoteNo||'单号未识别')} · 数量 ${catalogNumber(r.qty)} · ${esc(r.kind)}</small><p class="catalog-clamp" title="${esc(r.model)}">${esc(r.model||r.name)}</p><button type="button" class="sales-link" data-history-source="${esc(r.id)}">查看来源</button></article>`).join(''):'<p class="muted">暂无可见历史明细</p>'}<div class="pagination catalog-drawer-pagination" id="catalogDrawerPager"></div></section>`;
}
function drawerClients(data) {
  return `<h4>关联的历史资料客户</h4><p class="muted">按当前账号可见的历史记录统计。</p>${data.relatedClients?.length?data.relatedClients.map(c=>`<article class="catalog-drawer-client"><b>${esc(c.name)}</b><small>${esc(c.country||'国家未识别')} · ${c.count} 条关联记录</small><small>${c.latestDate?'最近已知日期 '+esc(c.latestDate):'日期未识别'}</small></article>`).join(''):'<div class="catalog-drawer-empty">暂无可见关联客户</div>'}`;
}
function renderCatalogDrawer() {
  const host=document.getElementById('catalogDrawer'),data=catalogDrawerState.data;if(!host||!data||!catalogDrawerState.id)return;const p=data.product,images=(p.attachments||[]).filter(f=>f.type==='image'),index=Math.min(catalogDrawerState.image,Math.max(0,images.length-1)),image=images[index];
  const tabs=[['basic','基本信息'],['parameters','技术参数'],['files','资料文件'],['history','历史报价'],['clients','关联客户']];
  host.innerHTML=`<div class="catalog-drawer-scroll"><div class="catalog-drawer-gallery"><button type="button" class="catalog-drawer-close" aria-label="关闭产品详情">×</button><div class="catalog-drawer-hero ${image?'has-image':''}">${image?`<img data-catalog-image src="${esc(image.url)}" alt="${esc(p.name)}">`:''}<span class="catalog-placeholder">${catalogIcon()}<small>产品图片待上传</small></span></div>${images.length>1?`<div class="catalog-gallery-thumbs">${images.map((f,i)=>`<button type="button" data-gallery-index="${i}" class="${i===index?'active':''}" aria-label="查看第${i+1}张产品图片"><img src="${esc(f.url)}" alt="${esc(f.name)}"></button>`).join('')}</div>`:''}</div><div class="catalog-drawer-heading catalog-detail-head"><h3>${esc(p.name)}</h3><p>${esc(p.code||'编码待补充')}</p>${p.tags?.length?`<div class="catalog-tags">${p.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div>`:''}<p class="catalog-clamp">${esc(p.description||'产品描述待补充')}</p></div><nav class="catalog-drawer-tabs" aria-label="产品详情页签">${tabs.map(([tab,label])=>`<button type="button" data-drawer-tab="${tab}" class="${tab===catalogDrawerState.tab?'active':''}">${label}</button>`).join('')}</nav><div class="catalog-drawer-body">${catalogDrawerState.tab==='parameters'?drawerParameters(p):catalogDrawerState.tab==='files'?drawerFiles(p):catalogDrawerState.tab==='history'?drawerHistory(data):catalogDrawerState.tab==='clients'?drawerClients(data):drawerBasic(p)}</div></div><div class="catalog-drawer-footer"><button type="button" class="btn-primary" id="catalogDrawerEdit" ${p.mergedInto?'disabled':''}>编辑资料</button><button type="button" class="btn-ghost" id="catalogDrawerQuote" ${p.status==='停用'||p.mergedInto?'disabled':''}>用于报价</button></div>`;
  host.querySelector('.catalog-drawer-close').onclick=()=>closeCatalogDrawer();host.querySelectorAll('[data-drawer-tab]').forEach(b=>b.onclick=()=>{catalogDrawerState.tab=b.dataset.drawerTab;renderCatalogDrawer();});host.querySelectorAll('[data-gallery-index]').forEach(b=>b.onclick=()=>{catalogDrawerState.image=Number(b.dataset.galleryIndex);renderCatalogDrawer();});host.querySelector('#catalogDrawerEdit').onclick=()=>openProductModal(p.id);host.querySelector('#catalogDrawerQuote').onclick=()=>quoteFromProduct(p);bindCatalogImages(host);
  if(catalogDrawerState.tab==='history'){bindHistoryActions(host,data.history.items);catalogPager(host.querySelector('#catalogDrawerPager'),data.history,n=>openProductDetail(p.id,n,'history'));}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&catalogDrawerState.id&&!document.querySelector('.modal.open'))closeCatalogDrawer();});
document.addEventListener('ftw:session-change',()=>{closeCatalogDrawer(false);catalogState.request++;catalogState.data=null;catalogState.selected.clear();products=[];document.querySelector('#productBody')?.replaceChildren();document.querySelector('#catalogCards')?.replaceChildren();});
