// 操作日志（审计）视图 —— 仅管理员可见，入口显隐由 app.js 的 applyRoleUI 控制
const AUDIT_TABLES = {
  clients: '客户', orders: '订单', inquiries: '询盘', shipments: '出货',
  products: '产品', emails: '开发信', comms: '沟通', 'comm-templates': '话术',
  suppliers: '供应商', finance: '财务', exceptions: '异常', users: '用户', auth: '登录'
};
const AUDIT_ACTIONS = { create: '新增', update: '修改', delete: '删除', login: '登录', denied: '越权拦截' };

function auditActionBadge(a) {
  const map = { create: 'ok', update: 'warn', delete: 'danger', login: 'info', denied: 'danger' };
  return `<span class="badge ${map[a] || 'info'}">${AUDIT_ACTIONS[a] || a}</span>`;
}

function auditRenderToolbar() {
  const userOpts = ['<option value="">全部操作人</option>']
    .concat((allUsers || []).map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.username)}</option>`))
    .join('');
  const tableOpts = ['<option value="">全部模块</option>']
    .concat(Object.keys(AUDIT_TABLES).map((k) => `<option value="${k}">${AUDIT_TABLES[k]}</option>`))
    .join('');
  const actionOpts = ['<option value="">全部动作</option>']
    .concat(Object.keys(AUDIT_ACTIONS).map((k) => `<option value="${k}">${AUDIT_ACTIONS[k]}</option>`))
    .join('');
  return `
    <div class="audit-toolbar">
      <label>操作人 <select id="audUser">${userOpts}</select></label>
      <label>模块 <select id="audTable">${tableOpts}</select></label>
      <label>动作 <select id="audAction">${actionOpts}</select></label>
      <label>起 <input id="audFrom" type="date" /></label>
      <label>止 <input id="audTo" type="date" /></label>
      <button class="btn-primary" id="audQuery">查询</button>
      <button class="btn-ghost" id="audExport">导出 CSV</button>
    </div>
    <div id="audTableWrap" style="margin-top:12px;overflow:auto"></div>`;
}

async function renderAudit() {
  const sec = document.getElementById('view-audit');
  if (!sec) return;
  if (!currentUser || currentUser.role !== 'admin') {
    sec.innerHTML = '<div class="empty">仅管理员可查看操作日志</div>';
    return;
  }
  if (!allUsers.length) { try { await loadUsers(); } catch (e) {} }
  sec.innerHTML = `
    <div class="view-head"><h2>操作日志</h2><span class="muted">记录所有数据的增删改与登录，便于追溯（仅管理员可见）</span></div>
    ${auditRenderToolbar()}`;

  const buildQuery = () => {
    const p = new URLSearchParams();
    const u = document.getElementById('audUser').value;
    const t = document.getElementById('audTable').value;
    const a = document.getElementById('audAction').value;
    const f = document.getElementById('audFrom').value;
    const to = document.getElementById('audTo').value;
    if (u) p.set('user', u);
    if (t) p.set('table', t);
    if (a) p.set('action', a);
    if (f) p.set('from', new Date(f + 'T00:00:00').getTime());
    if (to) p.set('to', new Date(to + 'T23:59:59').getTime());
    p.set('limit', 2000);
    return p.toString();
  };

  const draw = async () => {
    const wrap = document.getElementById('audTableWrap');
    wrap.innerHTML = '<div class="empty">加载中…</div>';
    try {
      const r = await api('/api/audit?' + buildQuery());
      const j = await r.json();
      const items = j.items || [];
      if (!items.length) { wrap.innerHTML = '<div class="empty">暂无记录</div>'; return; }
      const rows = items.map((x) => `<tr>
        <td>${new Date(x.ts).toLocaleString('zh-CN')}</td>
        <td>${esc(x.userName || '-')}</td>
        <td>${esc(x.role || '-')}</td>
        <td>${auditActionBadge(x.action)}</td>
        <td>${AUDIT_TABLES[x.table] || x.table}</td>
        <td class="muted">${esc(x.recordId || '-')}</td>
        <td>${esc(x.summary || '-')}</td>
      </tr>`).join('');
      wrap.innerHTML = `<table class="data-table">
        <thead><tr><th>时间</th><th>操作人</th><th>角色</th><th>动作</th><th>模块</th><th>记录</th><th>摘要</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="muted" style="padding:8px 12px">共 ${j.total} 条</div>`;
    } catch (e) { wrap.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; }
  };

  document.getElementById('audQuery').onclick = draw;
  document.getElementById('audExport').onclick = async () => {
    try {
      const r = await api('/api/audit?' + buildQuery());
      const j = await r.json();
      const items = j.items || [];
      const header = ['时间', '操作人', '角色', '动作', '模块', '记录ID', '摘要'];
      const rows = items.map((x) => [
        new Date(x.ts).toLocaleString('zh-CN'), x.userName || '', x.role || '',
        AUDIT_ACTIONS[x.action] || x.action, AUDIT_TABLES[x.table] || x.table,
        x.recordId || '', (x.summary || '').replace(/[\n,]/g, ' ')
      ].map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','));
      const csv = '﻿' + [header.join(','), ...rows].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '操作日志_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      toast('已导出 ' + items.length + ' 条');
    } catch (e) { toast('导出失败：' + e.message); }
  };
  draw();
}

// 注册视图激活钩子（包装已有 handler，不覆盖 settings.js 等扩展）
window.onViewActivated = (function (orig) {
  return function (view) {
    if (typeof orig === 'function') orig(view);
    if (view === 'audit') renderAudit();
  };
})(window.onViewActivated);
