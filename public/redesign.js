// Design interactions reuse the authenticated CRM's records and existing editors.
(() => {
  const input = document.getElementById('globalSearch');
  const headerSearch = input.closest('.tb-search');
  const trigger = document.createElement('button');
  trigger.id = 'flowSearchOpen';
  trigger.type = 'button';
  trigger.className = 'tb-search flow-search-open';
  trigger.setAttribute('aria-label', '搜索客户、询盘、订单和报价');
  trigger.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span>搜索客户 / 询盘 / 订单…</span><kbd>⌘ K</kbd>';
  const palette = document.createElement('dialog');
  palette.className = 'flow-search-dialog';
  palette.setAttribute('aria-label', '全局搜索');
  palette.innerHTML = '<div class="flow-search-head"><button type="button" aria-label="关闭搜索">Esc</button></div><div class="flow-search-results" role="listbox" aria-label="搜索结果"></div><footer>↑ ↓ 选择 · Enter 打开 · Esc 关闭</footer>';
  palette.querySelector('.flow-search-head').prepend(input);
  headerSearch.replaceWith(trigger);
  document.body.append(palette);
  const results = palette.querySelector('.flow-search-results');
  input.setAttribute('aria-label', '搜索客户、询盘、订单和报价');
  let choices = [], selected = 0;
  function closeSearch() { palette.close(); trigger.focus(); }
  function paintSearch() {
    const query = input.value.trim().toLocaleLowerCase();
    choices = [
      {kind:'新建', label:'登记询盘', run:()=>window.openInqModal?.()},
      {kind:'新建', label:'新增客户', run:()=>openClientModal()},
      {kind:'新建', label:'新建报价', run:()=>openQuoteModal()},
      {kind:'新建', label:'新建任务', run:()=>window.openTaskModal?.()},
      ...clients.map(client=>({kind:'客户', label:client.company||'未命名客户', keywords:[client.contactName,client.country,client.contactEmail],run:()=>viewClientDetail(client.id)})),
      ...(window.getAllInquiries?.()||[]).map(inquiry=>({kind:'询盘',label:[inquiry.clientName,inquiry.product].filter(Boolean).join(' · '),keywords:[inquiry.country,inquiry.contactName],run:()=>window.openInqModal?.(inquiry.id)})),
      ...orders.map(order=>({kind:'订单',label:[order.orderNo,order.clientName].filter(Boolean).join(' · '),run:()=>openOrderDetail(order.id)})),
      ...(window.getAllQuotations?.()||[]).map(quote=>({kind:'报价',label:[quote.quoteNo,quote.clientName].filter(Boolean).join(' · '),run:()=>openQuoteModal(quote.id)}))
    ].filter(choice=>!query||[choice.label,...(choice.keywords||[])].join(' ').toLocaleLowerCase().includes(query)).slice(0,16);
    selected = Math.min(selected, Math.max(0,choices.length-1));
    results.innerHTML = choices.length ? choices.map((choice,index)=>`<button type="button" role="option" aria-selected="${index===selected}" data-search-index="${index}"><small>${esc(choice.kind)}</small><span>${esc(choice.label)}</span></button>`).join('') : '<div class="empty">没有找到匹配记录</div>';
    results.querySelectorAll('[data-search-index]').forEach(button=>button.onclick=()=>activate(Number(button.dataset.searchIndex)));
  }
  function activate(index) {
    const choice = choices[index];
    if (!choice) return;
    closeSearch();
    choice.run();
  }
  window.openFlowSearch = () => {
    if (!currentUser || document.querySelector('#modal.open')) return;
    input.value = ''; selected = 0; paintSearch();
    if (!palette.open) palette.showModal();
    input.focus();
  };
  trigger.onclick = window.openFlowSearch;
  palette.querySelector('button').onclick = closeSearch;
  palette.addEventListener('click',event=>{if(event.target===palette)closeSearch();});
  input.addEventListener('input',()=>{selected=0;paintSearch();});
  input.addEventListener('keydown',event=>{
    if (!['Enter','ArrowDown','ArrowUp'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if(event.key==='Enter')activate(selected);
    else {selected=Math.max(0,Math.min(choices.length-1,selected+(event.key==='ArrowDown'?1:-1)));paintSearch();results.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});}
  },true);
  const aiToggle = document.getElementById('flowAIToggle');
  window.toggleFlowAssistant = open => {
    const assistant = document.getElementById('flowAssistant');
    if (!assistant || (!currentUser && open !== false)) return;
    assistant.hidden = typeof open === 'boolean' ? !open : !assistant.hidden;
    aiToggle.setAttribute('aria-expanded',String(!assistant.hidden));
    if (!assistant.hidden) assistant.querySelector('#aiChatInput')?.focus();
  };
  aiToggle.onclick=()=>window.toggleFlowAssistant();
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !palette.open && !document.querySelector('#modal.open'))window.toggleFlowAssistant(false);
  });
  new MutationObserver(()=>{
    if (!document.getElementById('loginOverlay').classList.contains('hidden')) {
      if (palette.open) palette.close();
      window.toggleFlowAssistant(false);
    }
  }).observe(document.getElementById('loginOverlay'),{attributes:true,attributeFilter:['class']});
  const tabs = document.createElement('div');
  tabs.className = 'flow-todo-filters'; tabs.setAttribute('aria-label','待办类型');
  tabs.innerHTML = '<button type="button" data-todo-scope="all" aria-pressed="true">全部 <span class="db-tab-count" id="dbTodoAll">0</span></button><button type="button" data-todo-scope="follow" aria-pressed="false">询盘跟进 <span class="db-tab-count" id="dbTodoFollow">0</span></button><button type="button" data-todo-scope="task" aria-pressed="false">任务 <span class="db-tab-count" id="dbTodoTask">0</span></button>';
  document.getElementById('dashboardTodoActions').prepend(tabs);
  tabs.querySelectorAll('button').forEach(button=>button.onclick=()=>{
    dashboardTodoScope=button.dataset.todoScope;
    tabs.querySelectorAll('button').forEach(tab=>tab.setAttribute('aria-pressed',String(tab===button)));
    renderTodoList();
  });
  tabs.addEventListener('keydown',event=>{
    if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const buttons=[...tabs.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
    const next=buttons[(index+(event.key==='ArrowRight'?1:2))%3];next.focus();next.click();
  });
  renderTodoList();
})();
