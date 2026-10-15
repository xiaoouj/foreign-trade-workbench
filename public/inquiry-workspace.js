// Inquiry workspace: clear list/board controls, explicit business links and persistent follow-up records.
let inqWorkspacePage=1,inqWorkspacePageSize=20,inqWorkspaceStage='',inqDetailId='',inqDetailTab='status',inqDetailExpanded=false;
try{const value=Number(localStorage.getItem('ftw.inqPageSize'));if([10,20,50].includes(value))inqWorkspacePageSize=value;}catch{}
const inqStageTone=status=>({'新询盘':'blue','已报价':'violet','等回复':'amber','谈判中':'orange','成交':'green','输单':'red','暂缓':'gray','无效':'gray'}[status]||'gray');
const inqStageBadge=status=>`<span class="inq-stage-badge ${inqStageTone(status)}">${esc(status||'新询盘')}</span>`;
function inqFullDate(value){if(!value)return '未记录';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{hour12:false}):String(value);}
function inqPlainText(value){if(Array.isArray(value))return value.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n');return value==null?'':String(value);}
function inqWorkspaceFilter(rows,{ignoreStage=false}={}){
  const value=id=>document.getElementById(id)?.value||'',owner=value('inqOwnerFilter'),source=value('inqSourceFilter'),follow=value('inqFollowScope'),country=value('inqCountryFilter'),from=value('inqReceivedFrom'),to=value('inqReceivedTo'),today=todayStr();
  return rows.filter(q=>{
    const status=q.status||'新询盘',received=String(q.receivedAt||'').slice(0,10);
    if(!ignoreStage&&inqWorkspaceStage&&(inqWorkspaceStage==='closed'?!['输单','暂缓','无效'].includes(status):status!==inqWorkspaceStage))return false;
    if(owner&&q.owner!==owner)return false;if(source&&q.source!==source)return false;if(country&&q.country!==country)return false;
    if(from&&(!received||received<from))return false;if(to&&(!received||received>to))return false;
    if(follow==='due'&&(!q.nextFollowAt||q.nextFollowAt>today))return false;
    if(follow==='today'&&q.nextFollowAt!==today)return false;
    if(follow==='missing'&&q.nextFollowAt)return false;
    return true;
  });
}
function inqWorkspaceRows(){
  const stamp=value=>{if(value==null||value==='')return 0;const n=typeof value==='number'||/^\d+$/.test(String(value))?Number(value):Date.parse(value);return Number.isFinite(n)&&n>0?n:0;};
  const created=q=>stamp(q.createdAt)||stamp(q.receivedAt);
  return inqSearch(inqFilteredAll(inquiries)).slice().sort((a,b)=>created(b)-created(a)||stamp(b.receivedAt)-stamp(a.receivedAt)||String(b.id).localeCompare(String(a.id)));
}
function inqPopulateFilters(){
  for(const [id,rows] of [['inqOwnerFilter',[...new Map(inquiries.filter(q=>q.owner).map(q=>[q.owner,{value:q.owner,label:q.ownerName||q.owner}])).values()]],['inqSourceFilter',[...new Set(inquiries.map(q=>q.source).filter(Boolean))].sort().map(v=>({value:v,label:v}))],['inqCountryFilter',[...new Set(inquiries.map(q=>q.country).filter(Boolean))].sort().map(v=>({value:v,label:v}))]]){
    const select=$('#'+id),selected=select.value;select.innerHTML='<option value="">全部</option>'+rows.map(v=>`<option value="${esc(v.value)}">${esc(v.label)}</option>`).join('');select.value=rows.some(v=>v.value===selected)?selected:'';
  }
}
function renderInqActiveFilters(){
  const box=$('#inqActiveFilters');if(!box)return;const labels=[];
  if(window.inqClientFilter)labels.push('客户：'+window.inqClientFilter);
  if(inqOwnerFilterQ)labels.push('负责人：'+inqOwnerFilterQ);
  if(inqWorkspaceStage)labels.push('阶段：'+(inqWorkspaceStage==='closed'?'输单 / 暂缓 / 无效':inqWorkspaceStage));
  for(const [id,label] of [['inqOwnerFilter','负责人'],['inqSourceFilter','来源'],['inqFollowScope','跟进'],['inqCountryFilter','国家'],['inqReceivedFrom','收到日期起'],['inqReceivedTo','收到日期止']]){const el=$('#'+id);if(el?.value)labels.push(label+'：'+(el.tagName==='SELECT'?el.selectedOptions[0].textContent:el.value));}
  if(inqSearchQ)labels.push('搜索：'+$('#inqSearch').value);
  box.hidden=!labels.length;box.innerHTML=labels.map(label=>`<span>${esc(label)}</span>`).join('')+(labels.length?'<button type="button" id="inqClearFilters">清除筛选 ×</button>':'');
  $('#inqClearFilters')?.addEventListener('click',inqResetWorkspaceFilters);
}
function renderInqStageSummary(){
  const summary=$('#inqStageSummary');if(!summary)return;
  const rows=inqSearch(inqWorkspaceFilter(inquiries.filter(q=>(!window.inqClientFilter||inquiryCustomerKey(q.clientName)===inquiryCustomerKey(window.inqClientFilter))&&(!inqOwnerFilterQ||(q.ownerName||q.owner||'')===inqOwnerFilterQ)),{ignoreStage:true}));
  summary.innerHTML=[['','全部','blue'],['新询盘','新询盘','blue'],['已报价','已报价','violet'],['等回复','等回复','amber'],['谈判中','谈判中','orange'],['成交','成交','green'],['closed','输单 / 暂缓','red']].map(([value,label,tone])=>{const count=rows.filter(q=>!value||(value==='closed'?['输单','暂缓','无效'].includes(q.status):(q.status||'新询盘')===value)).length;return `<button type="button" data-inq-stage="${esc(value)}" class="${inqWorkspaceStage===value?'active ':''}${tone}" aria-pressed="${inqWorkspaceStage===value}" ${value==='closed'?'title="包括输单、暂缓和无效询盘"':''}><span>${label}</span><strong>${count}</strong><i aria-hidden="true">${value==='成交'?'✓':value==='closed'?'×':value==='等回复'?'◷':'▤'}</i></button>`;}).join('');
  summary.querySelectorAll('[data-inq-stage]').forEach(button=>button.onclick=()=>{inqWorkspaceStage=button.dataset.inqStage;inqWorkspacePage=1;const active=$('#view-enquiry .subtab.active')?.dataset.subtab;if(!['list','board'].includes(active))$('#view-enquiry [data-subtab=list]').click();inqRefreshWorkspace();});
  $('#inqExceptionCount').textContent=String(exceptions.filter(q=>q.status!=='已解决').length);
}
function renderInqWorkspaceList(){
  const body=$('#inqListBody');if(!body)return;
  if(window.inqFollowFilter===true){$('#inqFollowScope').value='due';inqWorkspacePage=1;window.inqFollowFilter=false;renderInqBoard();}
  const rows=inqWorkspaceRows();inqWorkspacePage=Math.max(1,Math.min(inqWorkspacePage,Math.ceil(rows.length/inqWorkspacePageSize)||1));
  const page=rows.slice((inqWorkspacePage-1)*inqWorkspacePageSize,inqWorkspacePage*inqWorkspacePageSize);
  $('#inqResultMeta').textContent='共 '+rows.length+' 条';
  body.innerHTML=page.length?page.map(q=>{const linked=inquiryLinkedRows(q),status=q.status||'新询盘',opts=(INQ_STATUSES.includes(status)?'':`<option value="${esc(status)}" selected>${esc(status)}（历史阶段）</option>`)+INQ_STATUSES.map(s=>`<option${s===status?' selected':''}>${s}</option>`).join(''),reason=q.lastStageReason||'',latest=(q.followLog||[]).at(-1),last=latest?.at||q.lastFollowAt;return `<tr data-inquiry-row="${esc(q.id)}" class="${q.id===inqDetailId?'selected ':''}${inqSelected.has(q.id)?'sel':''}"><td><input type="checkbox" class="cb-inq" data-iid="${esc(q.id)}" aria-label="选择 ${esc(displayClientName(q))}" ${inqSelected.has(q.id)?'checked':''} /></td><td class="inq-customer-cell"><button class="inq-customer-name" type="button" data-view-i="${esc(q.id)}" title="${esc(displayClientName(q))}">${esc(displayClientName(q))}</button><p title="${esc(q.product||'未填写产品')}">${esc(q.product||'未填写产品')}</p><small>${esc(q.country||'国家未填')} · <button class="inq-owner-link" type="button" data-owner-f="${esc(q.ownerName||q.owner||'')}">${esc(q.ownerName||'未分配')}</button></small></td><td><select class="il-status inq-stage-select ${inqStageTone(status)}" data-iid="${esc(q.id)}" data-no-combo aria-label="${esc(displayClientName(q))}的阶段">${opts}</select></td><td><button type="button" class="inq-business-link" data-inq-links="${esc(q.id)}">${linked.quotes.length||linked.orders.length?`报价 ${linked.quotes.length} · 订单 ${linked.orders.length}`:'关联报价 / 订单'}</button><small class="inq-row-amount">${q.expectedAmount?Number(q.expectedAmount).toLocaleString()+' '+esc(q.currency||'USD'):'金额未填'}</small></td><td class="inq-follow-col"><span>${last?esc(fmtDateShort(last)):'尚未跟进'}</span><p class="inq-row-reason" title="${esc(latest?.content||reason)}">${esc(latest?.content||reason||'暂无跟进说明')}</p>${q.nextFollowAt?`<small class="${q.nextFollowAt<todayStr()?'overdue':''}">下次 ${esc(q.nextFollowAt)}</small>`:''}</td><td class="inq-row-actions"><button class="inq-text-action" type="button" data-inq-follow="${esc(q.id)}">跟进</button><button class="inq-text-action" type="button" data-view-i="${esc(q.id)}" aria-label="查看 ${esc(displayClientName(q))} 详情">•••</button></td></tr>`;}).join(''):'<tr><td colspan="6"><div class="inq-empty"><b>没有符合筛选条件的询盘</b><p>可清除筛选，或新增询盘。</p><button type="button" class="btn-ghost" id="inqEmptyReset">清除筛选</button></div></td></tr>';
  $('#inqEmptyReset')?.addEventListener('click',inqResetWorkspaceFilters);
  $('#inqPageSize').value=String(inqWorkspacePageSize);
  $('#inqPageMeta').textContent=rows.length?`第 ${(inqWorkspacePage-1)*inqWorkspacePageSize+1}–${Math.min(rows.length,inqWorkspacePage*inqWorkspacePageSize)} 条 / 共 ${rows.length} 条`:'共 0 条';
  const pages=Math.ceil(rows.length/inqWorkspacePageSize),pager=$('#inqPagination');pager.innerHTML=pages>1?`<button type="button" class="page-btn" data-inq-page="prev" aria-label="上一页" ${inqWorkspacePage===1?'disabled':''}>‹</button>`+Array.from({length:pages},(_,i)=>i+1).filter(p=>p===1||p===pages||Math.abs(p-inqWorkspacePage)<=1).map((p,i,a)=>`${i&&p>a[i-1]+1?'<span>…</span>':''}<button type="button" class="page-btn ${p===inqWorkspacePage?'active':''}" data-inq-page="${p}" aria-label="第 ${p} 页">${p}</button>`).join('')+`<button type="button" class="page-btn" data-inq-page="next" aria-label="下一页" ${inqWorkspacePage===pages?'disabled':''}>›</button>`:'';
  pager.querySelectorAll('[data-inq-page]').forEach(b=>b.onclick=()=>{inqWorkspacePage=b.dataset.inqPage==='prev'?inqWorkspacePage-1:b.dataset.inqPage==='next'?inqWorkspacePage+1:Number(b.dataset.inqPage);renderInqWorkspaceList();});
  renderInqBatchBar();renderInqActiveFilters();renderInqStageSummary();
  if(inqDetailId&&!rows.some(q=>q.id===inqDetailId))inqDetailId='';
  body.querySelectorAll('[data-inquiry-row]').forEach(row=>row.classList.toggle('selected',row.dataset.inquiryRow===inqDetailId));
  renderInqDetail();
}
function inqRefreshWorkspace(){renderInqBoard();renderInqList();renderInqStageSummary();}
function inqResetWorkspaceFilters(){inqWorkspaceStage='';inqSearchQ='';inqOwnerFilterQ='';window.inqClientFilter='';window.inqFollowFilter=false;for(const id of ['inqSearch','inqOwnerFilter','inqSourceFilter','inqFollowScope','inqCountryFilter','inqReceivedFrom','inqReceivedTo'])$('#'+id).value='';inqWorkspacePage=1;inqRefreshWorkspace();}
function openInqDetail(id){if(!inquiries.some(q=>q.id===id))return;inqDetailId=id;renderInqList();renderInqDetail();if(innerWidth<1100)$('#inqDetailClose')?.focus();}
function toggleInqDetailExpanded(){const scroll=$('.inq-detail-body')?.scrollTop||0;inqDetailExpanded=!inqDetailExpanded;renderInqDetail();$('.inq-detail-body').scrollTop=scroll;$('#inqDetailExpand')?.focus();}
function editInqDetail(id){openInqModal(id);if(inqDetailExpanded)document.querySelector('.modal-box')?.classList.add('modal-box--inq-expanded');}
function closeInqDetail(){const id=inqDetailId;inqDetailId='';inqDetailExpanded=false;renderInqDetail();renderInqList();$('#inqListBody [data-view-i="'+CSS.escape(id)+'"]')?.focus();}
let inqDetailHeightFrame=0;
function updateInqDetailHeight(){
  inqDetailHeightFrame=0;
  const panel=$('#inqDetailPanel'),layout=$('#inqLayout');
  if(!panel||panel.hidden||!panel.getClientRects().length)return;
  $('#inqDetailBackdrop').hidden=innerWidth>=1100||inqDetailExpanded;
  if(innerWidth<1100||inqDetailExpanded){panel.style.removeProperty('--inq-detail-height');return;}
  const stickyTop=parseFloat(getComputedStyle(panel).top)||0;
  const top=Math.max(stickyTop,layout.getBoundingClientRect().top);
  const height=Math.max(0,Math.floor(innerHeight-top-16))+'px';
  if(panel.style.getPropertyValue('--inq-detail-height')!==height)panel.style.setProperty('--inq-detail-height',height);
}
function scheduleInqDetailHeight(){if(!inqDetailHeightFrame)inqDetailHeightFrame=requestAnimationFrame(updateInqDetailHeight);}
function renderInqDetail(){
  const panel=$('#inqDetailPanel'),layout=$('#inqLayout'),q=inquiries.find(i=>i.id===inqDetailId),active=$('#view-enquiry .subtab.active')?.dataset.subtab;
  const visible=!!q&&['list','board'].includes(active);panel.hidden=!visible;layout.classList.toggle('has-detail',visible);$('#inqDetailBackdrop').hidden=!visible||innerWidth>=1100;
  if(!visible)inqDetailExpanded=false;
  const expanded=visible&&inqDetailExpanded&&$('#view-enquiry').classList.contains('active');
  layout.classList.toggle('is-expanded',expanded);panel.classList.toggle('is-expanded',expanded);document.body.classList.toggle('inq-detail-expanded',expanded);
  $('#inqDetailBackdrop').hidden=!visible||innerWidth>=1100||expanded;
  if(!visible){panel.innerHTML='';return;}
  const linked=inquiryLinkedRows(q),latest=linked.quotes.slice().sort((a,b)=>(Number(b.updatedAt)||Number(b.createdAt))-(Number(a.updatedAt)||Number(a.createdAt)))[0],log=Array.isArray(q.followLog)?q.followLog:[];
  const info=(label,value)=>`<dt>${label}</dt><dd>${esc(value||'未填写')}</dd>`;
  let content='';
  if(inqDetailTab==='status')content=inqStageHistoryHtml(q).replace('id="inqStageHistory"','id="inqDetailStageHistory"');
  else if(inqDetailTab==='overview')content=`<section class="inq-detail-section"><h3>询盘概览</h3><dl>${info('产品需求',q.product)}${info('规格 / 型号',q.model)}${info('预计金额',q.expectedAmount?Number(q.expectedAmount).toLocaleString()+' '+(q.currency||'USD'):'')}${info('联系人',q.contactName)}${info('邮箱',q.contactEmail)}${info('电话',q.contactPhone)}${info('来源',q.source)}${info('收到日期',q.receivedAt)}${info('下次跟进',q.nextFollowAt)}</dl></section><div class="inq-detail-links"><button type="button" class="btn-ghost" data-detail-action="edit">编辑询盘信息</button><button type="button" class="btn-ghost" data-detail-action="client">查看客户档案</button><button type="button" class="btn-ghost" data-detail-action="ai">AI 跟进建议</button><button type="button" class="btn-ghost" data-detail-action="whatsapp">WhatsApp 沟通</button><button type="button" class="inq-text-action danger" data-detail-action="delete">删除询盘</button></div>`;
  else if(inqDetailTab==='follow')content=`<section class="inq-detail-section"><h3>跟进记录 <small>${log.length} 条</small></h3>${log.length?`<ol class="inq-history-list">${log.slice().reverse().map(entry=>`<li><p>${esc(entry.content)}</p><small>${esc(inqFullDate(entry.at))} · ${esc(entry.by||'未记录')}</small>${entry.nextFollowAt?`<small>下次跟进：${esc(entry.nextFollowAt)}</small>`:''}</li>`).join('')}</ol>`:'<p class="muted">暂无新增跟进记录，点击“记录跟进”添加。</p>'}${q.chatLog?`<details class="inq-original-chat"><summary>原始沟通记录</summary><pre>${esc(inqPlainText(q.chatLog))}</pre></details>`:''}</section>`;
  else content=`<section class="inq-detail-section"><h3>关联业务</h3>${linked.quotes.map(quote=>`<button class="inq-business-card" type="button" data-detail-quote="${esc(quote.id)}"><b>报价 ${esc(quote.quoteNo||'未填编号')}</b><span>${esc(quote.currency||'USD')} ${qtTotal(quote.items).toLocaleString()} · V${Number(quote.version)||1}</span><small>${esc(quote.status||'草稿')} · 查看报价 →</small></button>`).join('')}${linked.orders.map(order=>`<button class="inq-business-card" type="button" data-detail-order="${esc(order.id)}"><b>订单 ${esc(order.orderNo||'未填编号')}</b><span>${esc(order.currency||'USD')} ${Number(order.amount||0).toLocaleString()}</span><small>${esc(order.status||'待确认')} · 查看订单 →</small></button>`).join('')||(!linked.quotes.length?'<p class="muted">尚未关联报价或订单。</p>':'')}<div class="inq-detail-links"><button class="btn-ghost" type="button" data-detail-action="link">关联已有业务</button><button class="btn-ghost" type="button" data-detail-action="quote">＋ 新建报价</button></div></section>`;
  panel.innerHTML=`<div class="inq-detail-head"><div><h3>${esc(displayClientName(q))}</h3>${inqStageBadge(q.status)}<p>${esc(q.country||'国家未填')} · 负责人：${esc(q.ownerName||'未分配')}</p></div><div class="inq-detail-window-actions"><button id="inqDetailExpand" class="inq-icon-action" type="button" aria-label="${inqDetailExpanded?'还原询盘详情':'放大询盘详情'}" title="${inqDetailExpanded?'还原':'放大'}" aria-pressed="${inqDetailExpanded}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${inqDetailExpanded?'<path d="M8 8h12v12H8zM4 16V4h12"/>':'<path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>'}</svg></button><button id="inqDetailClose" class="inq-icon-action" type="button" aria-label="关闭询盘详情">×</button></div></div><div class="inq-detail-actions"><button class="btn-primary" type="button" data-detail-action="follow">记录跟进</button><button class="btn-ghost" type="button" data-detail-action="stage">变更阶段</button><button class="inq-icon-action" type="button" data-detail-action="edit" aria-label="编辑询盘信息" title="编辑询盘信息">✎</button></div><div class="inq-detail-tabs" role="group" aria-label="询盘详情视图">${[['overview','概览'],['follow','跟进记录'],['status','状态记录'],['business','关联业务']].map(([key,label])=>`<button type="button" data-inq-detail-tab="${key}" class="${inqDetailTab===key?'active':''}" aria-pressed="${inqDetailTab===key}">${label}</button>`).join('')}</div><div class="inq-detail-body"><div class="inq-detail-primary">${content}</div><div class="inq-detail-support"><section class="inq-original-card"><h3>原始询盘</h3><dl>${info('来源',q.source)}${info('收到日期',q.receivedAt)}${info('产品需求',q.product)}${info('原始说明',q.notes)}</dl>${q.attachments?.length?`<div class="inq-original-files">${q.attachments.map(a=>{let safe=false;try{const u=new URL(a.url,location.origin);safe=['http:','https:'].includes(u.protocol);}catch{}return safe?`<a href="${esc(a.url)}" target="_blank" rel="noopener">附件：${esc(a.name||'查看文件')}</a>`:'';}).join('')}</div>`:''}</section>${latest?`<section class="inq-latest-quote"><h3>最新报价</h3><b>${esc(latest.quoteNo||'未填编号')}</b><span>${esc(latest.currency||'USD')} ${qtTotal(latest.items).toLocaleString()} · V${Number(latest.version)||1}</span><button class="inq-text-action" type="button" data-detail-quote="${esc(latest.id)}">查看报价 →</button></section>`:''}<p class="inq-preserve-note">联动更新阶段与报价信息，保留询盘需求和历史记录。</p></div></div>`;
  $('#inqDetailClose').onclick=closeInqDetail;$('#inqDetailExpand').onclick=toggleInqDetailExpanded;
  panel.querySelectorAll('[data-inq-detail-tab]').forEach(b=>b.onclick=()=>{inqDetailTab=b.dataset.inqDetailTab;renderInqDetail();panel.querySelector('[data-inq-detail-tab="'+inqDetailTab+'"]')?.focus();});
  panel.querySelectorAll('[data-detail-quote]').forEach(b=>b.onclick=()=>openQuoteModal(b.dataset.detailQuote));panel.querySelectorAll('[data-detail-order]').forEach(b=>b.onclick=()=>openOrderDetail(b.dataset.detailOrder));
  panel.querySelectorAll('[data-detail-action]').forEach(b=>b.onclick=async()=>{const action=b.dataset.detailAction;if(action==='edit')editInqDetail(q.id);if(action==='follow')openInqFollowModal(q.id);if(action==='stage')openInqStageModal(q.id);if(action==='link')openInquiryLinks(q.id);if(action==='quote')createQuoteFromInquiry(q);if(action==='client')window.openClientDetailByName(displayClientName(q));if(action==='ai')openAiAnalyze(q);if(action==='whatsapp')openWaForInquiry(q.id);if(action==='delete'){if(!confirm('确认删除该询盘？'))return;const response=await api('/api/inquiries/'+q.id,{method:'DELETE'});if(!response.ok)return toast('删除失败');inqDetailId='';await loadInquiries();toast('询盘已删除');}});
  scheduleInqDetailHeight();
}
function openInqStageModal(id){
  const q=inquiries.find(i=>i.id===id);if(!q)return;const before=q.status||'新询盘',actor=currentUser?.id;
  openModal('变更询盘阶段',`<p>${esc(displayClientName(q))} · 当前 ${esc(before)}</p><div class="field"><label>新阶段</label><select name="newStage" data-no-combo>${INQ_STATUSES.includes(before)?'':`<option value="${esc(before)}" selected>${esc(before)}（历史阶段）</option>`}${INQ_STATUSES.map(s=>`<option ${s===before?'selected':''}>${s}</option>`).join('')}</select></div><div class="field"><label>变更原因 *</label><textarea name="stageReason" required placeholder="说明本次阶段变更的原因"></textarea></div>`);
  let saving=false;$('#modalForm').onsubmit=async e=>{e.preventDefault();if(saving||currentUser?.id!==actor)return;const data=new FormData(e.target),status=String(data.get('newStage')),reason=String(data.get('stageReason')||'').trim();if(status===before)return toast('请选择不同阶段');if(!reason)return toast('请填写阶段变更原因');saving=true;try{const r=await api('/api/inquiries/'+id,{method:'PUT',body:JSON.stringify({status,lastStageReason:reason})}),result=await r.json();if(!r.ok)throw Error(result.error||'保存失败');if(currentUser?.id!==actor)return;closeModal();inqDetailTab='status';await loadInquiries();toast('阶段已更新，原因已保存');}catch(error){toast(error.message);}finally{saving=false;}};
}
function openInqFollowModal(id){
  const q=inquiries.find(i=>i.id===id);if(!q)return;const actor=currentUser?.id;
  openModal('记录询盘跟进',`<p>${esc(displayClientName(q))} · ${esc(q.product||'未填需求')}</p><div class="field"><label>跟进内容 *</label><textarea name="followContent" rows="5" required placeholder="记录沟通结果、客户反馈或下一步安排"></textarea></div><div class="field"><label>下次跟进日期</label><input name="followDate" type="date" value="${esc(q.nextFollowAt||'')}" /></div><p class="muted">跟进记录单独保存，原始需求和沟通内容继续保留。</p>`);
  let saving=false;$('#modalForm').onsubmit=async e=>{e.preventDefault();if(saving||currentUser?.id!==actor)return;const data=new FormData(e.target),content=String(data.get('followContent')||'').trim();if(!content)return toast('请填写跟进内容');saving=true;try{const r=await api('/api/inquiries/'+id+'/followups',{method:'POST',body:JSON.stringify({content,nextFollowAt:String(data.get('followDate')||'')})}),result=await r.json();if(!r.ok)throw Error(result.error||'保存失败');if(currentUser?.id!==actor)return;closeModal();inqDetailTab='follow';inqDetailId=id;await loadInquiries();toast('跟进记录已保存');}catch(error){toast(error.message);}finally{saving=false;}};
}
let inqDraftBadgeRequest=0;
async function inqRefreshDraftBadge(){const actor=currentUser?.id,request=++inqDraftBadgeRequest;if(!actor)return;try{const r=await api('/api/inquiry-drafts?status=pending&page=1&limit=1'),data=await r.json();if(r.ok&&currentUser?.id===actor&&request===inqDraftBadgeRequest)$('#inqDraftCount').textContent=String(data.total||0);}catch{}}
(function initInquiryWorkspace(){
  $('#inqPageSize').onchange=e=>{inqWorkspacePageSize=Number(e.target.value);inqWorkspacePage=1;try{localStorage.setItem('ftw.inqPageSize',String(inqWorkspacePageSize));}catch{}renderInqList();};
  ['inqOwnerFilter','inqSourceFilter','inqFollowScope','inqCountryFilter','inqReceivedFrom','inqReceivedTo'].forEach(id=>$('#'+id).onchange=()=>{inqWorkspacePage=1;inqRefreshWorkspace();});
  $('#inqSearch').addEventListener('input',()=>{inqWorkspacePage=1;inqRefreshWorkspace();});
  $('#inqMoreFilters').onclick=()=>{const advanced=$('#inqAdvancedFilters');advanced.hidden=!advanced.hidden;$('#inqMoreFilters').setAttribute('aria-expanded',String(!advanced.hidden));};
  $('#inqResetFilters').onclick=inqResetWorkspaceFilters;$('#inqClearSelection').onclick=()=>{inqSelected.clear();renderInqList();};
  $('#inqImport').onclick=()=>{openModal('导入询盘记录','<div class="inq-import-options"><p>选择来源，保留原文后核对询盘信息。</p><button type="button" class="btn-primary" id="inqImportPaste">粘贴邮件 / 聊天 / RFQ 原文</button><button type="button" class="btn-ghost" id="inqImportDrafts">核对已接入的来源草稿</button></div>',{plain:true,noFooter:true});$('#inqImportPaste').onclick=()=>openInqModal();$('#inqImportDrafts').onclick=()=>{closeModal();$('#view-enquiry [data-subtab=draft]').click();};};
  $('#inqDetailBackdrop').onclick=closeInqDetail;
  $('#inqListBody').addEventListener('click',e=>{const owner=e.target.closest('[data-owner-f]');if(owner){inqOwnerFilterQ=inqOwnerFilterQ===owner.dataset.ownerF?'':owner.dataset.ownerF;inqWorkspacePage=1;inqRefreshWorkspace();}});
  window.addEventListener('ftw:inqViewChanged',event=>{const pipeline=['list','board'].includes(event.detail);$('#inqFilterControls').hidden=!pipeline;renderInqDetail();});
  window.addEventListener('ftw:inquiriesChanged',()=>{inqPopulateFilters();renderInqList();inqRefreshDraftBadge();});
  window.addEventListener('ftw:dataReady',()=>{inqPopulateFilters();renderInqList();inqRefreshDraftBadge();});
  window.addEventListener('resize',scheduleInqDetailHeight);
  document.addEventListener('scroll',scheduleInqDetailHeight,{capture:true,passive:true});
  const detailSizeObserver=new ResizeObserver(scheduleInqDetailHeight);
  detailSizeObserver.observe($('#inqLayout'));
  detailSizeObserver.observe($('#view-enquiry .inq-page-head'));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&inqDetailId&&!$('#modal').classList.contains('open')){event.preventDefault();if(inqDetailExpanded)toggleInqDetailExpanded();else closeInqDetail();}});
  const previousViewActivated=window.onViewActivated;
  window.onViewActivated=function(view){
    if(view!=='enquiry'){inqDetailId='';inqDetailExpanded=false;renderInqDetail();}
    else renderInqDetail();
    if(typeof previousViewActivated==='function')return previousViewActivated(view);
  };
  renderInqStageSummary();
})();
