let inqSelected = new Set();
// ====== 询盘管理模块 ======
// 子页签：看板 / 清单 / 统计分析 / 异常登记
// 分类只用「状态 status」一个维度（看板/漏斗/统计统一），不再设独立分级

// 销售漏斗核心阶段（按 status 归并；暂缓/无效不计入漏斗）
const INQ_PIPELINE = [
  { code: '新询盘', label: '新询盘' },
  { code: '已报价', label: '已报价' },
  { code: '等回复', label: '等回复' },
  { code: '谈判中', label: '谈判中' },
  { code: '成交', label: '成交' },
  { code: '输单', label: '输单' },
];
window.INQ_PIPELINE = INQ_PIPELINE;
// 客户名兜底显示：空值/纯空白时用联系人名，否则再退到"未命名客户"
function displayClientName(inq) {
  if (!inq) return '—';
  const cn = String(inq.clientName || '').trim();
  if (cn) return cn;
  const ct = String(inq.contactName || '').trim();
  return ct || '未命名客户';
}
window.displayClientName = displayClientName;
let INQ_SOURCES = ["阿里巴巴", "官网", "展会", "Google", "LinkedIn", "客户介绍", "其他"];
const INQ_STATUSES = ['新询盘', '已报价', '等回复', '谈判中', '成交', '输单', '暂缓', '无效'];
const EXC_TYPES = ['客户失联', '报价超期', '质量投诉', '交期延误', '价格异议', '物流问题', '其他'];
const EXC_STATUSES = ['待处理', '处理中', '已解决'];

let inquiries = [];
let exceptions = [];
let inqSearchQ = '';
// 客户/责任人过滤（v20260902d）：客户列表在途询盘徽标点击 → window.inqClientFilter；
// 清单责任人单元格点击 → inqOwnerFilterQ。过滤条可一键清除。
if (typeof window.inqClientFilter === 'undefined') window.inqClientFilter = '';
let inqOwnerFilterQ = '';

// 应用客户/责任人过滤（看板与清单共用；搜索框过滤仍走 inqSearch）
function inqFilteredAll(list) {
  let out = list;
  const cf = String(window.inqClientFilter || '').trim().toLowerCase();
  if (cf) out = out.filter((q) => String(q.clientName || '').trim().toLowerCase() === cf);
  if (inqOwnerFilterQ) out = out.filter((q) => String(q.ownerName || q.owner || '') === inqOwnerFilterQ);
  return out;
}

// 过滤条：显示当前生效的客户/责任人过滤，可一键清除
function renderInqFilterBar() {
  const view = document.getElementById('view-enquiry');
  if (!view) return;
  let bar = document.getElementById('inqFilterBar');
  const cf = String(window.inqClientFilter || '').trim();
  const of = inqOwnerFilterQ;
  if (!cf && !of) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'inqFilterBar';
    bar.className = 'inq-filter-bar';
    const tabs = view.querySelector('.subtabs');
    if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(bar, tabs.nextSibling);
    else view.insertBefore(bar, view.firstChild);
  }
  bar.innerHTML = (cf ? '<span class="ifb-chip">🔎 客户：' + esc(cf) + '</span>' : '')
    + (of ? '<span class="ifb-chip">👤 跟进人：' + esc(of) + '</span>' : '')
    + '<button type="button" class="ifb-clear" id="inqFilterClear">清除过滤 ×</button>';
  const clearBtn = bar.querySelector('#inqFilterClear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    window.inqClientFilter = ''; inqOwnerFilterQ = '';
    renderInqBoard(); renderInqList();
  });
}

// 子页签切换（限定在询盘视图内，避免误触任务/沟通等其他模块的同名页签）
$$('#view-enquiry .subtab').forEach((b) => b.addEventListener('click', () => {
  $$('#view-enquiry .subtab').forEach((x) => x.classList.remove('active'));
  $$('#view-enquiry .subview').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  $('#sub-' + b.dataset.subtab).classList.add('active');
  // 切到统计/异常/清单时强制刷新（清单行内数据需保持最新，v20260902d）
  if (b.dataset.subtab === 'stats') renderInqStats();
  if (b.dataset.subtab === 'exception') renderExceptions();
  if (b.dataset.subtab === 'list') renderInqList();
}));

// 搜索
$('#inqSearch').addEventListener('input', (e) => {
  inqSearchQ = e.target.value.trim().toLowerCase();
  renderInqBoard();
  renderInqList();
});

// 从服务端加载可配置的询盘来源（设置页可编辑）
async function loadInqSources() {
  try {
    const r = await api('/api/settings');
    if (r.ok) {
      const s = await r.json();
      if (s.inquirySources && s.inquirySources.length) INQ_SOURCES = s.inquirySources;
    }
  } catch { /* 服务端不可用时保留默认值 */ }
}

// 看板 / 列表加载
async function loadInquiries() {
  const [a, b] = await Promise.all([
    api('/api/inquiries').then((r) => r.json()),
    api('/api/exceptions').then((r) => r.json()),
  ]);
  inquiries = a || []; exceptions = b || [];
  await loadInqSources(); // 每次打开询盘页都刷新来源列表
  renderInqBoard(); renderInqList(); renderInqStats();
  // 通知业绩等依赖询盘状态的模块实时刷新（漏斗/金额）
  window.dispatchEvent(new Event('ftw:inquiriesChanged'));
}

// -------- 询盘看板（按状态分列，拖拽改状态） --------
function renderInqBoard() {
  const wrap = $('#inqBoard');
  renderInqFilterBar();
  const filtered = inqSearch(inqFilteredAll(inquiries));
  const cols = INQ_STATUSES.map((st) => {
    const items = filtered.filter((q) => (q.status || '新询盘') === st)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return `
      <div class="kanban-col" data-status="${st}">
        <div class="kanban-col-head">
          <span class="lh" style="font-weight:600;color:var(--ink-soft)">${st}</span>
          <span class="count">${items.length}</span>
        </div>
        <div class="kanban-cards" data-status="${st}">
        ${items.length === 0 ? '<div class="empty" style="padding:14px">—</div>' : items.map(cardHtml).join('')}
        </div>
      </div>`;
  }).join('');
  // 兜底：任何不在标准阶段列表里的状态（如历史「寄样中」记录）单独成列，避免数据在看板消失
  const known = new Set(INQ_STATUSES);
  const orphanStats = [...new Set(filtered.map((q) => q.status || '新询盘').filter((s) => !known.has(s)))];
  const orphanCols = orphanStats.map((st) => {
    const items = filtered.filter((q) => (q.status || '新询盘') === st)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return `
      <div class="kanban-col kanban-col--orphan" data-status="${esc(st)}">
        <div class="kanban-col-head">
          <span class="lh" style="font-weight:600;color:var(--ink-soft)">${esc(st)}</span>
          <span class="count">${items.length}</span>
        </div>
        <div class="kanban-cards" data-status="${esc(st)}">
        ${items.length === 0 ? '<div class="empty" style="padding:14px">—</div>' : items.map(cardHtml).join('')}
        </div>
      </div>`;
  }).join('');
  wrap.innerHTML = cols + orphanCols;
  wrap.querySelectorAll('.kc').forEach((el) => {
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.style.opacity = '0.5';
    });
    el.addEventListener('dragend', () => { el.style.opacity = ''; });
    el.addEventListener('click', (e) => {
      const link = e.target.closest('.link-name');
      if (link) { e.preventDefault(); window.openClientDetailByName(link.dataset.detailName); return; }
      openInqModal(el.dataset.id);
    });
  });
  wrap.querySelectorAll('.kanban-cards').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.closest('.kanban-col').classList.add('drag-over'); });
    col.addEventListener('dragleave', () => { col.closest('.kanban-col').classList.remove('drag-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.closest('.kanban-col').classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      if (!id || !newStatus) return;
      const item = inquiries.find((q) => q.id === id);
      const oldStatus = item ? (item.status || '新询盘') : '';
      if (oldStatus === newStatus) return;
      // 状态变更统一走 changeInqStatus（必填原因 / stageLog / wonAt 口径一致）
      await changeInqStatus(id, newStatus);
    });
  });
}

// ===== 询盘状态变更（看板拖拽 / 清单行内下拉共用，v20260902d）=====
// 决策点C：强制填写变更原因，与看板同一套 stageLog / wonAt 口径
async function changeInqStatus(id, newStatus, opts = {}) {
  const item = inquiries.find((x) => x.id === id);
  const oldStatus = item ? (item.status || '新询盘') : '';
  if (!item || oldStatus === newStatus) return true;
  const reason = (window.prompt(`将「${displayClientName(item)}」从「${oldStatus}」移至「${newStatus}」，请填写阶段变更原因：`) || '').trim();
  if (!reason) { toast('已取消：未填写变更原因'); if (opts.resetEl) opts.resetEl(oldStatus); return false; }
  try {
    const now = Date.now();
    const body = { status: newStatus, updatedAt: now, lastStageReason: reason };
    body.stageLog = (item.stageLog || []).concat([{
      from: oldStatus, to: newStatus, reason, at: now,
      by: (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.name || currentUser.username) : '系统',
    }]);
    if (newStatus === '成交') body.wonAt = now;
    const r = await api('/api/inquiries/' + id, { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || '状态更新失败'); if (opts.resetEl) opts.resetEl(oldStatus); return false; }
    toast(`已移至「${newStatus}」`);
    loadInquiries(); // 内部会派发 ftw:inquiriesChanged → 客户列表/仪表盘联动刷新
    return true;
  } catch (err) { toast('保存失败'); if (opts.resetEl) opts.resetEl(oldStatus); return false; }
}

// 清单行内：修改下次跟进日期（本地即时更新 + 仪表盘联动，不打扰看板）
async function updateInqFollowInline(id, val, el) {
  const item = inquiries.find((x) => x.id === id);
  if (!item) return;
  if ((item.nextFollowAt || '') === (val || '')) return;
  const prev = item.nextFollowAt || '';
  try {
    const r = await api('/api/inquiries/' + id, { method: 'PUT', body: JSON.stringify({ nextFollowAt: val || '', updatedAt: Date.now() }) });
    if (!r.ok) { toast('更新失败'); if (el) el.value = prev; return; }
    item.nextFollowAt = val || '';
    toast('已更新下次跟进');
    window.dispatchEvent(new Event('ftw:inquiriesChanged'));
  } catch { toast('保存失败'); if (el) el.value = prev; }
}

function cardHtml(q) {
  const amt = q.expectedAmount ? `${Number(q.expectedAmount).toLocaleString()} ${esc(q.currency || 'USD')}` : '';
  const next = q.nextFollowAt ? fmtDateShort(q.nextFollowAt) : '';
  return `<div class="kc" data-id="${q.id}">
    <div class="kco"><a class="link-name" data-detail-name="${esc(displayClientName(q))}" title="查看客户详情">${esc(displayClientName(q))}</a></div>
    <div class="kmeta">${esc(q.country || '')} · ${esc(q.product || '—')}</div>
    <div class="kfoot">
      <span class="kamt">${amt}</span>
      <span class="kflag">${esc(q.status || '新询盘')}</span>
      ${next ? `<span class="kflag">📅 ${next}</span>` : ''}
    </div>
  </div>`;
}

function inqSearch(list) {
  if (!inqSearchQ) return list;
  return list.filter((q) =>
    [q.clientName, q.country, q.product, q.contactName, q.source].some((v) => (v || '').toLowerCase().includes(inqSearchQ)));
}

function fmtDateShort(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(+d)) return s;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === -1) return '昨日';
  if (diff > 0 && diff <= 7) return diff + ' 天后';
  if (diff < 0 && diff >= -7) return -diff + ' 天前';
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

// 列表筛选由顶部搜索框驱动（分级筛选条已移除，分类统一用 status）

function renderInqList() {
  const body = $('#inqListBody');
  renderInqFilterBar();
  let list = inqSearch(inqFilteredAll(inquiries));
  // 仪表盘「待跟进询盘」跳转过来的筛选
  const isFollowFilter = window.inqFollowFilter;
  if (isFollowFilter) {
    const today = new Date().toISOString().slice(0, 10);
    list = list.filter((q) => {
      if (!q.nextFollowAt || q.nextFollowAt > today) return false;
      return canSeeBusiness(q.owner);
    });
    window.inqFollowFilter = false;
  }
  list.sort((a,b)=>newestRecords(a,b,'receivedAt'));
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="10" class="empty">' + (isFollowFilter ? '暂无待跟进询盘，干得好！' : '暂无询盘，点击右上角新增') + '</td></tr>';
    renderInqBatchBar();
    return;
  }
  // 行内交互（v20260902d）：状态行内下拉（强制填原因）/ 下次跟进行内日期 / 责任人点击过滤
  // 事件统一由 #inqListBody 上的委托处理器分发（见文件尾部 initInqListDelegation）
  body.innerHTML = list.map((q) => {
    const st = q.status || '新询盘';
    const statusOpts = INQ_STATUSES.map((s) => '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>').join('');
    return '<tr class="' + (inqSelected.has(q.id) ? 'sel' : '') + '">'
    + '<td><input type="checkbox" class="cb-inq" data-iid="' + q.id + '" ' + (inqSelected.has(q.id) ? 'checked' : '') + ' /></td>'
    + '<td><a class="link-name" data-detail-name="' + esc(displayClientName(q)) + '">' + esc(displayClientName(q)) + '</a></td>'
    + '<td>' + esc(q.country || '-') + '</td>'
    + '<td>' + esc(q.product || '-') + '</td>'
    + '<td>' + esc(q.source || '-') + '</td>'
    + '<td><select class="il-status" data-iid="' + q.id + '" data-no-combo title="点击变更状态（需填写原因）">' + statusOpts + '</select></td>'
    + '<td>' + (q.expectedAmount ? Number(q.expectedAmount).toLocaleString() + ' ' + esc(q.currency || 'USD') : '—') + '</td>'
    + '<td><input type="date" class="il-follow" data-iid="' + q.id + '" value="' + esc(q.nextFollowAt || '') + '" title="点击修改下次跟进日期" /></td>'
    + '<td class="il-owner" data-owner-f="' + esc(q.ownerName || q.owner || '') + '" title="点击按该跟进人过滤">' + esc(q.ownerName || q.owner || '-') + '</td>'
    + '<td>'
    + '<button class="link-btn" data-edit-i="' + q.id + '">编辑</button>'
    + '<button class="link-btn" data-qt-from-i="' + q.id + '">📋 报价</button>'
    + '<button class="link-btn ai" data-ai-i="' + q.id + '">🤖 建议</button>'
    + '<button class="link-btn danger" data-del-i="' + q.id + '">删除</button></td>'
    + '</tr>';
  }).join('');
  renderInqBatchBar();
}

// -------- WhatsApp 发起（号码优先取关联客户档案，其次询盘自带电话）--------
// 询盘不单独存号码：同一客户可能有多条询盘，号码只应有客户档案一个来源
function inqWaRecord(q) {
  if (!q) return null;
  const name = String(displayClientName(q) || '').trim();
  const cli = (typeof clients !== 'undefined' && Array.isArray(clients))
    ? clients.find((c) => String(c.company || '').trim() === name && name) : null;
  if (cli && window.waHasNumber && window.waHasNumber(cli)) return { rec: cli, client: cli };
  // 客户档案没号码 → 拿询盘里的电话兜底（可能只是座机，弹窗里能改）
  return { rec: { waDial: '', waPhone: '', contactPhone: q.contactPhone || '', country: q.country || '' }, client: cli || null };
}

function openWaForInquiry(id) {
  const q = inquiries.find((x) => x.id === id);
  if (!q) return toast('询盘不存在');
  const { rec, client } = inqWaRecord(q);
  const ctx = {
    record: rec,
    clientId: client ? client.id : null,
    isClient: !!client, // 有客户档案才允许把号码回存
    company: displayClientName(q),
    contactName: q.contactName || (client ? client.contactName : '') || '',
    country: q.country || (client ? client.country : '') || '',
    product: q.product || '',
  };
  // 一键直达；无号码时 waQuick 自己回落到完整弹窗
  if (window.waQuick) return window.waQuick(ctx);
  if (window.openWaModal) return window.openWaModal(ctx);
  toast('WhatsApp 模块未加载');
}
window.openWaForInquiry = openWaForInquiry;

// -------- 询盘弹窗 --------
// 2026-09-11 减负改造：「粘贴即填」成为新增询盘的默认路径。
//   旧路径：手填 19 个字段。
//   新路径：粘贴原文 → AI 解析 → 只核 3 项（客户 / 产品 / 金额）→ 保存。
//   其余 16 个字段自动填好并折进「其他信息」；仍旧可以点「手动填写」走老路径。
$('#inqAdd').addEventListener('click', () => openInqModal());

// 邮箱域名 TLD → 国家。AI 没识别出国家时的兜底，省去在 200+ 下拉里翻找。
// 按 TLD 长度降序匹配，避免 .co 抢在 .co.uk 前面。
const EMAIL_TLD_COUNTRY = [
  ['.co.uk', '英国'], ['.org.uk', '英国'], ['.com.au', '澳大利亚'], ['.com.br', '巴西'], ['.com.mx', '墨西哥'],
  ['.co.za', '南非'], ['.co.nz', '新西兰'], ['.co.kr', '韩国'], ['.com.tr', '土耳其'], ['.co.in', '印度'],
  ['.com.sg', '新加坡'], ['.com.my', '马来西亚'], ['.com.vn', '越南'], ['.co.th', '泰国'], ['.com.ph', '菲律宾'],
  ['.com.cn', '中国'], ['.com.hk', '中国香港'], ['.com.tw', '中国台湾'], ['.com.ar', '阿根廷'], ['.com.pe', '秘鲁'],
  ['.de', '德国'], ['.fr', '法国'], ['.it', '意大利'], ['.es', '西班牙'], ['.nl', '荷兰'], ['.be', '比利时'],
  ['.pl', '波兰'], ['.pt', '葡萄牙'], ['.se', '瑞典'], ['.no', '挪威'], ['.dk', '丹麦'], ['.fi', '芬兰'],
  ['.ch', '瑞士'], ['.at', '奥地利'], ['.cz', '捷克'], ['.gr', '希腊'], ['.ro', '罗马尼亚'], ['.hu', '匈牙利'],
  ['.ru', '俄罗斯'], ['.ua', '乌克兰'], ['.tr', '土耳其'], ['.il', '以色列'], ['.ae', '阿联酋'], ['.sa', '沙特阿拉伯'],
  ['.eg', '埃及'], ['.ma', '摩洛哥'], ['.dz', '阿尔及利亚'], ['.tn', '突尼斯'], ['.ng', '尼日利亚'], ['.ke', '肯尼亚'],
  ['.gh', '加纳'], ['.tz', '坦桑尼亚'], ['.et', '埃塞俄比亚'], ['.za', '南非'], ['.br', '巴西'], ['.mx', '墨西哥'],
  ['.ar', '阿根廷'], ['.cl', '智利'], ['.co', '哥伦比亚'], ['.pe', '秘鲁'], ['.au', '澳大利亚'], ['.nz', '新西兰'],
  ['.in', '印度'], ['.pk', '巴基斯坦'], ['.bd', '孟加拉国'], ['.lk', '斯里兰卡'], ['.th', '泰国'], ['.vn', '越南'],
  ['.id', '印度尼西亚'], ['.my', '马来西亚'], ['.sg', '新加坡'], ['.ph', '菲律宾'], ['.kr', '韩国'], ['.jp', '日本'],
  ['.cn', '中国'], ['.hk', '中国香港'], ['.tw', '中国台湾'], ['.ca', '加拿大'], ['.us', '美国'], ['.uk', '英国'],
  ['.ie', '爱尔兰'], ['.by', '白俄罗斯'], ['.kz', '哈萨克斯坦'], ['.uz', '乌兹别克斯坦'], ['.ir', '伊朗'], ['.iq', '伊拉克'],
  ['.jo', '约旦'], ['.kw', '科威特'], ['.qa', '卡塔尔'], ['.om', '阿曼'], ['.bh', '巴林'], ['.lb', '黎巴嫩'],
  ['.sn', '塞内加尔'], ['.ci', '科特迪瓦'], ['.cm', '喀麦隆'], ['.ao', '安哥拉'], ['.zm', '赞比亚'], ['.zw', '津巴布韦'],
  ['.mz', '莫桑比克'], ['.mg', '马达加斯加'], ['.mu', '毛里求斯'], ['.na', '纳米比亚'], ['.bw', '博茨瓦纳'], ['.ug', '乌干达'],
  ['.rw', '卢旺达'], ['.sd', '苏丹'], ['.ly', '利比亚'],
];
const TLD_SORTED = EMAIL_TLD_COUNTRY.slice().sort((a, b) => b[0].length - a[0].length);

function guessCountryFromEmail(email) {
  const s = String(email || '').toLowerCase();
  const m = s.match(/@([a-z0-9.-]+)/);
  const domain = m ? m[1].replace(/[>);,.\s]+$/, '') : '';
  if (!domain) return '';
  for (const pair of TLD_SORTED) { if (domain.endsWith(pair[0])) return pair[1]; }
  return '';
}

function openInqModal(arg) {
  // 支持传入 id 字符串（编辑）、预填对象（AI 转人工）、或不传（新增）
  let q, editId = '';
  if (typeof arg === 'string') { q = inquiries.find((x) => x.id === arg); editId = arg; }
  else if (arg && typeof arg === 'object') { q = arg; editId = q.id || ''; }
  if (!q) q = { status: '新询盘', receivedAt: todayStr(), currency: 'USD' };
  const isEdit = !!editId;

  const srcOpts = ['<option value="">—</option>', ...INQ_SOURCES.map((s) => `<option ${s === q.source ? 'selected' : ''}>${s}</option>`)].join('');
  const stOpts = INQ_STATUSES.map((s) => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('');
  const curOpts = CURRENCIES.map((c) => `<option ${c === (q.currency || 'USD') ? 'selected' : ''}>${c}</option>`).join('');
  const countryOpts = window.countryOptionsHtml
    ? window.countryOptionsHtml(q.country)
    : '<option value="">— 未填 —</option>';
  // 跟进人（责任人）：默认当前登录用户；可在下拉里改派给其他业务员
  const users = window.assignableUsers();
  const ownerDef = q.owner || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
  const ownerSel = ['<option value="">— 默认本人 —</option>',
    ...users.map((u) => `<option value="${u.id}" ${u.id === ownerDef ? 'selected' : ''}>${esc(u.name || u.username)}</option>`)].join('');
  const clientDatalist = (typeof clients !== 'undefined' ? clients : [])
    .map((c) => `<option value="${esc(c.company)}"></option>`).join('');

  // 新增模式：粘贴区在最上面（默认唯一的「必看」区域）
  const pasteHtml = isEdit ? '' : `
    <div class="inq-paste" id="inqPaste">
      <div class="inq-paste-head">粘贴即填 · 把阿里 RFQ / 客户邮件 / 聊天记录整段贴进来</div>
      <textarea id="inqPasteBox" rows="6" placeholder="在此 Ctrl+V 粘贴，自动开始解析；没有原文就点右边的「手动填写」"></textarea>
      <div class="ai-actions">
        <button type="button" class="btn-primary" id="inqParseBtn">⚙ 解析并填表</button>
        <button type="button" class="btn-ghost" id="inqManualBtn">✎ 手动填写</button>
        <span id="inqParseStatus" class="muted"></span>
      </div>
    </div>`;

  openModal(isEdit ? '编辑询盘' : '新增询盘', `
    ${pasteHtml}
    <div id="inqCore" class="inq-core${isEdit ? '' : ' hidden'}">
      <div class="inq-core-head">${isEdit ? '关键信息' : '核对这 3 项就能保存，其余已自动填好'}</div>
      <div class="form-grid">
        <div class="field full"><label>客户公司 <b class="inq-req">*</b></label>
          <input name="clientName" list="inqClientList" autocomplete="off" value="${esc(q.clientName || '')}" placeholder="输入公司名，或从已有客户里选" />
          <datalist id="inqClientList">${clientDatalist}</datalist>
        </div>
        <div id="inqClientPreview" class="field full client-preview hidden"></div>
        <div class="field"><label>产品 <b class="inq-req">*</b></label><input name="product" value="${esc(q.product || '')}" placeholder="如 链板输送机" /></div>
        <div class="field"><label>预计金额</label><input name="expectedAmount" value="${esc(q.expectedAmount || '')}" type="number" step="0.01" /></div>
        <div class="field"><label>币种</label><select name="currency">${curOpts}</select></div>
      </div>
    </div>
    <details id="inqMore" class="inq-more"${isEdit ? ' open' : ''}>
      <summary>其他信息<span id="inqMoreHint">（手动填写时在此补充）</span></summary>
      <div class="form-grid">
        <div class="field"><label>国家</label><select name="country">${countryOpts}</select></div>
        <div class="field"><label>联系人</label><input name="contactName" value="${esc(q.contactName || '')}" /></div>
        <div class="field"><label>邮箱</label><input name="contactEmail" value="${esc(q.contactEmail || '')}" type="email" /></div>
        <div class="field"><label>电话</label><input name="contactPhone" value="${esc(q.contactPhone || '')}" /></div>
        <div class="field"><label>来源</label><select name="source">${srcOpts}</select></div>
        <div class="field"><label>收到询盘日期</label><input name="receivedAt" type="date" value="${esc(q.receivedAt || '')}" /></div>
        <div class="field"><label>型号</label><input name="model" value="${esc(q.model || '')}" /></div>
        <div class="field"><label>状态</label><select name="status">${stOpts}</select></div>
        <div class="field"><label>跟进人（责任人）</label><select name="owner">${ownerSel}</select></div>
        <div class="field"><label>是否已寄样</label>
          <select name="sampleSent">
            <option value="否" ${q.sampleSent !== '是' ? 'selected' : ''}>否</option>
            <option value="是" ${q.sampleSent === '是' ? 'selected' : ''}>是</option>
          </select>
        </div>
        <div class="field"><label>上次跟进</label><input name="lastFollowAt" type="date" value="${esc(q.lastFollowAt || '')}" /></div>
        <div class="field"><label>下次跟进</label><input name="nextFollowAt" type="date" value="${esc(q.nextFollowAt || '')}" /></div>
      </div>
      <div class="field full"><label>沟通记录（邮件/聊天记录，供 AI 分析）</label><textarea name="chatLog" rows="3" placeholder="粘贴与该客户的邮件、WhatsApp、微信等沟通内容，AI 建议功能会据此分析">${esc(q.chatLog || '')}</textarea></div>
      <div class="field full"><label>备注</label><textarea name="notes">${esc(q.notes || '')}</textarea></div>
      <div class="field full"><label>附件（图片 / 文档 / 视频）</label>
        <div id="inqAttachList" style="margin-bottom:8px">${(q.attachments || []).map((a, i) => `<span class="attach-tag" data-i="${i}">📎 <a href="${esc(a.url)}" target="_blank">${esc(a.name || '文件')}</a> <button class="attach-del" data-i="${i}">&times;</button></span>`).join(' ')}</div>
        <input type="file" id="inqFiles" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.mp4,.webm,.zip" />
        <div id="inqUploadStatus" class="field full muted" style="font-size:12px"></div>
      </div>
      <input type="hidden" id="inqAttachments" value="${esc(JSON.stringify(q.attachments || []))}" />
    </details>
  `);

  const inqForm = $('#modalForm');
  const $$1 = (sel) => inqForm.querySelector(sel);

  // —— 客户匹配：命中老客户则带出档案并提示，未命中提示将新建 ——
  function inqMatchClient(name, onlyIfEmpty) {
    const nm = String(name || '').trim();
    const prev = document.getElementById('inqClientPreview');
    if (!nm) { if (prev) { prev.classList.add('hidden'); prev.innerHTML = ''; } return null; }
    const lower = nm.toLowerCase();
    const linked = (typeof clients !== 'undefined' ? clients : []).find((c) => (c.company || '').trim().toLowerCase() === lower)
      || (window.matchKnownClient ? window.matchKnownClient(nm) : null);
    if (!linked) {
      if (prev) {
        prev.innerHTML = `<div class="cp-card">🆕 新客户「${esc(nm)}」· 保存时自动建档，无需另填客户表</div>`;
        prev.classList.remove('hidden');
      }
      return null;
    }
    const setVal = (sel, val) => {
      const el = $$1(sel);
      if (!el || !val) return;
      if (onlyIfEmpty && el.value) return;
      el.value = val;
    };
    setVal('[name="country"]', linked.country);
    setVal('[name="contactName"]', linked.contactName);
    setVal('[name="contactEmail"]', linked.contactEmail);
    setVal('[name="contactPhone"]', linked.contactPhone);
    setVal('[name="source"]', linked.source);
    if (linked.owner && !q.owner) { const ow = $$1('[name="owner"]'); if (ow && !ow.value) ow.value = linked.owner; }
    if (prev) {
      const lines = [];
      if (linked.contactName) lines.push(`<b>👤 ${esc(linked.contactName)}</b>`);
      if (linked.contactPhone) lines.push(`☎ ${esc(linked.contactPhone)}`);
      if (linked.contactEmail) lines.push(`✉ ${esc(linked.contactEmail)}`);
      if (linked.stage) lines.push(`<span class="cp-stage st-${esc(linked.stage)}">${esc(linked.stage)}</span>`);
      prev.innerHTML = `<div class="cp-card">✅ 已关联老客户 · ${esc(linked.company || '')} · ${esc(linked.country || '未填')}<div class="cp-meta">${lines.join(' · ')}</div></div>`;
      prev.classList.remove('hidden');
    }
    return linked;
  }

  const nameInput = $$1('[name="clientName"]');
  if (nameInput) {
    let t = null;
    nameInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => inqMatchClient(nameInput.value, true), 350);
    });
    nameInput.addEventListener('change', () => inqMatchClient(nameInput.value, true));
    if (q.clientName) inqMatchClient(q.clientName, true);
  }

  // —— 「粘贴即填」：解析原文并回填全部字段 ——
  const pasteBox = document.getElementById('inqPasteBox');
  const parseBtn = document.getElementById('inqParseBtn');
  const parseStatus = document.getElementById('inqParseStatus');
  const manualBtn = document.getElementById('inqManualBtn');
  const moreBox = document.getElementById('inqMore');
  const moreHint = document.getElementById('inqMoreHint');
  let parsing = false;

  function setStatus(txt, ok) {
    if (!parseStatus) return;
    parseStatus.textContent = txt || '';
    parseStatus.style.color = ok === true ? 'var(--ok)' : (ok === false ? 'var(--danger)' : '');
  }

  function setField(name, val) {
    const el = $$1(`[name="${name}"]`);
    if (!el || val == null || val === '') return false;
    el.value = val;
    return true;
  }

  async function parseAndFill() {
    if (parsing) return;
    const text = (pasteBox && pasteBox.value || '').trim();
    if (!text) { toast('请先粘贴询盘原文'); return; }
    if (!window.extractInquiry) { toast('AI 模块未加载，请改用手动填写'); return; }
    parsing = true;
    if (parseBtn) parseBtn.disabled = true;
    setStatus('AI 解析中…（本地模型首次调用需加载，请稍候）');
    try {
      const d = await window.extractInquiry(text);
      let filled = 0;
      window.__inqParsed = d;
      for (const k of ['clientName', 'country', 'contactName', 'contactEmail', 'contactPhone',
        'source', 'receivedAt', 'product', 'model', 'expectedAmount', 'currency',
        'sampleSent', 'lastFollowAt', 'nextFollowAt', 'notes']) {
        if (setField(k, d[k])) filled++;
      }
      // 沟通记录：原文留档，供后续 AI 分析与复盘
      const chatEl = $$1('[name="chatLog"]');
      if (chatEl && !chatEl.value) { chatEl.value = text; filled++; }
      // 国家兜底：AI 没给就从邮箱域名推断
      const ctryEl = $$1('[name="country"]');
      if (ctryEl && !ctryEl.value) {
        const guess = guessCountryFromEmail(d.contactEmail);
        if (guess) { ctryEl.value = guess; filled++; }
      }
      // 命中老客户则补全档案信息并提示
      const linked = inqMatchClient(d.clientName, true);
      // 展开核对区，收起明细
      const core = document.getElementById('inqCore');
      if (core) core.classList.remove('hidden');
      if (moreBox) moreBox.open = false;
      if (moreHint) moreHint.textContent = `（已自动填 ${filled} 项，点开可核对）`;
      setStatus(linked ? '✅ 已填入并关联老客户，核对上面 3 项即可保存' : '✅ 已填入，核对上面 3 项即可保存', true);
    } catch (err) {
      setStatus('❌ ' + (err.message || '解析失败') + '　可点「手动填写」继续', false);
    } finally {
      parsing = false;
      if (parseBtn) parseBtn.disabled = false;
    }
  }

  if (parseBtn) parseBtn.addEventListener('click', parseAndFill);
  if (pasteBox) {
    // 粘贴即自动解析，省掉一次点击
    pasteBox.addEventListener('paste', () => {
      setTimeout(() => { if ((pasteBox.value || '').trim().length >= 30 && !parsing) parseAndFill(); }, 200);
    });
  }
  if (manualBtn) manualBtn.addEventListener('click', () => {
    const core = document.getElementById('inqCore');
    if (core) core.classList.remove('hidden');
    if (moreBox) moreBox.open = true;
    if (moreHint) moreHint.textContent = '（按需补充）';
    const paste = document.getElementById('inqPaste');
    if (paste) paste.classList.add('hidden');
    setStatus('');
    const el = nameInput || $$1('[name="product"]');
    if (el) el.focus();
  });

  // 附件管理：记录现有附件和待上传文件
  const existingAttachments = JSON.parse(($('#inqAttachments') && $('#inqAttachments').value) || '[]');
  let newFiles = [];
  if ($('#inqFiles')) {
    $('#inqFiles').addEventListener('change', () => {
      newFiles = Array.from($('#inqFiles').files);
      const names = newFiles.map((f) => f.name).join(', ');
      $('#inqUploadStatus').textContent = names ? `${newFiles.length} 个待上传：${names}` : '';
    });
  }
  if ($('#inqAttachList')) {
    $('#inqAttachList').querySelectorAll('.attach-del').forEach((b) => b.addEventListener('click', () => {
      existingAttachments.splice(Number(b.dataset.i), 1);
      loadInqAttachments();
    }));
  }
  function loadInqAttachments() {
    $('#inqAttachments').value = JSON.stringify(existingAttachments);
    const list = $('#inqAttachList');
    list.innerHTML = existingAttachments.map((a, i) => `<span class="attach-tag" data-i="${i}">📎 <a href="${esc(a.url)}" target="_blank">${esc(a.name || '文件')}</a> <button class="attach-del" data-i="${i}">&times;</button></span>`).join(' ');
    list.querySelectorAll('.attach-del').forEach((b) => b.addEventListener('click', () => {
      existingAttachments.splice(Number(b.dataset.i), 1);
      loadInqAttachments();
    }));
  }

  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    // 客户公司是唯一硬门槛：没填就别保存，并把明细展开引导补上
    if (!String(fd.clientName || '').trim()) {
      toast('请先粘贴原文解析，或点「手动填写」补上客户公司');
      if (moreBox) moreBox.open = true;
      const core = document.getElementById('inqCore');
      if (core) { core.classList.remove('hidden'); (nameInput || {}).focus && nameInput.focus(); }
      return;
    }
    // 设为成交时打点 wonAt，供业绩按「成交月份」归属
    if (fd.status === '成交' && !fd.wonAt) fd.wonAt = Date.now();
    // 上传新附件
    const uploaded = [];
    if (newFiles.length) {
      $('#inqUploadStatus').textContent = '上传中…';
      for (const f of newFiles) {
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(f);
          });
          const r = await api('/api/upload', { method: 'POST', body: JSON.stringify({ filename: f.name, data: dataUrl }) });
          if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || '上传失败'); }
          const j = await r.json();
          uploaded.push({ name: f.name, url: j.url });
        } catch (err) {
          toast('上传失败：' + (err.message || err));
          $('#inqUploadStatus').textContent = '';
          return;
        }
      }
      $('#inqUploadStatus').textContent = '上传完成';
    }
    const allAttachments = [...existingAttachments, ...uploaded];
    delete fd.attachments;
    const ownerId = fd.owner || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
    const ownerUser = (window.allUsers || []).find((u) => u.id === ownerId);
    fd.owner = ownerId;
    fd.ownerName = ownerUser ? (ownerUser.name || ownerUser.username) : (typeof currentUser !== 'undefined' && currentUser ? currentUser.name : '');
    fd.attachments = allAttachments;

    // 关联客户：命中已有客户则挂 clientId；未命中则顺手建档，省掉再填一张客户表
    const lower = (fd.clientName || '').trim().toLowerCase();
    let linkedClient = (typeof clients !== 'undefined' ? clients : []).find((c) => (c.company || '').trim().toLowerCase() === lower)
      || (window.matchKnownClient ? window.matchKnownClient(fd.clientName) : null);
    if (!linkedClient && !isEdit) {
      try {
        const cr = await api('/api/clients', { method: 'POST', body: JSON.stringify({
          company: fd.clientName, country: fd.country || '', contactName: fd.contactName || '',
          contactEmail: fd.contactEmail || '', contactPhone: fd.contactPhone || '',
          source: fd.source || '', stage: 'C', owner: fd.owner, ownerName: fd.ownerName,
          nextFollowUp: fd.nextFollowAt || '', notes: '由询盘自动建档',
        }) });
        if (cr.ok) {
          linkedClient = await cr.json();
          if (typeof clients !== 'undefined') clients.push(linkedClient);
          toast('已顺便建立客户档案');
        }
      } catch { /* 建档失败不阻塞询盘保存 */ }
    }
    fd.clientId = linkedClient ? linkedClient.id : (q.clientId || null);

    const url = editId ? '/api/inquiries/' + editId : '/api/inquiries';
    const m = editId ? 'PUT' : 'POST';
    const r = await api(url, { method: m, body: JSON.stringify(fd) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('保存失败：' + (j.error || r.status)); return; }
    // 同步客户资料的跟进人：如果询盘有关联客户且跟进人变了，自动更新客户档案
    if (fd.clientName && fd.owner) {
      try {
        const matchedClients = (typeof clients !== 'undefined') ? clients.filter((c) => (c.company || '').trim() === fd.clientName.trim()) : [];
        for (const c of matchedClients) {
          await api('/api/clients/' + c.id, { method: 'PUT', body: JSON.stringify({ owner: fd.owner, ownerName: fd.ownerName }) });
        }
      } catch { /* 非关键操作 */ }
    }
    toast('已保存');
    closeModal();
    loadInquiries();
  };
}


// -------- 统计分析 --------
function renderInqStats() {
  const total = inquiries.length;
  const won = inquiries.filter((q) => q.status === '成交').length;
  const sample = inquiries.filter((q) => q.sampleSent === '是').length;
  const invalid = inquiries.filter((q) => q.status === '无效').length;
  $('#istInq').textContent = total;
  $('#istConv').textContent = total ? Math.round((won / total) * 100) + '%' : '0%';
  $('#istSample').textContent = sample;
  $('#istGarbage').textContent = invalid;

  // 按状态分布
  const stCounts = INQ_STATUSES.map((s) => ({ label: s, count: inquiries.filter((q) => (q.status || '新询盘') === s).length }));
  $('#istLevelChart').innerHTML = barH(stCounts, 'count');

  // 按来源
  const srcMap = {};
  inquiries.forEach((q) => { const k = q.source || '未填'; srcMap[k] = (srcMap[k] || 0) + 1; });
  const srcList = Object.entries(srcMap).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count);
  $('#istSourceChart').innerHTML = barH(srcList, 'count');

  // 按国家
  const coMap = {};
  inquiries.forEach((q) => { const k = q.country || '未填'; coMap[k] = (coMap[k] || 0) + 1; });
  const coList = Object.entries(coMap).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 12);
  $('#istCountryChart').innerHTML = barH(coList, 'count');
}

function barH(items, key) {
  if (!items.length) return '<div class="empty">暂无数据</div>';
  const max = Math.max(...items.map((x) => x[key]));
  return items.map((it) => {
    const pct = max ? Math.round((it[key] / max) * 100) : 0;
    const color = it.color || 'var(--brand)';
    return `<div class="bar-row">
      <span class="lbl" title="${esc(it.label)}">${esc(it.label)}</span>
      <span class="bar"><i style="width:${pct}%;background:${color}"></i></span>
      <span class="v">${it[key]}</span>
    </div>`;
  }).join('');
}

// -------- 异常登记 --------
function renderExceptions() {
  const body = $('#excBody');
  if (!exceptions.length) { body.innerHTML = '<tr><td colspan="7" class="empty">暂无异常登记</td></tr>'; return; }
  body.innerHTML = exceptions
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((e) => {
      const inq = inquiries.find((q) => q.id === e.inquiryId);
      const st = e.status || '待处理';
      const stCls = st === '已解决' ? 'exc-resolved' : (st === '处理中' ? 'exc-progress' : 'exc-open');
      return `<tr>
        <td>${e.createdAt ? esc(new Date(e.createdAt).toISOString().slice(0, 10)) : '—'}</td>
        <td>${inq ? esc(displayClientName(inq)) : '<span class="muted">已删除</span>'}</td>
        <td>${esc(e.type || '-')}</td>
        <td>${esc(e.desc || '-')}</td>
        <td><span class="exc-status ${stCls}">${esc(st)}</span></td>
        <td>${esc(e.ownerName || e.owner || '-')}</td>
        <td>
          <button class="link-btn" data-edit-e="${e.id}">编辑</button>
          <button class="link-btn danger" data-del-e="${e.id}">删除</button>
        </td>
      </tr>`;
    }).join('');
  body.querySelectorAll('[data-edit-e]').forEach((b) => b.addEventListener('click', () => openExcModal(b.dataset.editE)));
  body.querySelectorAll('[data-del-e]').forEach((b) => b.addEventListener('click', async () => {
    if (confirm('确认删除该异常？')) {
      await api('/api/exceptions/' + b.dataset.delE, { method: 'DELETE' });
      toast('已删除');
      loadInquiries();
    }
  }));
}

$('#excAdd').addEventListener('click', () => openExcModal());

function openExcModal(id) {
  const e = id ? exceptions.find((x) => x.id === id) : { status: '待处理', createdAt: Date.now() };
  const inqOpts = ['<option value="">—</option>', ...inquiries.map((q) => `<option value="${q.id}" ${q.id === e.inquiryId ? 'selected' : ''}>${esc(displayClientName(q))} · ${esc(q.country || '')}</option>`)].join('');
  const typeOpts = EXC_TYPES.map((t) => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('');
  const stOpts = EXC_STATUSES.map((s) => `<option ${s === (e.status || '待处理') ? 'selected' : ''}>${s}</option>`).join('');
  const users = window.assignableUsers();
  const excOwnerDef = e.owner || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
  const excOwnerSel = ['<option value="">— 默认本人 —</option>',
    ...users.map((u) => `<option value="${u.id}" ${u.id === excOwnerDef ? 'selected' : ''}>${esc(u.name || u.username)}</option>`)].join('');
  openModal(id ? '编辑异常' : '新增异常', `
    <div class="field full"><label>关联询盘</label><select name="inquiryId">${inqOpts}</select></div>
    <div class="field"><label>类型</label><select name="type">${typeOpts}</select></div>
    <div class="field"><label>状态</label><select name="status">${stOpts}</select></div>
    <div class="field"><label>负责人</label><select name="owner">${excOwnerSel}</select></div>
    <div class="field full"><label>问题描述</label><textarea name="desc">${esc(e.desc)}</textarea></div>
  `);
  $('#modalForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const ownerId = fd.owner || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
    const ownerUser = (window.allUsers || []).find((u) => u.id === ownerId);
    fd.owner = ownerId;
    fd.ownerName = ownerUser ? (ownerUser.name || ownerUser.username) : (typeof currentUser !== 'undefined' && currentUser ? currentUser.name : '');
    const url = id ? '/api/exceptions/' + id : '/api/exceptions';
    const m = id ? 'PUT' : 'POST';
    await api(url, { method: m, body: JSON.stringify(fd) });
    toast('已保存');
    closeModal();
    loadInquiries();
  };
}

// 启动（由 app.js boot() 在登录成功后统一调用 window.refreshInquiries）

// 当 orders/clients 就绪后刷新看板（订阅 app.js 发出的 ftw:dataReady）
window.addEventListener('ftw:dataReady', () => {
  renderInqBoard();
  renderInqList();
  renderInqStats();
  if (window.renderFunnel) window.renderFunnel();
});

// 暴露给 ai.js 调用
window.refreshInquiries = loadInquiries;
window.getInquiryById = (id) => inquiries.find((x) => x.id === id);
window.getInquiriesByClient = (company) => inquiries.filter((x) => (x.clientName || '') === (company || ''));
window.getAllInquiries = () => inquiries;
window.openInqModal = openInqModal;

// ===== 清单事件委托（v20260902d）：一次绑定永久生效，重渲染/旧缓存都不再丢交互 =====
(function initInqListDelegation() {
  const body = document.getElementById('inqListBody');
  if (!body || body.dataset.inqDelegated) return;
  body.dataset.inqDelegated = '1';
  body.addEventListener('click', async (e) => {
    // 责任人单元格：点击按该跟进人过滤（再点一次取消）
    const ownerTd = e.target.closest('td.il-owner[data-owner-f]');
    if (ownerTd) {
      e.stopPropagation();
      const f = ownerTd.dataset.ownerF || '';
      inqOwnerFilterQ = (inqOwnerFilterQ === f) ? '' : f;
      renderInqBoard(); renderInqList();
      return;
    }
    const btn = e.target.closest('button[data-edit-i], button[data-qt-from-i], button[data-ai-i], button[data-del-i], a.link-name[data-detail-name]');
    if (!btn) return;
    if (btn.dataset.editI) { openInqModal(btn.dataset.editI); return; }
    if (btn.dataset.qtFromI) { const inq = inquiries.find((x) => x.id === btn.dataset.qtFromI); if (inq && typeof createQuoteFromInquiry === 'function') createQuoteFromInquiry(inq); return; }
    if (btn.dataset.aiI) { const inq = inquiries.find((x) => x.id === btn.dataset.aiI); if (inq && typeof openAiAnalyze === 'function') openAiAnalyze(inq); return; }
    if (btn.dataset.delI) {
      if (confirm('确认删除该询盘？')) {
        await api('/api/inquiries/' + btn.dataset.delI, { method: 'DELETE' });
        toast('已删除');
        loadInquiries();
      }
      return;
    }
    if (btn.dataset.detailName) { e.preventDefault(); window.openClientDetailByName(btn.dataset.detailName); }
  });
  body.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.classList) return;
    if (t.classList.contains('cb-inq')) {
      if (t.checked) inqSelected.add(t.dataset.iid); else inqSelected.delete(t.dataset.iid);
      renderInqBatchBar();
      return;
    }
    if (t.classList.contains('il-status')) {
      const id = t.dataset.iid;
      const item = inquiries.find((x) => x.id === id);
      const os = item ? (item.status || '新询盘') : '';
      if (os === t.value) return;
      changeInqStatus(id, t.value, { resetEl: (s) => { t.value = s; } });
      return;
    }
    if (t.classList.contains('il-follow')) updateInqFollowInline(t.dataset.iid, t.value, t);
  });
})();


// 全选（只作用于当前筛选后可见的行）
(function() { const cb = document.getElementById('cbInqAll'); if (cb) cb.addEventListener('change', () => {
  const rows = document.querySelectorAll('#inqListBody .cb-inq');
  if (cb.checked) rows.forEach((r) => inqSelected.add(r.dataset.iid));
  else rows.forEach((r) => inqSelected.delete(r.dataset.iid));
  renderInqList();
}); })();

// 询盘批量：勾选后只更新顶部「批量编辑 / 批量删除」按钮的计数与高亮，实际编辑走弹窗
function renderInqBatchBar() {
  const n = inqSelected.size;
  const edit = document.getElementById('inqBatchEdit');
  if (edit) {
    edit.textContent = n ? '✏️ 批量编辑 (' + n + ')' : '✏️ 批量编辑';
    edit.classList.toggle('btn-mini--active', n > 0);
    edit.title = n ? '修改选中的 ' + n + ' 条询盘' : '先勾选左侧复选框，再点此批量修改';
  }
  const del = document.getElementById('inqBatchDelete');
  if (del) {
    del.textContent = n ? '🗑️ 批量删除 (' + n + ')' : '🗑️ 批量删除';
    del.classList.toggle('btn-mini--active', n > 0);
    del.title = n ? '删除选中的 ' + n + ' 条询盘（不可恢复）' : '先勾选左侧复选框，再点此批量删除';
  }
  const all = document.getElementById('cbInqAll');
  if (all) {
    const total = document.querySelectorAll('#inqListBody .cb-inq').length;
    all.checked = total > 0 && n >= total;
    all.indeterminate = n > 0 && n < total;
  }
}
// 兼容旧调用名
function bindInqBatchBar() {}

// 批量删除询盘 —— 危险操作，二次确认（询盘团队共享，无 owner 限制）
function openInqBatchDelete() {
  const ids = [...inqSelected];
  if (!ids.length) { toast('请先勾选左侧复选框选择要删除的询盘'); return; }
  openModal('批量删除询盘', ''
    + '<div class="batch-note danger-note">即将删除选中的 <b>' + ids.length + '</b> 条询盘，此操作<b>不可恢复</b>！</div>'
    + '<div class="modal-foot"><button type="button" class="btn-ghost" id="bmCancel">取消</button>'
    + '<button type="submit" class="btn-danger" id="bmDelete">确认删除 ' + ids.length + ' 条</button></div>',
    { plain: true, noFooter: true });
  document.getElementById('bmCancel').onclick = closeModal;
  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    document.getElementById('bmCancel').disabled = true;
    document.getElementById('bmDelete').disabled = true;
    await batchDeleteRecords(ids, (id) => '/api/inquiries/' + id, '询盘');
    inqSelected.clear();
    closeModal();
    loadInquiries();
  };
}

// 批量编辑询盘 —— 右侧滑入弹窗
function openInqBatchEdit() {
  const ids = [...inqSelected];
  if (!ids.length) { toast('请先勾选左侧复选框选择要修改的询盘'); return; }
  const uOpts = window.assignableUsers().map((u) => '<option value="' + u.id + '">' + esc(u.name || u.username) + '</option>').join('');
  const stOpts = INQ_STATUSES.map((s) => '<option value="' + s + '">' + s + '</option>').join('');
  openModal('批量编辑询盘', ''
    + '<div class="batch-note">已选中 <b>' + ids.length + '</b> 条询盘，将统一修改下面选择的字段</div>'
    + '<div class="field"><label>修改字段</label><select id="bmField"><option value="status">状态</option><option value="owner">跟进人</option></select></div>'
    + '<div class="field" id="bmGradeWrap"><label>新状态</label><select id="bmGrade">' + stOpts + '</select></div>'
    + '<div class="field hidden" id="bmOwnerWrap"><label>新跟进人</label><select id="bmOwner">' + uOpts + '</select></div>'
    + '<div class="modal-foot"><button type="button" class="btn-ghost" id="bmCancel">取消</button>'
    + '<button type="submit" class="btn-save">应用到 ' + ids.length + ' 条询盘</button></div>',
    { plain: true, noFooter: true });
  const fld = document.getElementById('bmField');
  fld.onchange = () => {
    document.getElementById('bmGradeWrap').classList.toggle('hidden', fld.value !== 'status');
    document.getElementById('bmOwnerWrap').classList.toggle('hidden', fld.value !== 'owner');
  };
  document.getElementById('bmCancel').onclick = closeModal;
  document.getElementById('modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const field = fld.value;
    let payload;
    if (field === 'owner') {
      const value = document.getElementById('bmOwner').value;
      if (!value) { toast('请选择跟进人'); return; }
      payload = { owner: value, ownerName: ((window.allUsers || []).find((u) => u.id === value) || {}).name || '' };
    } else {
      const st = document.getElementById('bmGrade').value;
      payload = { status: st };
      if (st === '成交') payload.wonAt = Date.now();
    }
    let ok = 0;
    for (const id of ids) {
      try { await api('/api/inquiries/' + id, { method: 'PUT', body: JSON.stringify(payload) }); ok++; } catch {}
    }
    toast('已更新 ' + ok + ' 条询盘');
    inqSelected.clear();
    closeModal();
    loadInquiries();
  };
}
(function () {
  const b = document.getElementById('inqBatchEdit');
  if (b) b.addEventListener('click', openInqBatchEdit);
  const d = document.getElementById('inqBatchDelete');
  if (d) d.addEventListener('click', openInqBatchDelete);
})();
