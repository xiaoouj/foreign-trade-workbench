// Inquiry intake: MCP writes candidates; signed CRM users review and confirm.
(() => {
  let page=1,rows=[],pendingOpen='';
  const root=document.getElementById('sub-draft');
  const request=async(path,method='GET',body)=>{
    const response=await api(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'请求失败');return result;
  };
  const status=row=>({pending:'待确认',confirmed:'已登记',linked:'已关联',dismissed:'非询盘'}[row.status]||row.status);
  const sourceLabel=value=>({'alibaba-mc':'阿里 MC','alibaba-im':'阿里 IM','manual-test':'测试导入'}[value]||value);
  const date=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
  const e=value=>esc(String(value??''));
  function selectDraftTab(){document.querySelector('#view-enquiry [data-subtab="draft"]').click();}
  async function loadDrafts() {
    const actor=typeof currentUser!=='undefined'?currentUser?.id:null;if(!actor)return;
    const box=document.getElementById('inqDraftList');box.textContent='正在读取草稿…';
    try {
      const result=await request('/api/inquiry-drafts?status='+document.getElementById('inqDraftStatus').value+'&page='+page+'&limit=20');
      if(currentUser?.id!==actor)return;
      rows=result.items;
      box.innerHTML=rows.length?`<div class="table-wrap"><table class="sales-table inq-draft-table"><thead><tr><th>来源 / 收到日期</th><th>客户 / 产品候选</th><th>负责人</th><th>状态</th><th>缺失项</th><th>操作</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${e(sourceLabel(row.source))}${row.isTest?' <span class="inq-draft-test">测试</span>':''}<div class="muted">${e(row.receivedAt||'来源日期未知')}</div></td><td><b>${e(row.fields.clientName||'客户待核对')}</b><div>${e(row.fields.product||'需求待核对')}</div></td><td>${e(row.ownerName)}</td><td>${e(status(row))}${row.sourceUpdates?.length?'<div class="muted">来源有后续内容</div>':''}</td><td>${e(row.missingFields.map(k=>({clientName:'客户',product:'产品',receivedAt:'日期'}[k])).join('、')||'核对原文')}</td><td><button class="btn-mini" type="button" data-draft-id="${e(row.id)}">核对</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">当前没有草稿。可通过 MCP 接入保存来源信息。</div>';
      box.querySelectorAll('[data-draft-id]').forEach(button=>button.onclick=()=>openReview(button.dataset.draftId));
      document.getElementById('inqDraftPage').textContent=`共 ${result.total} 条 · 第 ${page} 页`;
      document.getElementById('inqDraftPrev').disabled=page<=1;
      document.getElementById('inqDraftNext').disabled=page*20>=result.total;
    } catch(error){box.textContent=error.message;}
  }
  async function openReview(id) {
    const actor=currentUser?.id;
    try {
      const row=await request('/api/inquiry-drafts/'+encodeURIComponent(id));
      if(currentUser?.id!==actor)return;
      const field=(key,label,type='text')=>`<div class="field"><label>${label}</label><input data-draft-field="${key}" type="${type}" ${type==='number'?'min="0" step="0.01"':''} value="${e(row.fields[key]??'')}" /></div>`;
      const clientsList=typeof clients!=='undefined'?clients:[];
      const inquiriesList=typeof getAllInquiries==='function'?getAllInquiries():[];
      const readonly=row.status!=='pending';
      openModal('询盘草稿 · '+status(row),`
        <div class="inq-draft-info">${e(row.ownerName)} · ${e(sourceLabel(row.source))} · 版本 ${row.version}${row.isTest?' · <strong>测试草稿：仅供核对，不能登记为正式询盘</strong>':''}</div>
        <details open class="inq-draft-source"><summary>来源原文</summary><pre>${e(row.rawText)}</pre>${(row.sourceUpdates||[]).map(update=>`<details><summary>后续内容 · ${e(date(update.observedAt))}</summary><pre>${e(update.rawText)}</pre></details>`).join('')}</details>
        <div class="form-grid">
          <div class="field full"><label>关联已有客户（可选）</label><select id="idraftClient"><option value="">暂不关联客户档案</option>${clientsList.map(client=>`<option value="${e(client.id)}" ${client.id===row.clientId?'selected':''}>${e(client.company)}</option>`).join('')}</select></div>
          ${field('clientName','客户名称 / 联系人')}${field('country','国家')}${field('contactName','联系人')}${field('contactEmail','邮箱')}${field('contactPhone','电话')}${field('product','产品需求')}
          <div class="field full"><label>型号 / 规格</label><textarea data-draft-field="model" rows="3">${e(row.fields.model||'')}</textarea></div>
          ${field('expectedAmount','预计总金额（未知留空）','number')}${field('currency','币种（未知留空）')}
          <div class="field"><label>收到日期（来源未知时需人工补充）</label><input id="idraftReceivedAt" type="date" value="${e(row.receivedAt)}" /></div>
          <div class="field full"><label>备注</label><textarea data-draft-field="notes" rows="2">${e(row.fields.notes||'')}</textarea></div>
        </div>
        ${readonly?`<div class="inq-draft-info">${e(row.processedByName||'')} · ${e(date(row.processedAt))}${row.inquiryId?' · 询盘 '+e(row.inquiryId):''}${row.dismissReason?' · '+e(row.dismissReason):''}</div>`:`
        <div class="inq-draft-review-actions"><button type="button" class="btn-primary" id="idraftConfirm" ${row.isTest?'disabled':''}>确认登记询盘</button><button type="button" class="btn-ghost" id="idraftSave">保存草稿</button></div>
        <details class="inq-draft-source"><summary>关联已有询盘</summary><div class="field"><select id="idraftInquiry"><option value="">请选择，客户相同不代表询盘相同</option>${inquiriesList.map(inquiry=>`<option value="${e(inquiry.id)}">${e(inquiry.clientName||inquiry.contactName)} · ${e(inquiry.product)} · ${e(inquiry.status)}</option>`).join('')}</select></div><button class="btn-ghost" type="button" id="idraftLink" ${row.isTest?'disabled':''}>核对后关联</button></details>
        <details class="inq-draft-source"><summary>标记为非询盘</summary><div class="field"><input id="idraftReason" placeholder="填写原因，例如：纯问候、旧订单跟进、测试完成" /></div><button class="btn-ghost" type="button" id="idraftDismiss">确认标记</button></details>`}
        <div class="muted" id="idraftMessage" role="status"></div>
      `,{plain:true,wide:true,noFooter:true});
      const modal=document.getElementById('modalForm');
      if(readonly){modal.querySelectorAll('input,textarea,select').forEach(input=>input.disabled=true);return;}
      const values=()=>Object.fromEntries([...modal.querySelectorAll('[data-draft-field]')].map(input=>[input.dataset.draftField,input.dataset.draftField==='expectedAmount'?(input.value.trim()===''?null:Number(input.value)):input.value.trim()]));
      const perform=async(button,action,payload)=>{
        if(button.disabled)return;button.disabled=true;const message=document.getElementById('idraftMessage');message.textContent='正在保存…';
        try {
          await request('/api/inquiry-drafts/'+row.id+(action?'/'+action:''),action?'POST':'PUT',{version:row.version,...payload});
          if(!button.isConnected)return;
          closeModal();await loadDrafts();if(typeof refreshInquiries==='function')await refreshInquiries();toast(action==='confirm'?'已登记为询盘':action==='link'?'已关联已有询盘':action==='dismiss'?'已标记为非询盘':'草稿已保存');
        }catch(error){if(message.isConnected)message.textContent=error.message;}
        finally{if(button.isConnected)button.disabled=false;}
      };
      document.getElementById('idraftClient').onchange=event=>{
        const client=clientsList.find(item=>item.id===event.target.value);if(!client)return;
        modal.querySelector('[data-draft-field="clientName"]').value=client.company;
      };
      document.getElementById('idraftConfirm').onclick=event=>perform(event.currentTarget,'confirm',{fields:values(),clientId:document.getElementById('idraftClient').value,receivedAt:document.getElementById('idraftReceivedAt').value});
      document.getElementById('idraftSave').onclick=event=>perform(event.currentTarget,'',{fields:values(),clientId:document.getElementById('idraftClient').value,receivedAt:document.getElementById('idraftReceivedAt').value});
      document.getElementById('idraftLink').onclick=event=>{
        const inquiryId=document.getElementById('idraftInquiry').value;if(!inquiryId)return toast('请选择要关联的询盘');perform(event.currentTarget,'link',{inquiryId});
      };
      document.getElementById('idraftDismiss').onclick=event=>perform(event.currentTarget,'dismiss',{reason:document.getElementById('idraftReason').value.trim()});
    }catch(error){toast(error.message);}
  }
  async function copy(value) {
    try{await navigator.clipboard.writeText(value);}catch{
      const input=document.createElement('textarea');input.value=value;document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();if(!ok)throw Error('请手动选择内容复制');
    }
    toast('已复制');
  }
  function openMcp() {
    const actor=currentUser?.id;
    openModal('WorkBuddy · MCP 接入',`
      <p>接入凭据绑定当前账号，可保存和查询本人草稿。有效期 30 天，正式登记由 CRM 核对页完成。</p>
      <p><a class="btn-ghost" href="/mcp/ftw-mcp-trial.zip" download>下载同事试用包</a> <a href="/mcp/README.txt" target="_blank" rel="noopener">查看配置与测试说明</a></p>
      <div class="field"><label>凭据名称</label><input id="imcpLabel" value="WorkBuddy" maxlength="100" /></div>
      <button class="btn-primary" type="button" id="imcpCreate">生成个人接入配置</button>
      <div id="imcpGenerated"></div><div id="imcpError" class="muted" role="status"></div>
      <h3>我的接入凭据</h3><div id="imcpTokens">正在读取…</div>
    `,{plain:true,wide:true,noFooter:true});
    const list=document.getElementById('imcpTokens'),errorBox=document.getElementById('imcpError');
    const refresh=async()=>{
      try {
        const tokens=await request('/api/inquiry-mcp-tokens');if(!list.isConnected||currentUser?.id!==actor)return;
        list.innerHTML=tokens.length?tokens.map(token=>`<div class="inq-mcp-token"><span>${e(token.label)} · 尾号 ${e(token.preview)}<br><small>${token.revokedAt?'已撤销':'到期：'+e(date(token.expiresAt))}</small></span>${token.revokedAt?'':`<button class="btn-mini" type="button" data-token-revoke="${e(token.id)}">撤销</button>`}</div>`).join(''):'<div class="muted">尚未生成凭据</div>';
        list.querySelectorAll('[data-token-revoke]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await request('/api/inquiry-mcp-tokens/'+button.dataset.tokenRevoke,'DELETE');await refresh();}catch(error){errorBox.textContent=error.message;button.disabled=false;}});
      }catch(error){if(list.isConnected)list.textContent=error.message;}
    };
    document.getElementById('imcpCreate').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;errorBox.textContent='';
      try {
        const result=await request('/api/inquiry-mcp-tokens','POST',{label:document.getElementById('imcpLabel').value});
        if(!button.isConnected||currentUser?.id!==actor)return;
        const config=JSON.stringify({mcpServers:{'ftw-inquiry-drafts':{type:'stdio',command:'node',args:['C:\\FTW-MCP\\ftw-crm-mcp.cjs'],runtime:{type:'node',version:'22'},env:{FTW_CRM_URL:location.origin,FTW_CRM_TOKEN:result.token}}}},null,2);
        document.getElementById('imcpGenerated').innerHTML=`<p>将试用包解压到 C:\\FTW-MCP，复制下面配置到 WorkBuddy 自定义 MCP。完整凭据仅本次生成时显示。</p><textarea id="imcpConfig" class="inq-mcp-config" readonly rows="12">${e(config)}</textarea><button class="btn-ghost" type="button" id="imcpCopy">复制配置</button>`;
        document.getElementById('imcpCopy').onclick=()=>copy(config).catch(error=>toast(error.message));await refresh();
      }catch(error){if(errorBox.isConnected)errorBox.textContent=error.message;}
      finally{if(button.isConnected)button.disabled=false;}
    };
    refresh();
  }
  document.getElementById('inqMcpSetup').onclick=openMcp;
  document.getElementById('inqDraftRefresh').onclick=loadDrafts;
  document.getElementById('inqDraftStatus').onchange=()=>{page=1;loadDrafts();};
  document.getElementById('inqDraftPrev').onclick=()=>{if(page>1){page--;loadDrafts();}};
  document.getElementById('inqDraftNext').onclick=()=>{page++;loadDrafts();};
  document.querySelector('#view-enquiry [data-subtab="draft"]').addEventListener('click',loadDrafts);
  const previous=window.onViewActivated;
  window.onViewActivated=function(view){if(previous)previous(view);if(view!=='enquiry')return;
    const id=new URLSearchParams(location.search).get('inquiryDraft');
    if(id&&/^d_[a-f0-9]{60}$/.test(id)&&pendingOpen!==currentUser?.id+':'+id){pendingOpen=currentUser?.id+':'+id;selectDraftTab();openReview(id);}
    else if(root.classList.contains('active'))loadDrafts();
  };
})();
