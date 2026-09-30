// ====== WhatsApp 快捷发起（官方 click-to-chat 深链方案）======
// 原理：不使用任何逆向的「WhatsApp Web API」（whatsapp-web.js / Baileys 之流，扫码即被识别为
// 非官方客户端，封号风险极高）。这里走 WhatsApp 官方支持的 click-to-chat：
//   whatsapp://send?phone=<国际号码>&text=<预填文本>   → 唤起本机 WhatsApp 桌面版/手机版
//   https://wa.me/<国际号码>?text=<预填文本>            → 网页版兜底
// 消息由「人」按下发送键，因此零封号风险、零费用、零依赖。
// CRM 侧负责：号码规范化、话术模板变量替换、客户当地时间提醒、自动写入沟通记录。

// ---- 国际区号表（外贸常用）：tz = IANA 时区（浏览器原生处理夏令时）；we = 当地周末 ----
const WA_DIALS = [
  {c:'976', n:'蒙古国 Mongolia', tz:'Asia/Ulaanbaatar'},
  { c: '86', n: '中国', tz: 'Asia/Shanghai' },
  { c: '852', n: '中国香港', tz: 'Asia/Hong_Kong' },
  { c: '853', n: '中国澳门', tz: 'Asia/Macau' },
  { c: '886', n: '中国台湾', tz: 'Asia/Taipei' },
  { c: '1', n: '美国 / 加拿大', tz: 'America/New_York' },
  { c: '44', n: '英国', tz: 'Europe/London' },
  { c: '49', n: '德国', tz: 'Europe/Berlin' },
  { c: '33', n: '法国', tz: 'Europe/Paris' },
  { c: '39', n: '意大利', tz: 'Europe/Rome' },
  { c: '34', n: '西班牙', tz: 'Europe/Madrid' },
  { c: '351', n: '葡萄牙', tz: 'Europe/Lisbon' },
  { c: '31', n: '荷兰', tz: 'Europe/Amsterdam' },
  { c: '32', n: '比利时', tz: 'Europe/Brussels' },
  { c: '41', n: '瑞士', tz: 'Europe/Zurich' },
  { c: '43', n: '奥地利', tz: 'Europe/Vienna' },
  { c: '46', n: '瑞典', tz: 'Europe/Stockholm' },
  { c: '47', n: '挪威', tz: 'Europe/Oslo' },
  { c: '45', n: '丹麦', tz: 'Europe/Copenhagen' },
  { c: '358', n: '芬兰', tz: 'Europe/Helsinki' },
  { c: '48', n: '波兰', tz: 'Europe/Warsaw' },
  { c: '420', n: '捷克', tz: 'Europe/Prague' },
  { c: '36', n: '匈牙利', tz: 'Europe/Budapest' },
  { c: '40', n: '罗马尼亚', tz: 'Europe/Bucharest' },
  { c: '30', n: '希腊', tz: 'Europe/Athens' },
  { c: '380', n: '乌克兰', tz: 'Europe/Kyiv' },
  { c: '7', n: '俄罗斯 / 哈萨克斯坦', tz: 'Europe/Moscow' },
  { c: '90', n: '土耳其', tz: 'Europe/Istanbul' },
  { c: '972', n: '以色列', tz: 'Asia/Jerusalem', we: [5, 6] },
  { c: '966', n: '沙特阿拉伯', tz: 'Asia/Riyadh', we: [5, 6] },
  { c: '971', n: '阿联酋', tz: 'Asia/Dubai', we: [6, 0] },
  { c: '974', n: '卡塔尔', tz: 'Asia/Qatar', we: [5, 6] },
  { c: '965', n: '科威特', tz: 'Asia/Kuwait', we: [5, 6] },
  { c: '973', n: '巴林', tz: 'Asia/Bahrain', we: [5, 6] },
  { c: '968', n: '阿曼', tz: 'Asia/Muscat', we: [5, 6] },
  { c: '962', n: '约旦', tz: 'Asia/Amman', we: [5, 6] },
  { c: '961', n: '黎巴嫩', tz: 'Asia/Beirut' },
  { c: '964', n: '伊拉克', tz: 'Asia/Baghdad', we: [5, 6] },
  { c: '98', n: '伊朗', tz: 'Asia/Tehran', we: [5, 5] },
  { c: '20', n: '埃及', tz: 'Africa/Cairo', we: [5, 6] },
  { c: '212', n: '摩洛哥', tz: 'Africa/Casablanca' },
  { c: '213', n: '阿尔及利亚', tz: 'Africa/Algiers', we: [5, 6] },
  { c: '216', n: '突尼斯', tz: 'Africa/Tunis' },
  { c: '218', n: '利比亚', tz: 'Africa/Tripoli', we: [5, 6] },
  { c: '27', n: '南非', tz: 'Africa/Johannesburg' },
  { c: '234', n: '尼日利亚', tz: 'Africa/Lagos' },
  { c: '254', n: '肯尼亚', tz: 'Africa/Nairobi' },
  { c: '233', n: '加纳', tz: 'Africa/Accra' },
  { c: '251', n: '埃塞俄比亚', tz: 'Africa/Addis_Ababa' },
  { c: '255', n: '坦桑尼亚', tz: 'Africa/Dar_es_Salaam' },
  { c: '91', n: '印度', tz: 'Asia/Kolkata' },
  { c: '92', n: '巴基斯坦', tz: 'Asia/Karachi' },
  { c: '880', n: '孟加拉国', tz: 'Asia/Dhaka', we: [5, 6] },
  { c: '94', n: '斯里兰卡', tz: 'Asia/Colombo' },
  { c: '977', n: '尼泊尔', tz: 'Asia/Kathmandu' },
  { c: '62', n: '印度尼西亚', tz: 'Asia/Jakarta' },
  { c: '60', n: '马来西亚', tz: 'Asia/Kuala_Lumpur' },
  { c: '65', n: '新加坡', tz: 'Asia/Singapore' },
  { c: '66', n: '泰国', tz: 'Asia/Bangkok' },
  { c: '84', n: '越南', tz: 'Asia/Ho_Chi_Minh' },
  { c: '63', n: '菲律宾', tz: 'Asia/Manila' },
  { c: '855', n: '柬埔寨', tz: 'Asia/Phnom_Penh' },
  { c: '95', n: '缅甸', tz: 'Asia/Yangon' },
  { c: '856', n: '老挝', tz: 'Asia/Vientiane' },
  { c: '82', n: '韩国', tz: 'Asia/Seoul' },
  { c: '81', n: '日本', tz: 'Asia/Tokyo' },
  { c: '61', n: '澳大利亚', tz: 'Australia/Sydney' },
  { c: '64', n: '新西兰', tz: 'Pacific/Auckland' },
  { c: '55', n: '巴西', tz: 'America/Sao_Paulo' },
  { c: '52', n: '墨西哥', tz: 'America/Mexico_City' },
  { c: '54', n: '阿根廷', tz: 'America/Argentina/Buenos_Aires' },
  { c: '56', n: '智利', tz: 'America/Santiago' },
  { c: '57', n: '哥伦比亚', tz: 'America/Bogota' },
  { c: '51', n: '秘鲁', tz: 'America/Lima' },
  { c: '58', n: '委内瑞拉', tz: 'America/Caracas' },
  { c: '593', n: '厄瓜多尔', tz: 'America/Guayaquil' },
  { c: '507', n: '巴拿马', tz: 'America/Panama' },
];

// 国家名 → 区号（新建客户时按已填「国家」自动预选）
const WA_COUNTRY_HINT = {
  '蒙古':'976', '蒙古国':'976', 'mongolia':'976',
  '中国': '86', 'china': '86', '香港': '852', 'hong kong': '852', '澳门': '853', 'macao': '853',
  '台湾': '886', 'taiwan': '886',
  '美国': '1', 'usa': '1', 'us': '1', 'united states': '1', 'america': '1', '加拿大': '1', 'canada': '1',
  '英国': '44', 'uk': '44', 'united kingdom': '44', 'england': '44', 'britain': '44',
  '德国': '49', 'germany': '49', '法国': '33', 'france': '33', '意大利': '39', 'italy': '39',
  '西班牙': '34', 'spain': '34', '葡萄牙': '351', 'portugal': '351', '荷兰': '31', 'netherlands': '31', 'holland': '31',
  '比利时': '32', 'belgium': '32', '瑞士': '41', 'switzerland': '41', '奥地利': '43', 'austria': '43',
  '瑞典': '46', 'sweden': '46', '挪威': '47', 'norway': '47', '丹麦': '45', 'denmark': '45',
  '芬兰': '358', 'finland': '358', '波兰': '48', 'poland': '48', '捷克': '420', 'czech': '420',
  '匈牙利': '36', 'hungary': '36', '罗马尼亚': '40', 'romania': '40', '希腊': '30', 'greece': '30',
  '乌克兰': '380', 'ukraine': '380', '俄罗斯': '7', 'russia': '7', '哈萨克斯坦': '7', 'kazakhstan': '7',
  '土耳其': '90', 'turkey': '90', 'türkiye': '90', '以色列': '972', 'israel': '972',
  '沙特': '966', '沙特阿拉伯': '966', 'saudi': '966', 'saudi arabia': '966', 'ksa': '966',
  '阿联酋': '971', 'uae': '971', 'united arab emirates': '971', 'dubai': '971',
  '卡塔尔': '974', 'qatar': '974', '科威特': '965', 'kuwait': '965', '巴林': '973', 'bahrain': '973',
  '阿曼': '968', 'oman': '968', '约旦': '962', 'jordan': '962', '黎巴嫩': '961', 'lebanon': '961',
  '伊拉克': '964', 'iraq': '964', '伊朗': '98', 'iran': '98',
  '埃及': '20', 'egypt': '20', '摩洛哥': '212', 'morocco': '212', '阿尔及利亚': '213', 'algeria': '213',
  '突尼斯': '216', 'tunisia': '216', '利比亚': '218', 'libya': '218',
  '南非': '27', 'south africa': '27', '尼日利亚': '234', 'nigeria': '234', '肯尼亚': '254', 'kenya': '254',
  '加纳': '233', 'ghana': '233', '埃塞俄比亚': '251', 'ethiopia': '251', '坦桑尼亚': '255', 'tanzania': '255',
  '印度': '91', 'india': '91', '巴基斯坦': '92', 'pakistan': '92', '孟加拉': '880', '孟加拉国': '880', 'bangladesh': '880',
  '斯里兰卡': '94', 'sri lanka': '94', '尼泊尔': '977', 'nepal': '977',
  '印尼': '62', '印度尼西亚': '62', 'indonesia': '62', '马来西亚': '60', 'malaysia': '60',
  '新加坡': '65', 'singapore': '65', '泰国': '66', 'thailand': '66', '越南': '84', 'vietnam': '84',
  '菲律宾': '63', 'philippines': '63', '柬埔寨': '855', 'cambodia': '855', '缅甸': '95', 'myanmar': '95',
  '老挝': '856', 'laos': '856', '韩国': '82', 'korea': '82', 'south korea': '82',
  '日本': '81', 'japan': '81', '澳大利亚': '61', '澳洲': '61', 'australia': '61',
  '新西兰': '64', 'new zealand': '64', '巴西': '55', 'brazil': '55', '墨西哥': '52', 'mexico': '52',
  '阿根廷': '54', 'argentina': '54', '智利': '56', 'chile': '56', '哥伦比亚': '57', 'colombia': '57',
  '秘鲁': '51', 'peru': '51', '委内瑞拉': '58', 'venezuela': '58', '厄瓜多尔': '593', 'ecuador': '593',
  '巴拿马': '507', 'panama': '507',
};

// ---- 内置话术（用户自建话术为空时兜底；支持 {{变量}}）----
const WA_BUILTIN_TMPL = [
  {
    id: '_b1', title: '① 首次接触 / 开发信跟进', channel: 'WhatsApp',
    content: 'Hi {{联系人}}, this is {{我}} from {{我司}}.\n\nI sent you an email about {{产品}} but wasn\'t sure it reached you. We are a Chinese manufacturer with CE certification and 10+ years in conveyor systems.\n\nWould you like me to send the catalogue and price list here? Happy to answer any questions.',
  },
  {
    id: '_b2', title: '② 报价后跟进', channel: 'WhatsApp',
    content: 'Hi {{联系人}}, hope you are doing well.\n\nJust following up on the quotation for {{产品}} we sent you. Do you need any clarification on the specs, lead time or payment terms?\n\nIf the budget is the concern, let me know your target price and I will check what we can do.',
  },
  {
    id: '_b3', title: '③ 订单/生产进度通报', channel: 'WhatsApp',
    content: 'Hi {{联系人}}, quick update on order {{订单号}}.\n\nProduction is on schedule. I will share photos before packing so you can confirm everything is correct.\n\nPlease let me know if you need any change on the shipping marks.',
  },
  {
    id: '_b4', title: '④ 长期未联系唤醒', channel: 'WhatsApp',
    content: 'Hi {{联系人}}, it\'s {{我}} from {{我司}}. It has been a while since we last talked.\n\nWe recently upgraded our {{产品}} line and the price is more competitive than before. If you have any project coming up, I would be glad to quote again.\n\nWishing you a good week!',
  },
];

// ---- 号码处理 ----
function waDigits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

function waDialOf(rec) {
  const d = waDigits(rec && rec.waDial);
  if (d) return d;
  const hint = String((rec && rec.country) || '').trim().toLowerCase();
  if (hint && WA_COUNTRY_HINT[hint]) return WA_COUNTRY_HINT[hint];
  for (const k in WA_COUNTRY_HINT) { if (hint && hint.includes(k)) return WA_COUNTRY_HINT[k]; }
  return '';
}

// 拼出可直接用于 wa.me 的纯数字国际号码
function waFullNumber(rec) {
  if (!rec) return '';
  const dial = waDigits(rec.waDial);
  let local = waDigits(rec.waPhone);
  if (!dial && !local) {
    // 老数据兜底：whatsapp / 电话字段里可能已是完整国际号
    const raw = waDigits(rec.whatsapp || rec.contactPhone || '').replace(/^0+/, '');
    return raw.length >= 7 ? raw : '';
  }
  local = local.replace(/^0+/, ''); // 本地格式的前导 0 在国际拨号中要去掉
  if (!dial) return local;
  // 用户把区号又填进了号码里 → 去重（剥离后仍需 ≥7 位才认为是重复）
  if (local.startsWith(dial) && local.length - dial.length >= 7) local = local.slice(dial.length);
  return dial + local;
}

function waHasNumber(rec) { return waFullNumber(rec).length >= 7; }
function waPretty(rec) { const n = waFullNumber(rec); return n ? '+' + n : ''; }

// ---- 客户当地时间 / 发送时机 ----
const WA_WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WA_WD_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function waTzOf(dial) {
  const d = waDigits(dial);
  const hit = WA_DIALS.find((x) => x.c === d);
  return hit || null;
}

// 返回 { time:'14:30', wd:3, wdText:'周三', hour:14, level:'ok'|'warn'|'bad', tip:'...' }
function waLocalClock(dial) {
  const info = waTzOf(dial);
  if (!info) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: info.tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(new Date());
  } catch { return null; }
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  let h = parseInt(get('hour'), 10);
  if (!isFinite(h) || h === 24) h = 0;
  const mm = get('minute') || '00';
  const wd = WA_WD[get('weekday')];
  const we = info.we || [6, 0]; // 默认周六、周日休息
  const isWeekend = we.indexOf(wd) >= 0;
  let level = 'ok'; let tip = '对方工作时间，适合发送';
  if (h < 7 || h >= 22) { level = 'bad'; tip = '对方深夜/凌晨，强烈建议改天再发'; }
  else if (h < 9 || h >= 19) { level = 'warn'; tip = '对方非工作时段，可能打扰'; }
  else if (isWeekend) { level = 'warn'; tip = '当地周末休息日，酌情发送'; }
  else if (h >= 12 && h < 14) { level = 'warn'; tip = '对方午休时间'; }
  return { time: String(h).padStart(2, '0') + ':' + mm, hour: h, wd, wdText: WA_WD_CN[wd] || '', level, tip, tz: info.tz, country: info.n };
}

// ---- 话术变量 ----
function waFill(text, ctx) {
  const c = ctx || {};
  const map = {
    '客户': c.company, '公司': c.company, 'client': c.company, 'company': c.company,
    '联系人': c.contactName, 'contact': c.contactName, 'name': c.contactName,
    '国家': c.country, 'country': c.country,
    '产品': c.product, 'product': c.product,
    '订单号': c.orderNo, '报价单号': c.orderNo, 'orderno': c.orderNo, 'order': c.orderNo,
    '我': c.meName, '我的名字': c.meName, 'me': c.meName, 'sender': c.meName,
    '我司': c.myCompany, 'mycompany': c.myCompany,
    '今天': (typeof todayStr === 'function' ? todayStr() : ''), 'today': (typeof todayStr === 'function' ? todayStr() : ''),
  };
  return String(text == null ? '' : text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => {
    const key = String(k).trim();
    const v = map[key] != null ? map[key] : map[key.toLowerCase()];
    return (v != null && String(v) !== '') ? String(v) : m; // 取不到值时保留占位符，方便肉眼发现
  });
}
function waLeftovers(text) {
  const out = []; const re = /\{\{\s*([^{}]+?)\s*\}\}/g; let m;
  while ((m = re.exec(String(text || '')))) { if (out.indexOf(m[1].trim()) < 0) out.push(m[1].trim()); }
  return out;
}

// ---- 深链 ----
function waAppLink(num, text) { return 'whatsapp://send?phone=' + num + (text ? '&text=' + encodeURIComponent(text) : ''); }
function waWebLink(num, text) { return 'https://wa.me/' + num + (text ? '?text=' + encodeURIComponent(text) : ''); }

function waTrigger(url, newTab) {
  const a = document.createElement('a');
  a.href = url;
  if (newTab) { a.target = '_blank'; a.rel = 'noopener'; }
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { a.remove(); } catch { /* ignore */ } }, 1500);
}

// ---- 列表里的小按钮 ----
// attrs 用于挂 data-* 供调用方绑定事件；label 传 '' 则只显示图标（窄列用）
function waBtnHtml(rec, label, attrs) {
  if (!waHasNumber(rec)) return '';
  const txt = label === '' ? '' : ' ' + (label || 'WhatsApp');
  return '<button class="link-btn wa-mini" type="button" ' + (attrs || '')
    + ' title="用 WhatsApp 联系 ' + esc(waPretty(rec)) + '">🟢' + esc(txt) + '</button>';
}

// ---- 主弹窗 ----
function openWaModal(ctx) {
  const c = ctx || {};
  const rec = c.record || c;
  const me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : {};
  const vars = {
    company: c.company || rec.company || rec.clientName || '',
    contactName: c.contactName || rec.contactName || '',
    country: c.country || rec.country || '',
    product: c.product || rec.product || '',
    orderNo: c.orderNo || rec.orderNo || '',
    meName: me.name || me.username || '',
    myCompany: (typeof waMyCompany === 'function' ? waMyCompany() : 'Your Company'),
  };
  let dial = waDialOf(rec) || '86';
  let local = waDigits(rec.waPhone);
  if (!local) {
    const full = waFullNumber(rec);
    if (full && full.startsWith(dial)) local = full.slice(dial.length);
    else local = full;
  }

  const tmplList = []
    .concat((typeof commTmpl !== 'undefined' && Array.isArray(commTmpl) ? commTmpl : [])
      .filter((t) => !t.channel || t.channel === 'WhatsApp')
      .map((t) => ({ id: t.id, title: t.title || '未命名话术', content: t.content || '' })))
    .concat(WA_BUILTIN_TMPL.map((t) => ({ id: t.id, title: t.title + '（内置）', content: t.content })));

  const dialOpts = WA_DIALS.map((d) => '<option value="' + d.c + '"' + (d.c === dial ? ' selected' : '') + '>+' + d.c + ' ' + esc(d.n) + '</option>').join('');
  const tmplOpts = ['<option value="">— 空白，自己写 —</option>']
    .concat(tmplList.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>')).join('');

  openModal('WhatsApp · ' + (vars.company || vars.contactName || '发起沟通'), `
    <div class="wa-wrap">
      <div class="wa-numrow">
        <div class="field"><label>区号 / 国家</label><select id="waDial">${dialOpts}</select></div>
        <div class="field"><label>WhatsApp 号码（不含区号）</label><input id="waLocal" value="${esc(local)}" placeholder="如 9123456789" /></div>
        <div class="wa-preview"><span class="muted">完整号码</span><b id="waFull">—</b></div>
      </div>
      <div id="waClock" class="wa-clock"></div>
      <div class="field full">
        <label>话术模板 <span class="muted">（选中后自动替换 {{变量}}）</span></label>
        <select id="waTmpl">${tmplOpts}</select>
      </div>
      <div class="field full">
        <label>发送内容 <span class="muted" id="waCount"></span></label>
        <textarea id="waText" rows="9" placeholder="在这里写要发给客户的话，或从上面选一个话术模板"></textarea>
      </div>
      <div id="waWarn" class="wa-warn" style="display:none"></div>
      <label class="wa-check"><input type="checkbox" id="waLog" checked /> 发起后自动写入沟通记录</label>
      <div class="wa-actions">
        <button class="btn-primary" id="waGo" type="button">🟢 打开 WhatsApp 并记录</button>
        <button class="btn-ghost" id="waGoWeb" type="button">用网页版打开</button>
        <button class="btn-ghost" id="waCopy" type="button">仅复制文本</button>
        <button class="btn-ghost" id="waSaveNum" type="button">💾 号码存入客户档案</button>
      </div>
      <div class="wa-hint">消息不会自动发出 —— WhatsApp 会带着这段文字打开对话框，你确认后再按发送键。</div>
    </div>
  `, { wide: true, noFooter: true });

  const $$ = (id) => document.getElementById(id);
  const elDial = $$('waDial'); const elLocal = $$('waLocal'); const elFull = $$('waFull');
  const elText = $$('waText'); const elWarn = $$('waWarn'); const elCount = $$('waCount');

  function curRec() { return { waDial: elDial.value, waPhone: elLocal.value }; }
  function refresh() {
    const num = waFullNumber(curRec());
    elFull.textContent = num ? '+' + num : '（请填写号码）';
    elFull.className = num.length >= 7 ? 'wa-ok' : 'wa-bad';
    // 当地时间
    const clk = waLocalClock(elDial.value);
    $$('waClock').innerHTML = clk
      ? `<span class="wa-dot wa-${clk.level}"></span>客户当地时间 <b>${clk.wdText} ${clk.time}</b> <span class="muted">（${esc(clk.country)}）</span> · ${esc(clk.tip)}`
      : '';
    // 文本校验
    const txt = elText.value || '';
    const left = waLeftovers(txt);
    elCount.textContent = txt.length ? '· ' + txt.length + ' 字符' : '';
    if (left.length) {
      elWarn.style.display = '';
      elWarn.innerHTML = '⚠️ 还有未填的变量：' + left.map((x) => '<code>{{' + esc(x) + '}}</code>').join('、') + '　（对应客户档案里该字段为空，请手动补上再发）';
    } else if (txt.length > 1200) {
      elWarn.style.display = '';
      elWarn.innerHTML = '⚠️ 文本较长（' + txt.length + ' 字符），部分浏览器可能截断预填内容，建议精简或分两条发。';
    } else { elWarn.style.display = 'none'; elWarn.innerHTML = ''; }
  }

  elDial.onchange = refresh;
  elLocal.oninput = refresh;
  elText.oninput = refresh;
  $$('waTmpl').onchange = (e) => {
    const t = tmplList.find((x) => x.id === e.target.value);
    if (!t) return;
    if (elText.value.trim() && !confirm('替换当前已输入的内容？')) { e.target.value = ''; return; }
    elText.value = waFill(t.content, vars);
    refresh();
  };
  refresh();

  async function writeLog(txt, via) {
    try {
      const r = await api('/api/comms', { method: 'POST', body: JSON.stringify({
        clientName: vars.company || vars.contactName || '',
        channel: 'WhatsApp',
        date: (typeof todayStr === 'function' ? todayStr() : ''),
        summary: 'WhatsApp 主动发起' + (vars.product ? '（' + vars.product + '）' : '') + ' · ' + via,
        content: '【我方发出】\n' + txt,
      }) });
      if (r.ok && typeof loadComms === 'function') loadComms();
      return r.ok;
    } catch { return false; }
  }

  async function go(web) {
    const num = waFullNumber(curRec());
    if (num.length < 7) { toast('请先填写完整的 WhatsApp 号码'); elLocal.focus(); return; }
    const txt = elText.value || '';
    const clk = waLocalClock(elDial.value);
    if (clk && clk.level === 'bad' && !confirm('客户当地现在是 ' + clk.wdText + ' ' + clk.time + '，' + clk.tip + '。\n\n仍要现在发起吗？')) return;
    waTrigger(web ? waWebLink(num, txt) : waAppLink(num, txt), !!web);
    if ($$('waLog').checked && txt.trim()) {
      const ok = await writeLog(txt, web ? '网页版' : '桌面版');
      toast(ok ? '已打开 WhatsApp，沟通记录已存档' : '已打开 WhatsApp（沟通记录写入失败）');
    } else { toast('已打开 WhatsApp'); }
    closeModal();
  }

  $$('waGo').onclick = () => go(false);
  $$('waGoWeb').onclick = () => go(true);
  $$('waCopy').onclick = () => {
    const txt = elText.value || '';
    if (!txt) return toast('内容为空');
    navigator.clipboard.writeText(txt).then(() => toast('已复制到剪贴板'), () => toast('复制失败'));
  };
  $$('waSaveNum').onclick = async () => {
    const cid = c.clientId || rec.id;
    if (!cid || !c.isClient) return toast('该记录不是客户档案，无法保存号码');
    const num = waFullNumber(curRec());
    if (num.length < 7) return toast('号码不完整');
    const r = await api('/api/clients/' + cid, { method: 'PUT', body: JSON.stringify({ waDial: elDial.value, waPhone: waDigits(elLocal.value) }) });
    if (r.ok) { toast('号码已存入客户档案'); if (typeof loadAll === 'function') loadAll(); }
    else { const j = await r.json().catch(() => ({})); toast(j.error || '保存失败'); }
  };
}

// ---- 极简版：一键直达（跳过弹窗，减少点击）----
// 已存号码 → 用默认话术直接打开 WhatsApp（app 深链）；无号码 → 退回完整弹窗补号码
async function waQuick(ctx) {
  const c = ctx || {};
  const rec = c.record || c;
  if (!waHasNumber(rec)) {
    // 没有号码，走完整弹窗让补充（客户详情/建档场景下需要）
    if (typeof openWaModal === 'function') return openWaModal(c);
    return (typeof toast === 'function') ? toast('请先填写客户的 WhatsApp 号码') : undefined;
  }
  const me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : {};
  const vars = {
    company: c.company || rec.company || rec.clientName || '',
    contactName: c.contactName || rec.contactName || '',
    country: c.country || rec.country || '',
    product: c.product || rec.product || '',
    orderNo: c.orderNo || rec.orderNo || '',
    meName: me.name || me.username || '',
    myCompany: (typeof waMyCompany === 'function' ? waMyCompany() : 'Your Company'),
  };
  const text = waFill(WA_BUILTIN_TMPL[0].content, vars);
  const num = waFullNumber(rec);
  const clk = waLocalClock(waDialOf(rec));
  if (clk && clk.level === 'bad' && typeof confirm === 'function'
    && !confirm('客户当地现在是 ' + clk.wdText + ' ' + clk.time + '，' + clk.tip + '。\n\n仍要现在发起吗？')) return;
  // 直接唤起本机 WhatsApp（桌面版）。若本机没装 App，可用沟通页「发起 WhatsApp」选「网页版打开」
  waTrigger(waAppLink(num, text), false);
  // 后台写沟通记录（与弹窗逻辑一致）
  try {
    const r = await api('/api/comms', { method: 'POST', body: JSON.stringify({
      clientName: vars.company || vars.contactName || '',
      channel: 'WhatsApp',
      date: (typeof todayStr === 'function' ? todayStr() : ''),
      summary: 'WhatsApp 主动发起' + (vars.product ? '（' + vars.product + '）' : '') + ' · 桌面版',
      content: '【我方发出】\n' + text,
    }) });
    if (r && r.ok && typeof loadComms === 'function') loadComms();
    if (typeof toast === 'function') toast((r && r.ok) ? '已打开 WhatsApp，沟通记录已存档' : '已打开 WhatsApp（沟通记录写入失败）');
  } catch { if (typeof toast === 'function') toast('已打开 WhatsApp'); }
}

// ---- 沟通页入口：先挑客户，再进发起弹窗 ----
function openWaPicker() {
  const list = (typeof clients !== 'undefined' && Array.isArray(clients)) ? clients : [];
  if (!list.length) return toast('还没有客户档案，请先到「客户管理」新增');
  // 有号码的排前面，省得每次翻找
  const sorted = list.slice().sort((a, b) => (waHasNumber(b) ? 1 : 0) - (waHasNumber(a) ? 1 : 0)
    || String(a.company || '').localeCompare(String(b.company || '')));
  const rows = sorted.map((c) => {
    const has = waHasNumber(c);
    const clk = has ? waLocalClock(waDialOf(c)) : null;
    return `<button class="wa-pick" type="button" data-wa-pick="${esc(c.id)}">
      <span class="wa-pick-main">
        <b>${esc(c.company || '未命名')}</b>
        <span class="muted">${esc(c.country || '未知国家')}${c.contactName ? ' · ' + esc(c.contactName) : ''}</span>
      </span>
      <span class="wa-pick-side">${has
    ? `<span class="wa-num">${esc(waPretty(c))}</span>${clk ? `<span class="wa-dot wa-${clk.level}"></span><span class="muted">${clk.wdText} ${clk.time}</span>` : ''}`
    : '<span class="muted">未填号码</span>'}</span>
    </button>`;
  }).join('');
  openModal('选择客户 · 发起 WhatsApp', `
    <div class="field full"><input id="waPickQ" placeholder="🔍 输入公司名 / 国家 / 联系人筛选" /></div>
    <div class="wa-picklist" id="waPickList">${rows}</div>
  `, { wide: true, noFooter: true });
  const q = document.getElementById('waPickQ');
  const bind = () => document.querySelectorAll('[data-wa-pick]').forEach((b) => {
    b.onclick = () => {
      const c = list.find((x) => x.id === b.dataset.waPick);
      if (!c) return;
      closeModal();
      setTimeout(() => openWaModal({
        record: c, clientId: c.id, isClient: true,
        company: c.company, contactName: c.contactName, country: c.country,
      }), 260);
    };
  });
  bind();
  q.oninput = () => {
    const kw = q.value.trim().toLowerCase();
    document.querySelectorAll('[data-wa-pick]').forEach((b) => {
      const c = list.find((x) => x.id === b.dataset.waPick) || {};
      const hit = !kw || [c.company, c.country, c.contactName].some((v) => String(v || '').toLowerCase().includes(kw));
      b.style.display = hit ? '' : 'none';
    });
  };
  q.focus();
}

// ---- 给客户表单用的「区号 + 号码」组合字段 ----
// rec 已有 waDial 用它；否则按已填国家自动预选，减少手工选择
function waFieldHtml(rec) {
  const r = rec || {};
  const dial = waDigits(r.waDial) || waDialOf(r) || '';
  const local = waDigits(r.waPhone) || '';
  const opts = ['<option value="">— 选区号 —</option>']
    .concat(WA_DIALS.map((d) => '<option value="' + d.c + '"' + (d.c === dial ? ' selected' : '') + '>+' + d.c + ' ' + esc(d.n) + '</option>')).join('');
  return `<div class="field">
    <label>WhatsApp <span class="muted">（区号 + 号码，不含 0）</span></label>
    <div class="wa-inline">
      <select name="waDial">${opts}</select>
      <input name="waPhone" value="${esc(local)}" placeholder="如 9123456789" inputmode="numeric" />
    </div>
  </div>`;
}

// 客户档案里显示的一行：号码 + 当地时间
function waDetailHtml(rec) {
  if (!waHasNumber(rec)) return '';
  const clk = waLocalClock(waDialOf(rec));
  const clock = clk ? ` <span class="wa-dot wa-${clk.level}"></span><span class="muted">当地 ${clk.wdText} ${clk.time}</span>` : '';
  return `<b>${esc(waPretty(rec))}</b>${clock}`;
}

// 我方公司名（用于 {{我司}}）：复用报价单模块里的卖方抬头，避免两处维护
function waMyCompany() {
  try {
    if (typeof SELLER_DEFAULT !== 'undefined' && SELLER_DEFAULT && SELLER_DEFAULT.nameEn) return SELLER_DEFAULT.nameEn;
  } catch { /* ignore */ }
  return 'Your Company';
}

window.openWaModal = openWaModal;
window.openWaPicker = openWaPicker;
window.waFieldHtml = waFieldHtml;
window.waDetailHtml = waDetailHtml;
window.waHasNumber = waHasNumber;
window.waFullNumber = waFullNumber;
window.waPretty = waPretty;
window.waBtnHtml = waBtnHtml;
window.waLocalClock = waLocalClock;
window.waDialOf = waDialOf;
window.waQuick = waQuick;
window.WA_DIALS = WA_DIALS;
