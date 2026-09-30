// ===== 通用可检索下拉（combobox）：把页面里的 <select> 增强为可输入过滤的选项框 =====
// 设计原则：保留原 <select>（隐藏）作为数据源与事件源 —— 所有既有的 change 监听、
// 表单提交、行内更新逻辑零改动；检索框选中后回写 select.value 并派发 change 事件。
// 排除：multiple / disabled / 带 data-no-combo 属性的 select 不增强。
(function () {
  const ATTR = 'ftwCombo';          // dataset key → data-ftw-combo
  let openState = null;             // 当前打开的 {wrap, inp, sel, list, items, active}
  const styleCache = new Map();     // className -> 计算样式快照（避免大表格反复 getComputedStyle）

  function styleOf(sel) {
    const key = sel.className || '';
    if (styleCache.has(key)) return styleCache.get(key);
    const cs = getComputedStyle(sel);
    const st = {
      font: cs.font,
      color: cs.color,
      bg: cs.backgroundColor,
      border: cs.border,
      radius: cs.borderRadius,
      padding: cs.padding,
      height: cs.height,
      width: cs.width,
      textAlign: cs.textAlign,
      fontWeight: cs.fontWeight,
    };
    styleCache.set(key, st);
    return st;
  }

  function closeList() {
    if (!openState) return;
    try { openState.list.remove(); } catch (e) {}
    openState = null;
  }
  document.addEventListener('scroll', e=>{if(openState&&!openState.list.contains(e.target))closeList();}, true);
  window.addEventListener('resize', closeList);
  document.addEventListener('focusin',e=>{if(openState&&!openState.wrap.contains(e.target)&&!openState.list.contains(e.target))closeList();});
  document.addEventListener('pointerdown', (e) => {
    if (openState && !openState.wrap.contains(e.target) && !openState.list.contains(e.target)) closeList();
  });

  function renderList(st) {
    const q = (st.query || '').trim().toLowerCase();
    const opts = Array.from(st.sel.options).filter((o) => !q || (o.text || '').toLowerCase().includes(q));
    st.items = opts;
    st.active = opts.length ? 0 : -1;
    const list = st.list;
    list.innerHTML = '';
    if (!opts.length) {
      const d = document.createElement('div');
      d.className = 'ftw-combo-item empty';
      d.textContent = '无匹配选项';
      list.appendChild(d);
    }
    opts.forEach((o, i) => {
      const d = document.createElement('div');
      d.className = 'ftw-combo-item' + (i === st.active ? ' active' : '') + (o.selected ? ' sel' : '');
      d.textContent = o.text;
      d.addEventListener('mousedown', (e) => e.preventDefault()); // 防止 input 先失焦
      d.addEventListener('click', () => choose(st, o));
      list.appendChild(d);
    });
    // 定位：输入框正下方（放不下则上方）
    const r = st.inp.getBoundingClientRect();
    list.style.minWidth = Math.max(r.width, 140) + 'px';
    list.style.left = r.left + 'px';
    const h = Math.min(240, list.scrollHeight || 240);
    if (r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0) list.style.top = (r.top - 6 - h) + 'px';
    else list.style.top = (r.bottom + 4) + 'px';
  }

  function choose(st, opt) {
    st.sel.value = opt.value;
    st.inp.value = opt.text;
    closeList();
    st.sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open(st, query = '') {
    st.query = query;
    closeList();
    const list = document.createElement('div');
    list.className = 'ftw-combo-list';
    list.addEventListener('mousedown',e=>e.preventDefault());
    document.body.appendChild(list);
    st.list = list;
    openState = st;
    renderList(st);
  }

  function enhance(sel) {
    if (!sel || sel.dataset[ATTR] || sel.multiple || sel.disabled || sel.hasAttribute('data-no-combo')) return;
    if (!sel.options || !sel.options.length) return;
    const st = styleOf(sel);
    const wrap = document.createElement('div');
    wrap.className = ('ftw-combo ' + (sel.className || '')).trim();
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.title = '输入可筛选选项' + (sel.title ? ' · ' + sel.title : '');
    // 拷贝原 select 的观感（含阶段胶囊配色等主题样式）
    inp.style.font = st.font;
    inp.style.color = st.color;
    inp.style.background = st.bg;
    inp.style.border = st.border;
    inp.style.borderRadius = st.radius;
    inp.style.padding = st.padding;
    inp.style.height = st.height;
    inp.style.textAlign = st.textAlign;
    inp.style.fontWeight = st.fontWeight;
  const state = { sel, inp, wrap, items: [], active: -1, list: null };
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(inp);
  sel.style.display = 'none';
  sel.dataset[ATTR] = '1';
  lastScan = Date.now();
    const sync = () => { const o = sel.selectedOptions && sel.selectedOptions[0]; inp.value = o ? o.text : ''; };
    sync();

    inp.addEventListener('focus', () => open(state));
    inp.addEventListener('click', () => open(state));
    inp.addEventListener('input', () => open(state, inp.value));
    sel.addEventListener('change', sync);
    inp.addEventListener('blur', () => setTimeout(() => { if(openState!==state)sync(); }, 140));

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (openState !== state) { open(state); return; }
        if (!state.items.length) return;
        state.active = (state.active + (e.key === 'ArrowDown' ? 1 : -1) + state.items.length) % state.items.length;
        const nodes = state.list.querySelectorAll('.ftw-combo-item:not(.empty)');
        nodes.forEach((n, i) => n.classList.toggle('active', i === state.active));
        const cur = nodes[state.active];
        if (cur) cur.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (openState === state && state.items.length) { e.preventDefault(); choose(state, state.items[Math.max(0, state.active)]); }
      } else if (e.key === 'Escape') {
        closeList(); sync(); inp.blur();
      }
    });
  }

  function scan() {
    document.querySelectorAll('select:not([data-ftw-combo])').forEach((sel) => {
      try { enhance(sel); } catch (e) { /* 单个失败不阻塞其他 */ }
    });
  }
  let timer = null;
  // 防抖 + 定时兜底：页面持续有 DOM 变动时防抖会被不断重置，定时器保证最终一定执行
  let lastScan = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 160);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    if (Date.now() - lastScan < 500) return; // 刚扫过就跳过
    const pending = document.querySelectorAll('select:not([data-ftw-combo])').length;
    if (pending) scan();
  }, 700);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  window.ftwComboScan = scan; // 供外部手动触发
})();
