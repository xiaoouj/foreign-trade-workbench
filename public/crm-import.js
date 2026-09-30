/* 文件型 CRM 批量导入：接入已存在的 /api/crm-imports 工作流 */
(function () {
  'use strict';
  const q = (s, r = document) => r.querySelector(s);
  const escx = (v) => (window.esc ? window.esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const apiX = (path, opts) => {
    if (typeof window.api !== 'function') throw new Error('工作台请求接口尚未加载，请刷新页面后重试');
    return window.api(path, opts || {});
  };
  let importBusy = false;

  function addStyle() {
    if (q('#crmImportStyle')) return;
    const st = document.createElement('style'); st.id = 'crmImportStyle';
    st.textContent = `
      .crm-imp-mask{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px}
      .crm-imp-box{background:var(--panel,#fff);color:var(--ink,#20242b);width:min(1080px,96vw);max-height:90vh;overflow:auto;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.24);padding:20px}
      .crm-imp-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.crm-imp-head h3{margin:0;font-size:18px}.crm-imp-close{border:0;background:transparent;font-size:24px;cursor:pointer;color:var(--muted,#777)}
      .crm-imp-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}.crm-imp-kpi{padding:12px;border:1px solid var(--line,#e5e7eb);border-radius:9px;background:var(--bg-2,#f8fafc)}.crm-imp-kpi b{display:block;font-size:20px}.crm-imp-kpi span{font-size:12px;color:var(--muted,#6b7280)}
      .crm-imp-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0}.crm-imp-table{width:100%;border-collapse:collapse;font-size:12px}.crm-imp-table th,.crm-imp-table td{border-bottom:1px solid var(--line,#e5e7eb);padding:8px 6px;text-align:left;vertical-align:top}.crm-imp-table th{position:sticky;top:0;background:var(--panel,#fff);z-index:1}.crm-imp-table select{font-size:12px;padding:4px;border:1px solid var(--line,#d1d5db);border-radius:5px}.crm-imp-muted{color:var(--muted,#6b7280);font-size:12px}.crm-imp-danger{color:#b91c1c}.crm-imp-ok{color:#15803d}.crm-imp-btn{border:0;border-radius:7px;padding:8px 12px;cursor:pointer;background:var(--brand,#2563eb);color:#fff}.crm-imp-btn.secondary{background:var(--bg-2,#f1f5f9);color:var(--ink,#20242b);border:1px solid var(--line,#d1d5db)}
      @media(max-width:700px){.crm-imp-summary{grid-template-columns:repeat(2,1fr)}.crm-imp-box{padding:14px}.crm-imp-table{min-width:760px}.crm-imp-scroll{overflow:auto}}
    `; document.head.appendChild(st);
  }

  function openImport() {
    if (q('#crmImportMask')) return;
    addStyle();
    const mask = document.createElement('div'); mask.id = 'crmImportMask'; mask.className = 'crm-imp-mask';
    mask.innerHTML = `<div class="crm-imp-box"><div class="crm-imp-head"><h3>📥 AI 批量导入客户 CRM</h3><button class="crm-imp-close" title="关闭">×</button></div>
      <div class="crm-imp-muted">上传客户表、询盘表或聊天记录。系统会先识别、去重并生成预览，只有点击“确认写入”后才会修改 CRM。</div>
      <div class="crm-imp-toolbar"><input id="crmImportFile" type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.csv" /><button class="crm-imp-btn" id="crmImportStart">上传并 AI 识别</button><span class="crm-imp-muted" id="crmImportStatus">支持同时选择多个 PDF / DOCX / XLSX / TXT / CSV，单文件 ≤ 20 MB</span></div>
      <div id="crmImportResult"></div></div>`;
    document.body.appendChild(mask);
    q('.crm-imp-close', mask).onclick = () => mask.remove();
    mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
    q('#crmImportStart', mask).onclick = () => runImport(mask);
  }

  async function readData(file) { return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); }); }
  function setStatus(mask, text, bad) { const el = q('#crmImportStatus', mask); if (el) { el.textContent = text; el.className = bad ? 'crm-imp-muted crm-imp-danger' : 'crm-imp-muted'; } }

  async function runImport(mask) {
    if (importBusy) return;
    const files = Array.from(q('#crmImportFile', mask).files || []);
    if (!files.length) { setStatus(mask, '请先选择文件', true); return; }
    const tooLarge = files.find(file => file.size > 20 * 1024 * 1024);
    if (tooLarge) { setStatus(mask, '文件不能超过 20 MB：' + tooLarge.name, true); return; }
    importBusy = true; q('#crmImportStart', mask).disabled = true;
    try {
      const jobs = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatus(mask, `正在上传第 ${i + 1}/${files.length} 个文件：${file.name}…`);
        const created = await apiX('/api/crm-imports', { method:'POST', body: JSON.stringify({ filename:file.name, data:await readData(file) }) });
        const job = await created.json(); if (!created.ok) throw new Error(file.name + '：' + (job.error || '上传失败'));
        jobs.push(job);
      }
      const analyzed = [];
      for (let i = 0; i < jobs.length; i++) {
        setStatus(mask, `AI 正在识别第 ${i + 1}/${jobs.length} 个文件…`);
        const r = await apiX('/api/crm-imports/' + encodeURIComponent(jobs[i].id) + '/analyze', { method:'POST', timeout:300000 });
        const result = await r.json(); if (!r.ok) throw new Error(jobs[i].originalName + '：' + (result.error || 'AI 识别失败'));
        analyzed.push(result);
      }
      renderReview(mask, analyzed);
      setStatus(mask, '识别完成，请检查多个文件合并后的结果，再确认写入。');
    } catch (e) { setStatus(mask, '失败：' + (e.message || e), true); }
    finally { importBusy = false; q('#crmImportStart', mask).disabled = false; }
  }

  function mergeJobs(jobs) {
    const merged = { ...jobs[0], id: jobs.map(j => j.id).join(','), originalName: jobs.map(j => j.originalName).join('、'), analysis: { clients: [], contacts: [], inquiries: [], comms: [] } };
    const seen = new Set();
    for (const job of jobs) {
      const a = job.analysis || {};
      for (const key of ['clients', 'contacts', 'inquiries', 'comms']) {
        for (const row of (a[key] || [])) {
          const d = row.data || row;
          const sig = key + '|' + String(d.company || '') + '|' + String(d.contactEmail || d.email || d.product || d.content || d.name || '').toLowerCase();
          if (!seen.has(sig)) {
            seen.add(sig);
            merged.analysis[key].push({ ...row, rowId: job.id + '__' + (row.rowId || key + '_' + merged.analysis[key].length), _sourceId: job.id });
          }
        }
      }
    }
    return merged;
  }

  function renderReview(mask, jobOrJobs) {
    const job = Array.isArray(jobOrJobs) ? mergeJobs(jobOrJobs) : jobOrJobs;
    const rows = (job.analysis && job.analysis.clients) || [];
    const counts = { total:rows.length, create:rows.filter(x=>x.decision==='create').length, update:rows.filter(x=>x.decision==='update').length, skip:rows.filter(x=>x.decision==='skip').length };
    const result = q('#crmImportResult', mask);
    result.innerHTML = `<div class="crm-imp-summary"><div class="crm-imp-kpi"><b>${counts.total}</b><span>识别客户</span></div><div class="crm-imp-kpi"><b class="crm-imp-ok">${counts.create}</b><span>建议新增</span></div><div class="crm-imp-kpi"><b>${counts.update}</b><span>可更新</span></div><div class="crm-imp-kpi"><b class="crm-imp-danger">${counts.skip}</b><span>疑似重复/跳过</span></div></div>
      <div class="crm-imp-toolbar"><button class="crm-imp-btn secondary" id="crmImpAllCreate">全部设为新增</button><button class="crm-imp-btn secondary" id="crmImpAllSkip">全部跳过</button><span class="crm-imp-muted">默认建议由 AI 与公司名/邮箱匹配结果生成，可逐行调整。</span></div>
      <div class="crm-imp-scroll"><table class="crm-imp-table"><thead><tr><th>公司</th><th>国家</th><th>联系人</th><th>邮箱</th><th>匹配结果</th><th>处理方式</th></tr></thead><tbody>${rows.map((r,i)=>{const d=r.data||{}; const dup=r.duplicateOf; return `<tr><td><b>${escx(d.company||'')}</b><div class="crm-imp-muted">${escx(d.website||'')}</div></td><td>${escx(d.country||'')}</td><td>${escx(d.contactName||'')}</td><td>${escx(d.contactEmail||'')}</td><td>${dup?`<span class="crm-imp-danger">匹配：${escx(dup.company||dup.id)}</span>`:'<span class="crm-imp-ok">未发现重复</span>'}</td><td><select data-imp-row="${escx(r.rowId)}"><option value="create" ${r.decision==='create'?'selected':''}>新增</option><option value="update" ${r.decision==='update'?'selected':''}>更新</option><option value="skip" ${r.decision==='skip'?'selected':''}>跳过</option></select></td></tr>`}).join('')}</tbody></table></div>
      <div class="crm-imp-toolbar"><button class="crm-imp-btn" id="crmImpCommit">确认写入 CRM</button><span class="crm-imp-muted">同时处理：${(job.analysis.contacts||[]).length} 个联系人、${(job.analysis.inquiries||[]).length} 条询盘、${(job.analysis.comms||[]).length} 条沟通记录。</span></div>`;
    q('#crmImpAllCreate', mask).onclick = () => mask.querySelectorAll('[data-imp-row]').forEach(s=>s.value='create');
    q('#crmImpAllSkip', mask).onclick = () => mask.querySelectorAll('[data-imp-row]').forEach(s=>s.value='skip');
    q('#crmImpCommit', mask).onclick = async () => {
      const btn=q('#crmImpCommit',mask); btn.disabled=true; btn.textContent='写入中…';
      const decisions={}; mask.querySelectorAll('[data-imp-row]').forEach(s=>decisions[s.dataset.impRow]=s.value);
      try {
        const sourceIds = [...new Set(rows.map(r => r._sourceId).filter(Boolean))];
        const commitIds = sourceIds.length ? sourceIds : [job.id];
        const outcomes = [];
        for (let i = 0; i < commitIds.length; i++) {
          const sourceId = commitIds[i];
          const sourceDecisions = {};
          rows.filter(r => !r._sourceId || r._sourceId === sourceId).forEach(r => { sourceDecisions[String(r.rowId).split('__').slice(1).join('__') || r.rowId] = decisions[r.rowId]; });
          const r=await apiX('/api/crm-imports/'+encodeURIComponent(sourceId)+'/commit',{method:'POST',body:JSON.stringify({decisions:sourceDecisions})});
          const j=await r.json(); if(!r.ok) throw new Error(j.error||'写入失败'); outcomes.push(j.result||{});
        }
        const x = outcomes.reduce((a, o) => { for (const k of ['created','updated','skipped','contacts','inquiries','comms']) a[k] = (a[k] || 0) + (o[k] || 0); return a; }, {});
        result.innerHTML=`<div class="crm-imp-summary"><div class="crm-imp-kpi"><b class="crm-imp-ok">完成</b><span>导入任务</span></div><div class="crm-imp-kpi"><b>${x.created||0}</b><span>新增客户</span></div><div class="crm-imp-kpi"><b>${x.updated||0}</b><span>更新客户</span></div><div class="crm-imp-kpi"><b>${x.skipped||0}</b><span>跳过</span></div></div><p class="crm-imp-ok">✅ 已写入 CRM。联系人 ${x.contacts||0} 个，询盘 ${x.inquiries||0} 条，沟通记录 ${x.comms||0} 条。</p><button class="crm-imp-btn" id="crmImpCloseDone">关闭并刷新</button>`;
        q('#crmImpCloseDone',mask).onclick=()=>{mask.remove(); if(window.loadAll) window.loadAll().catch(()=>{}); window.dispatchEvent(new Event('ftw:dataReady'));};
      } catch(e){btn.disabled=false;btn.textContent='重试写入';setStatus(mask,'写入失败：'+(e.message||e),true);}
    };
  }

  function installButton() {
    const input = q('#aiChatInput'); if (!input || q('#crmImportBtn')) return;
    addStyle(); const btn=document.createElement('button'); btn.id='crmImportBtn'; btn.type='button'; btn.className='ai-attach'; btn.title='批量导入客户 CRM（AI识别、去重、预览后写入）'; btn.textContent='📥'; btn.style.marginLeft='4px';
    btn.onclick=openImport; const attach=q('#aiChatAttach'); if(attach&&attach.parentNode) attach.parentNode.insertBefore(btn,attach.nextSibling); else input.parentNode.insertBefore(btn,input);
  }
  function boot(){ installButton(); const obs=new MutationObserver(installButton); obs.observe(document.body,{childList:true,subtree:true}); setTimeout(()=>obs.disconnect(),30000); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
