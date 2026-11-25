// Shared percentage editors and the order detail page. Business records stay in existing APIs.
function salesPercentControl(name,label,value) {
  const selected=value==null||value===''?'':String(value);
  const presets=['0','20','30','50','70','100'];
  return `<label class="sales-percent">${esc(label)}<div><select data-no-combo data-percent-preset="${name}" aria-label="${esc(label)}预设"><option value="">未设置</option>${presets.map(v=>`<option value="${v}" ${selected===v?'selected':''}>${v}%</option>`).join('')}<option value="custom" ${selected&&!presets.includes(selected)?'selected':''}>自定义</option></select><input name="${name}" type="number" min="0" max="100" step="0.01" value="${esc(selected)}" placeholder="0–100" aria-label="${esc(label)}" /><span>%</span></div></label>`;
}
function bindSalesPercentControls(host){
  host.querySelectorAll('[data-percent-preset]').forEach(select=>{
    const input=host.querySelector(`[name="${select.dataset.percentPreset}"]`);
    select.onchange=()=>{if(select.value!=='custom'){input.value=select.value;input.dispatchEvent(new Event('input',{bubbles:true}));}else input.focus();};
    input.addEventListener('input',()=>{select.value=[...select.options].some(o=>o.value===input.value)?input.value:'custom';});
  });
}
function salesPercentValues(host,names){return Object.fromEntries(names.map(name=>{const raw=host.querySelector(`[name="${name}"]`).value;return [name,raw===''?null:Number(raw)];}));}
function salesOrderFields(o){return `<section class="field full sales-payment-editor"><h3>生产与付款</h3><div class="sales-percent-grid">${salesPercentControl('productionProgress','生产进度',o.productionProgress)}${salesPercentControl('depositPercent','约定预付款比例',o.depositPercent)}${salesPercentControl('paidPercent','实际已付款比例',o.paidPercent)}</div><p class="muted">约定预付款用于付款计划；实际已付款比例单独登记，已收款和待收余额按此计算。进入生产中即计入订单全额成交金额。</p></section>`;}
const salesMoney=(value,currency)=>`${esc(currency||'USD')} ${Number(value||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
let salesOrderTab='overview';
function salesOrderId(){return new URLSearchParams(location.hash.split('?')[1]||'').get('id')||window.salesSelectedOrder||'';}
function salesPaymentSummary(o){
  const amount=Number(o.amount)||0,dep=o.depositPercent,payment=FTWOrderWorkflow.payment(o);
  const note=payment.source==='historical'?'历史已收款 / 已完成状态未登记付款比例，沿用原全额收款口径；可登记实际比例更正。':payment.source==='awaiting'?'当前待确认或待收预付款，未登记付款时按未收款计算。':!payment.known?'实际收款尚未登记，收款与余额待核对；约定预付款比例不作为实际收款。':'';
  return `<div class="sales-payment-cards"><div><span>合同金额</span><strong>${salesMoney(amount,o.currency)}</strong></div><div><span>约定预付款 ${dep==null?'':dep+'%'}</span><strong>${dep==null?'未设置':salesMoney(amount*dep/100,o.currency)}</strong></div><div><span>已收款 ${payment.paidPercent==null?'':payment.paidPercent+'%'}</span><strong>${payment.known?salesMoney(payment.received,o.currency):'待核对'}</strong></div><div><span>待收余额</span><strong>${payment.known?salesMoney(payment.outstanding,o.currency):'待核对'}</strong></div></div>${note?`<p class="muted">${esc(note)}</p>`:''}`;
}
function renderSalesOrder(){
  const host=$('#view-order-detail');if(!host)return;
  const o=orders.find(x=>String(x.id)===String(salesOrderId()));
  if(!o){host.innerHTML='<div class="sales-empty">订单不存在或尚未加载。<button class="btn-ghost" onclick="switchView(\'orders\')">返回订单列表</button></div>';return;}
  const client=orderLinkedClient(o),progress=o.productionProgress,deposit=o.depositPercent,paid=o.paidPercent;
  const stage=FTWOrderWorkflow.stage(o),cancelled=FTWOrderWorkflow.isCancelled(o);
  const cursor=['待确认','待收预付款','生产中','待收尾款','待发货','已发货','已完成'].indexOf(stage);
  const stages=[['订单确认',cursor>0,cancelled?'已取消':stage==='待确认'?'待确认':'已确认'],['收预付款',cursor>1,deposit==null?'比例未约定':`约定 ${deposit}%`],['生产',cursor>2,progress==null?'进度未登记':`${progress}%`],['收尾款',cursor>3,paid==null?'实际付款未登记':`实际已付 ${paid}%`],['发货',cursor>4,stage==='待发货'?'待发货':cursor>4?'已发货':'未发货'],['完成',cursor>5,stage==='已完成'?'已完成':'待完成']];
  const next=cancelled?-1:stages.findIndex(s=>!s[1]);
  const shipmentList=typeof shipments!=='undefined'?shipments.filter(s=>s.orderId===o.id||(o.orderNo&&s.orderNo===o.orderNo)):[];
  const shipmentHtml=shipmentList.length?shipmentList.map(s=>`<div class="sales-shipment"><strong>${esc(s.shipmentNo||'出货记录')}</strong><span>${esc(s.status||'待发货')} · ${esc(s.carrier||'承运人未填')}</span><span>目的地：${esc(s.destination||'未填')} · 预计到达：${esc(s.eta||'未填')}</span></div>`).join(''):'<p class="muted">尚未关联出货记录</p>';
  host.innerHTML=`<div class="sales-page-heading"><div><button class="sales-back" id="salesOrderBack">← 返回订单列表</button><h2>订单详情与交付</h2><p>生产进度与付款计划集中管理</p></div><button class="btn-primary" id="salesOrderEdit">编辑订单</button></div>
    <section class="sales-order-hero"><div class="sales-order-title"><div><h2>${esc(o.orderNo||'未填写单号')} <span class="status-tag">${esc(o.status||'待确认')}</span></h2><p><button class="sales-link" id="salesOrderClient">${esc(o.clientName||'未关联客户')}</button> · ${esc(client?.contactEmail||'邮箱未填')} · 下单日期 ${esc(o.orderDate||'未填')}</p></div><div class="sales-order-total"><span>订单金额</span><strong>${salesMoney(o.amount,o.currency)}</strong><button class="btn-primary" data-order-doc="pi">生成 PI</button></div></div>
    ${o.status==='已取消'?'<p class="sales-warning">此订单已取消。下方保留已登记的生产与付款信息。</p>':''}
    <ol class="sales-milestones">${stages.map(([label,done,sub],i)=>`<li class="${!cancelled&&done?'done':i===next?'current':''}"><span>${!cancelled&&done?'✓':i+1}</span><b>${label}</b><small>${esc(sub)}</small></li>`).join('')}</ol>
    <div class="sales-tabs" role="group" aria-label="订单详情内容">${[['overview','订单概览'],['items','产品明细'],['payment','收付款'],['shipments','出货记录'],['documents','相关单证']].map(([tab,label])=>`<button data-sales-order-tab="${tab}" class="${salesOrderTab===tab?'active':''}" aria-pressed="${salesOrderTab===tab}">${label}</button>`).join('')}</div></section>
    <div class="sales-order-grid">
      <section class="sales-card sales-production" ${!['overview','items'].includes(salesOrderTab)?'hidden':''}><div class="sales-card-head"><h3>生产进度</h3><button class="sales-link" id="salesProgressEdit">调整进度</button></div><div class="sales-progress-label"><span>订单整体生产进度</span><strong>${progress==null?'未登记':progress+'%'}</strong></div><div class="sales-progress"><i style="width:${Number(progress)||0}%"></i></div>${orderItemsDetail(o)}</section>
      <section class="sales-card" ${!['overview','shipments'].includes(salesOrderTab)?'hidden':''}><h3>交付信息</h3><dl class="sales-info"><dt>计划交期</dt><dd>${esc(o.deliveryDate||'未填写')}</dd><dt>国家 / 地区</dt><dd>${esc(o.country||client?.country||'未填写')}</dd><dt>负责人</dt><dd>${esc(o.ownerName||'未分配')}</dd></dl>${shipmentHtml}<button class="sales-link" id="salesShipmentAdd">＋ 登记出货</button></section>
      <section class="sales-card" ${!['overview','documents'].includes(salesOrderTab)?'hidden':''}><h3>相关单证</h3>${[['pi','形式发票（PI）'],['ci','商业发票（CI）'],['packing','装箱单（PL）']].map(([type,label])=>`<div class="sales-doc-row"><span>${label}</span><button class="btn-ghost" data-order-doc="${type}">生成 / 预览</button></div>`).join('')}<p class="muted">带入本订单资料，在单证页核对后导出。</p></section>
      <section class="sales-card sales-payment" ${!['overview','payment'].includes(salesOrderTab)?'hidden':''}><div class="sales-card-head"><h3>收付款情况</h3><button class="sales-link" id="salesPaymentEdit">设置付款比例</button></div>${salesPaymentSummary(o)}<p class="muted">${esc(o.paymentTerms||'付款条款未填写')} · 金额按订单总额和手动登记比例计算</p></section>
      <section class="sales-card sales-notes" ${salesOrderTab!=='overview'?'hidden':''}><h3>订单备注</h3><p>${esc(o.notes||'暂无备注')}</p></section>
    </div>`;
  $('#salesOrderBack').onclick=()=>switchView('orders');$('#salesOrderEdit').onclick=()=>openOrderModal(o.id);
  $('#salesOrderClient').onclick=()=>client?viewClientDetail(client.id):registerOrderClient(o.id);
  host.querySelectorAll('[data-sales-order-tab]').forEach(b=>b.onclick=()=>{salesOrderTab=b.dataset.salesOrderTab;renderSalesOrder();});
  $('#salesProgressEdit').onclick=()=>openSalesProgress(o,'production');$('#salesPaymentEdit').onclick=()=>openSalesProgress(o,'payment');
  $('#salesShipmentAdd').onclick=()=>openShipmentModal(null,{orderNo:o.orderNo,clientName:o.clientName});
  host.querySelectorAll('[data-order-doc]').forEach(b=>b.onclick=()=>loadOrderSalesDoc(o,b.dataset.orderDoc));
}
function openSalesProgress(o,mode){
  const names=mode==='production'?['productionProgress']:['depositPercent','paidPercent'];
  openModal(mode==='production'?'调整生产进度':'预付款与实收比例',`${names.map(name=>salesPercentControl(name,{productionProgress:'生产进度',depositPercent:'约定预付款比例',paidPercent:'实际已付款比例'}[name],o[name])).join('')}<p class="field full muted">${mode==='production'?'按实际生产情况手动填写 0–100%。':'约定定金与实际已付款分别登记。未收到款项时，请勿将定金比例填为已付款比例。'}</p>`);
  const form=$('#modalForm');bindSalesPercentControls(form);let saving=false;
  form.onsubmit=async event=>{event.preventDefault();if(saving)return;saving=true;try{
    const r=await api('/api/orders/'+encodeURIComponent(o.id),{method:'PUT',body:JSON.stringify(salesPercentValues(form,names))});
    if(!r.ok){const data=await r.json().catch(()=>({}));throw new Error(data.error||'保存失败');}
    Object.assign(o,await r.json());closeModal();renderSalesOrder();renderOrders();renderFinance();renderPerformance();renderDashKpis();toast('已保存');
  }catch(error){toast(error.message);}finally{saving=false;}};
}
function loadOrderSalesDoc(o,type){
  switchView('docs');
  loadQuoteIntoDoc({...o,quoteNo:o.orderNo,items:normalizedOrderItems(o),paymentTerms:o.paymentTerms||(o.depositPercent==null?'':`${o.depositPercent}% deposit, ${100-o.depositPercent}% balance`)});
  document.querySelector(`.doc-type[data-doctype="${type}"]`)?.click();
  $('#d_payment').value=o.paymentTerms||(o.depositPercent==null?'':`${o.depositPercent}% deposit, ${100-o.depositPercent}% balance`);$('#d_notes').value=o.notes||'';$('#d_docNo').value=o.orderNo||'';$('#d_delivery').value=o.deliveryDate||'';renderPreview();
}
window.addEventListener('ftw:dataReady',()=>{if($('#view-order-detail')?.classList.contains('active'))renderSalesOrder();});
