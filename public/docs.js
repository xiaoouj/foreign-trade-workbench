// ====== 单证生成模块（按公司原文件排版，对齐 PI-ST06250056 真实格式）======
// 复用 app.js 全局：rateData, rateOf, clients, CURRENCIES, COUNTRIES, esc, toast, todayStr, loadRates, LS
const DOC_TITLE = {
  quotation: { en: 'QUOTATION', cn: '报价单' },
  pi: { en: 'PROFORMA INVOICE', cn: '形式发票' },
  contract: { en: 'SALES CONTRACT', cn: '销售合同' },
  ci: { en: 'COMMERCIAL INVOICE', cn: '商业发票' },
  packing: { en: 'PACKING LIST', cn: '装箱单' },
};
const LMAP = {
  contractNo: { en: 'CONTRACT №', cn: '合同号' },
  date: { en: 'DATE', cn: '日期' },
  to: { en: 'TO', cn: '买方' },
  summary: { en: 'BILLING SUMMARY', cn: '账单明细' },
  intro: { en: 'BOTH THE VENDOR AND BUYER AGREE TO THE TERMS AND CONDITIONS STIPULATED IN THIS QUOTATION:', cn: '买卖双方同意按以下条款完成本单交易：' },
  marks: { en: 'MARKS', cn: '唛头' },
  container: { en: 'Container No.', cn: '集装箱号' },
  description: { en: 'Description', cn: '品名规格' },
  qty: { en: 'QTY', cn: '数量' },
  pcs: { en: 'PCS', cn: '件数' },
  pack: { en: 'PACK', cn: '包装' },
  unit: { en: 'Unit', cn: '单位' },
  unitPrice: { en: 'Unit Price', cn: '单价' },
  amount: { en: 'Amount', cn: '总价' },
  total: { en: 'TOTAL', cn: '合计' },
  nw: { en: 'N.W.(KGS)', cn: '净重(kg)' },
  gw: { en: 'G.W.(KGS)', cn: '毛重(kg)' },
  tnw: { en: 'T.NW(KGS)', cn: '总净重' },
  tgw: { en: 'T.GW(KGS)', cn: '总毛重' },
  dim: { en: 'L(m) W(m) H(m)', cn: '长(m)宽(m)高(m)' },
  cbm: { en: 'T.CBM', cn: '总体积' },
  seller: { en: 'SELLER', cn: '卖方' },
  buyer: { en: 'BUYER', cn: '买方' },
  bank: { en: 'Bank Information', cn: '银行信息' },
  afterSales: { en: 'After-sales service', cn: '售后服务' },
  madeInChina: { en: 'MADE IN CHINA', cn: '中国制造' },
};
const SELLER_DEFAULT = {
  "nameEn": "",
  "nameCn": "",
  "addrEn": "",
  "addrCn": "",
  "contact": "",
  "email": "",
  "tel": "",
  "telCn": "",
  "fax": "",
  "zip": "",
  "bankEn": "",
  "bankCn": ""
};

let docType = 'quotation';
let docItems = [];
let docNotesDefault = '';
let docAfterDefault = '';
let docLang = 'en';
let docLogo = LS.get('logo', '');
let docShowTotal = true;

const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');
const money = (n, cur) => {
  if (n == null || n === '' || isNaN(n)) return '—';
  const v = Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = cur === 'CNY' || cur === 'RMB' ? '¥' : cur === 'USD' ? '$' : (cur || '');
  return sym ? `${sym} ${v}` : v;
};
const num = (n) => (n == null || n === '' || isNaN(n) ? '0' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

function L(key) {
  const o = LMAP[key]; if (!o) return key;
  if (docLang === 'cn') return o.cn;
  if (docLang === 'bi') return `${o.en} / ${o.cn}`;
  return o.en;
}
function T(type) {
  const o = DOC_TITLE[type];
  if (docLang === 'cn') return o.cn;
  if (docLang === 'bi') return `${o.en} ${o.cn}`;
  return o.en;
}
function sellerName() { return docLang === 'cn' ? SELLER_DEFAULT.nameCn : (docLang === 'bi' ? `${SELLER_DEFAULT.nameEn} / ${SELLER_DEFAULT.nameCn}` : SELLER_DEFAULT.nameEn); }
function sellerAddr() { return docLang === 'cn' ? SELLER_DEFAULT.addrCn : (docLang === 'bi' ? `${SELLER_DEFAULT.addrEn} / ${SELLER_DEFAULT.addrCn}` : SELLER_DEFAULT.addrEn); }
function sellerTel() { return docLang === 'cn' ? SELLER_DEFAULT.telCn : SELLER_DEFAULT.tel; }

// 人民币大写（中文）
function digitToCN(money) {
  money = Math.round((Number(money) || 0) * 100) / 100;
  if (!isFinite(money)) return '';
  const cnNums = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const cnIntUnits = ['', '拾', '佰', '仟'];
  const cnBigUnits = ['', '万', '亿', '兆'];
  const neg = money < 0; money = Math.abs(money);
  const integer = Math.floor(money);
  const decimal = Math.round((money - integer) * 100);
  if (integer === 0 && decimal === 0) return '零元整';
  let res = '';
  if (integer > 0) {
    const str = String(integer); const len = str.length; let zero = false;
    for (let i = 0; i < len; i++) {
      const dig = +str[i]; const pos = len - 1 - i;
      if (dig === 0) { zero = true; }
      else { if (zero && res !== '') res += cnNums[0]; res += cnNums[dig] + cnIntUnits[pos % 4]; zero = false; }
      if (pos % 4 === 0 && pos > 0) { res += cnBigUnits[Math.floor(pos / 4)]; zero = false; }
    }
    res += '元';
  }
  if (decimal > 0) { const jiao = Math.floor(decimal / 10); const fen = decimal % 10; if (jiao > 0) res += cnNums[jiao] + '角'; if (fen > 0) res += cnNums[fen] + '分'; }
  else if (integer > 0) res += '整';
  return (neg ? '负' : '') + res;
}

// 英文大写（PI 参考样式：THIRTY-FIVE THOUSAND ONLY）
function digitToEN(n) {
  n = Math.floor(Number(n) || 0);
  if (n === 0) return 'ZERO';
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
  const teens = ['TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const under1000 = (x) => {
    let s = '';
    if (x >= 100) { s += ones[Math.floor(x / 100)] + ' HUNDRED'; x %= 100; if (x) s += ' '; }
    if (x >= 20) { s += tens[Math.floor(x / 10)]; x %= 10; if (x) s += '-' + ones[x]; }
    else if (x >= 10) s += teens[x - 10];
    else if (x > 0) s += ones[x];
    return s;
  };
  const parts = [];
  let m = Math.floor(n / 1000000); n %= 1000000;
  if (m) parts.push(under1000(m) + ' MILLION');
  let k = Math.floor(n / 1000); n %= 1000;
  if (k) parts.push(under1000(k) + ' THOUSAND');
  if (n) parts.push(under1000(n));
  return parts.join(' ').trim();
}

const DOC_CSS = `
.doc{font-family:'Times New Roman','SimSun','宋体',serif;color:#111;font-size:12px;line-height:1.5;}
.doc-logo{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.doc-logo img{max-height:40px;max-width:140px;object-fit:contain;}
.doc-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1f3a8a;padding-bottom:8px;gap:12px;}
.doc-title{text-align:center;font-size:22px;font-weight:800;color:#1f3a8a;letter-spacing:1px;flex:1;}
.doc-head-right{text-align:right;font-size:11px;line-height:1.5;}
.doc-head-right b{font-size:12px;}
.doc-parties2{display:flex;gap:24px;margin:10px 0;font-size:11px;line-height:1.55;}
.doc-parties2 .party{flex:1;}
.doc-parties2 .seller{text-align:left;}
.doc-parties2 .buyer{text-align:right;}
.doc-parties2 .pt{font-weight:800;margin-bottom:4px;font-size:12px;letter-spacing:.5px;}
.doc-parties2 .pname{font-weight:700;margin-bottom:3px;font-size:12px;}
.doc-intro{text-align:left;margin:10px 0 6px;font-size:11px;font-weight:600;}
.doc-sumtitle{text-align:center;font-size:13px;font-weight:800;margin:4px 0 8px;letter-spacing:2px;color:#1f3a8a;}
table.doc-items{width:100%;border-collapse:collapse;margin:6px 0;font-size:10.5px;}
table.doc-items th,table.doc-items td{border:1px solid #999;padding:4px 5px;vertical-align:top;}
table.doc-items th{background:#1f3a8a;color:#fff;text-align:center;font-size:10px;font-weight:700;letter-spacing:.3px;}
table.doc-items td.r,table.doc-items th.r{text-align:right;}
table.doc-items td.c,table.doc-items th.c{text-align:center;}
table.doc-items td.pre{white-space:pre-wrap;line-height:1.35;}
table.doc-items img.doc-thumb{max-height:46px;max-width:60px;object-fit:contain;}
.doc-saytotal{display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;font-size:11px;}
.doc-saytotal .say{font-weight:700;}
.doc-saytotal .total-right{font-size:13px;font-weight:800;}
.doc-terms,.doc-aftersales,.doc-bank{font-size:11px;margin-top:8px;white-space:pre-wrap;line-height:1.55;}
.doc-bank{border-top:1px dashed #ccc;padding-top:6px;}
.doc-aftersales b,.doc-bank b{font-weight:800;letter-spacing:.5px;}
.doc-sign{display:flex;justify-content:space-between;margin-top:36px;font-size:11px;}
.doc-sign > div{width:46%;}
.doc-sign .ln{margin-top:16px;}
@media print{ @page{size:A4;margin:14mm;} body{margin:0;} *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; } }
`;

function defaultItem() {
  if (docType === 'packing') return { container: '', description: '', qty: 1, pcs: 1, pack: 'CTNS', nw: 0, gw: 0, l: 0, w: 0, h: 0 };
  return { name: '', parameters: '', qty: 1, unit: 'SET', unitPrice: 0, discountedPrice: '', img: '' };
}
const DOC_PREFIX = {quotation:'QT',pi:'PI',contract:'SC',ci:'CI',packing:'PL'};
function suggestDocNo(type) { return ''; }
function updateDocNumberHint() {
  const input=$('#d_docNo'),hint=$('#d_docNoHint');if(!input||!hint)return;
  const year=String(new Date().getFullYear()).slice(-2),prefix=DOC_PREFIX[docType]||'QT';
  input.placeholder='例如 '+prefix+'-'+year+'001';
  hint.textContent='按公司自己的编号规则填写；示例：单据类型 + 年份 + 序号。';
}

function defaultNotes(type, lang) {
  const enBank = SELLER_DEFAULT.bankEn;
  const cnBank = SELLER_DEFAULT.bankCn;
  if (type === 'pi') {
    const en = `1. The above quotation is EXW seller factory price, valid for 10 days.
2. Package: Nude packing.
3. Place of delivery: Seller's factory.
4. Payment term: 100% to be paid in advance, all the bank charge to be paid by buyer.
5. Delivery Time: About 20 working days after receiving the deposit payment.
6. Shipping Marks: N/M.
7. Without affecting the use of structure and function, the Seller has the right to change the equipment specifications mentioned in the contract list according to the actual use scenario. The final change will be proposed to the Buyer and then modified with the Buyer's written consent.
8. Remarks: In the communication of equipment parameters or during the production process, if significant cost modifications are required due to customer requests, it is necessary to recalculate the actual expenses.`;
    const cn = `1. 以上报价为卖方工厂 EXW 价，有效期 10 天。
2. 包装：裸装。
3. 交付地点：卖方工厂。
4. 付款方式：100% 预付，所有银行费用由买方承担。
5. 交期：收到定金后约 20 个工作日。
6. 唛头：N/M。
7. 在不影响结构与功能使用的前提下，卖方有权按实际使用场景调整合同清单中的设备规格，最终变更需经买方书面同意。
8. 备注：在设备参数沟通或生产过程中，如因客户需求导致成本发生重大变更，需重新核算实际费用。`;
    if (lang === 'cn') return cn; if (lang === 'bi') return en + '\n\n' + cn; return en;
  }
  if (type === 'quotation' || type === 'contract') {
    const en = `1. Quality: according to standard, 1 year warranty.
2. Delivery: 30-35 working days after receipt of deposit.
3. Shipment/Installation: buyer responsible for freight, excluding installation.
4. Payment: 30% deposit, 70% before shipment.`;
    const cn = `一：质量要求：按标准，保修一年。
二：交货时间：收到订金之日起 30-35 个工作日。
三：运输/安装：购方负责货物运输，不含安装调试。
四：结算方式：预付 30%，发货前付清全款。`;
    if (lang === 'cn') return cn; if (lang === 'bi') return en + '\n\n' + cn; return en;
  }
  if (type === 'ci') {
    const en = `We hereby certify that this invoice shows the actual price of the goods described and that all particulars are true and correct.`;
    const cn = `兹证明本发票所列货物价格属实，所有内容正确无误。`;
    if (lang === 'cn') return cn; if (lang === 'bi') return en + '\n\n' + cn; return en;
  }
  if (type === 'packing') return 'Total number of packages, net and gross weight as stated above.';
  return '';
}
function defaultAfterSales(lang) {
  const en = `1. Online guidance maintenance, build a group or video conference guidance.
2. Warranty: Non human damage, one year warranty.
3. On-site service (if required): In case on-site guidance and adjustments are needed, our company can dispatch the after-sales team. This service will incur additional costs, which will be based on actual expenses (such as travel, accommodation, and labor costs). These expenses will be communicated in advance and agreed upon by both parties before the dispatch.`;
  const cn = `1. 在线指导维护，建立群聊或视频会议指导。
2. 保修期：非人为损坏，一年保修。
3. 现场服务（如需）：如需现场指导与调整，我司可派售后团队。此项服务将产生额外费用，按实际开支计算（含差旅、食宿、人工），费用事前沟通并经双方同意后派遣。`;
  if (lang === 'cn') return cn; if (lang === 'bi') return en + '\n\n' + cn; return en;
}

function renderItems() {
  const wrap = $('#d_items');
  if (docType === 'packing') {
    const head = `<div class="irow ihead cols-pack"><span>${L('container')}</span><span>${L('description')}</span><span>${L('qty')}</span><span>${L('pcs')}</span><span>${L('pack')}</span><span>${L('nw')}</span><span>${L('gw')}</span><span>L</span><span>W</span><span>H</span><span></span></div>`;
    const rows = docItems.map((it, idx) => `<div class="irow cols-pack" data-idx="${idx}">
      <input data-f="container" value="${esc(it.container)}" placeholder="集装箱号"/>
      <textarea data-f="description" rows="2" placeholder="品名/规格">${esc(it.description)}</textarea>
      <input data-f="qty" type="number" value="${esc(it.qty)}" class="n"/>
      <input data-f="pcs" type="number" value="${esc(it.pcs)}" class="n"/>
      <input data-f="pack" value="${esc(it.pack)}"/>
      <input data-f="nw" type="number" step="0.01" value="${esc(it.nw)}" class="n"/>
      <input data-f="gw" type="number" step="0.01" value="${esc(it.gw)}" class="n"/>
      <input data-f="l" type="number" step="0.01" value="${esc(it.l)}" class="n"/>
      <input data-f="w" type="number" step="0.01" value="${esc(it.w)}" class="n"/>
      <input data-f="h" type="number" step="0.01" value="${esc(it.h)}" class="n"/>
      <button class="delrow" data-idx="${idx}">×</button>
    </div>`).join('');
    wrap.innerHTML = head + rows;
  } else {
    // 价格类：每个明细 2 行（产品名 + 参数）
    const head = `<div class="irow ihead cols-pri"><span>${L('description')}</span><span>${L('qty')}</span><span>${L('unit')}</span><span>${L('unitPrice')}</span><span>图片</span><span></span></div>`;
    const rows = docItems.map((it, idx) => `<div class="irow-item" data-idx="${idx}">
      <div class="irow-line cols-pri">
        <input data-f="name" value="${esc(it.name)}" placeholder="产品名 PRODUCT"/>
        <input data-f="qty" type="number" value="${esc(it.qty)}" class="n"/>
        <input data-f="unit" value="${esc(it.unit)}"/>
        <input data-f="unitPrice" type="number" step="0.01" value="${esc(it.unitPrice)}" class="n"/>
        <button class="imgbtn" data-idx="${idx}">${it.img ? '📷✓' : '📷'}</button>
        <input type="file" class="imgfile" data-idx="${idx}" accept="image/*" hidden>
        <button class="delrow" data-idx="${idx}">×</button>
      </div>
      <textarea data-f="parameters" rows="3" placeholder="产品参数 PRODUCT PARAMETERS（如：1. Power: ...  2. Material: ...）">${esc(it.parameters)}</textarea>
    </div>`).join('');
    wrap.innerHTML = head + rows;
  }
  const itemLabels = {name:'产品名称',description:'品名 / 规格',parameters:'产品参数',qty:'数量',unit:'单位',unitPrice:'单价',container:'集装箱号',pcs:'件数',pack:'包装',nw:'净重',gw:'毛重',l:'长',w:'宽',h:'高'};
  wrap.querySelectorAll('[data-f]').forEach(input => {
    const label=document.createElement('label'); label.className='doc-item-field field-'+input.dataset.f;
    const text=document.createElement('span');text.textContent=itemLabels[input.dataset.f] || input.dataset.f;
    input.before(label);label.append(text,input);
  });
  wrap.querySelectorAll('.imgbtn').forEach(b=>{b.title='上传产品图片';b.setAttribute('aria-label','上传产品图片');});
  wrap.querySelectorAll('.delrow').forEach(b=>{b.title='删除此明细';b.setAttribute('aria-label','删除此明细');});
  wrap.querySelectorAll('.delrow').forEach((b) => (b.onclick = () => { docItems.splice(+b.dataset.idx, 1); renderItems(); renderPreview(); }));
  wrap.querySelectorAll('input[data-f],textarea[data-f]').forEach((inp) => (inp.oninput = () => {
    const idx = +inp.closest('.irow-item,.irow').dataset.idx;
    const f = inp.dataset.f;
    if (f === 'qty' || f === 'unitPrice' || f === 'nw' || f === 'gw' || f === 'l' || f === 'w' || f === 'h' || f === 'pcs') docItems[idx][f] = inp.value === '' ? '' : Number(inp.value);
    else docItems[idx][f] = inp.value;
    renderPreview();
  }));
  wrap.querySelectorAll('.imgbtn').forEach((b) => (b.onclick = () => {
    const idx = +b.dataset.idx;
    const fi = wrap.querySelector(`.imgfile[data-idx="${idx}"]`);
    if (fi) fi.click();
    if (fi) fi.onchange = () => {
      const file = fi.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { docItems[idx].img = rd.result; b.textContent = '📷✓'; renderPreview(); };
      rd.readAsDataURL(file);
    };
  }));
}

function collectDoc() {
  return {
    type: docType, lang: docLang, logo: docLogo, showTotal: docShowTotal,
    docNo: val('d_docNo'), date: val('d_date'),
    currency: val('d_currency'), rate: parseFloat(val('d_rate')) || null,
    tradeTerm: val('d_tradeTerm'), payment: val('d_payment'), delivery: val('d_delivery'),
    seller: { name: val('s_name'), addr: val('s_addr'), contact: val('s_contact'), email: val('s_email'), tel: val('s_tel'), bank: val('s_bank') },
    buyer: { name: val('b_name'), country: val('b_country'), addr: val('b_addr'), contact: val('b_contact'), email: val('b_email'), tel: val('b_tel'), nif: val('b_nif'), lc: val('b_lc') },
    items: docItems.map((it) => {
      const qty = Number(it.qty) || 0;
      const up = Number(it.unitPrice) || 0;
      const dp = (it.discountedPrice === '' || it.discountedPrice == null) ? up : Number(it.discountedPrice);
      // SUM 按折扣后单价计算（与 PI 一致）
      return { ...it, amount: qty * dp, discountedPrice: dp };
    }),
    notes: val('d_notes'),
    afterSales: val('d_afterSales'),
  };
}

function priceTable(d, cur) {
  const cols = ['No.', 'PRODUCT', 'PICTURE', 'PRODUCT PARAMETERS', 'QTY/SET', 'UNIT',
    `UNIT PRICE (${cur})`, `DISCOUNTED UNIT PRICE (${cur})`, `SUM (${cur})`];
  const head = `<tr>${cols.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  const rows = d.items.map((it, i) => `<tr>
    <td class="c">${i + 1}</td>
    <td class="pre">${esc(it.name) || '—'}</td>
    <td class="c">${it.img ? `<img class="doc-thumb" src="${it.img}">` : ''}</td>
    <td class="pre">${esc(it.parameters) || '—'}</td>
    <td class="c">${esc(it.qty)}</td>
    <td class="c">${esc(it.unit) || ''}</td>
    <td class="r">${money(it.unitPrice, cur)}</td>
    <td class="r">${money(it.discountedPrice, cur)}</td>
    <td class="r">${money(it.amount, cur)}</td>
  </tr>`).join('');
  return `<table class="doc-items"><thead>${head}</thead><tbody>${rows || `<tr><td colspan="${cols.length}" class="c">—</td></tr>`}</tbody></table>`;
}

function packTable(d) {
  const head = [L('marks'), L('container'), L('description'), L('qty'), L('pcs'), L('pack'), L('nw'), L('gw'), L('tnw'), L('tgw'), L('dim'), L('cbm')];
  const th = `<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  let cnw = 0, cgw = 0, ccbm = 0;
  const rows = d.items.map((it) => {
    const nw = Number(it.nw) || 0, gw = Number(it.gw) || 0;
    const cbm = (Number(it.l) || 0) * (Number(it.w) || 0) * (Number(it.h) || 0);
    cnw += nw; cgw += gw; ccbm += cbm;
    return `<tr>
      <td class="pre">${esc(d.marks) || '—'}</td>
      <td>${esc(it.container) || '—'}</td>
      <td class="pre">${esc(it.description) || '—'}</td>
      <td class="c">${esc(it.qty)}</td>
      <td class="c">${esc(it.pcs)}</td>
      <td class="c">${esc(it.pack) || ''}</td>
      <td class="r">${num(nw)}</td>
      <td class="r">${num(gw)}</td>
      <td class="r">${num(cnw)}</td>
      <td class="r">${num(cgw)}</td>
      <td class="c">${num(it.l)} ${num(it.w)} ${num(it.h)}</td>
      <td class="r">${num(ccbm)}</td>
    </tr>`;
  }).join('');
  return `<table class="doc-items"><thead>${th}</thead><tbody>${rows || `<tr><td colspan="12" class="c">—</td></tr>`}</tbody></table>
    <div class="doc-saytotal"><span>T.NW: <b>${num(cnw)} kg</b> &nbsp; T.GW: <b>${num(cgw)} kg</b> &nbsp; T.CBM: <b>${num(ccbm)} m³</b></span><span></span></div>`;
}

function buildInner(d) {
  const cur = d.currency || 'USD';
  const total = d.items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const curName = cur;
  const capLabel = d.lang === 'cn' ? digitToCN(total) : digitToEN(total);
  const s_ = d.seller, b_ = d.buyer;

  let h = `<div class="doc">`;
  // Logo（可选）
  if (d.logo) h += `<div class="doc-logo"><img src="${d.logo}"></div>`;
  // Header：居中标题 + 右上合同号/日期
  h += `<div class="doc-header">
    <div style="flex:0 0 60px"></div>
    <div class="doc-title">${T(d.type)}</div>
    <div class="doc-head-right">
      <div>${L('contractNo')}: <b>${esc(d.docNo)}</b></div>
      <div>${L('date')}: ${esc(d.date)}</div>
    </div>
  </div>`;
  // Parties：左 REMIT TO，右 BILL TO
  h += `<div class="doc-parties2">
    <div class="party seller">
      <div class="pt">REMIT TO：</div>
      <div class="pname">${esc(s_.name) || esc(sellerName())}</div>
      <div class="paddr">${esc(s_.addr) || esc(sellerAddr())}</div>
      <div>Contact：${esc(s_.contact) || SELLER_DEFAULT.contact}　　TEL：${esc(s_.tel) || SELLER_DEFAULT.tel}</div>
      <div>Email：${esc(s_.email) || SELLER_DEFAULT.email}</div>
    </div>
    <div class="party buyer">
      <div class="pt">BILL TO：</div>
      <div>Customer#：<b>${esc(b_.name) || '—'}</b></div>
      <div>Contact：${esc(b_.contact) || '—'}</div>
      <div>Tel：${esc(b_.tel) || '—'}</div>
      <div>Email：${esc(b_.email) || '—'}</div>
      <div>Address：${esc(b_.addr) || '—'}</div>
    </div>
  </div>`;
  // 简介行 + BILLING SUMMARY 标题（价格类）
  if (d.type !== 'packing') {
    h += `<div class="doc-intro">${esc(L('intro'))}</div>`;
    h += `<div class="doc-sumtitle">${L('summary')}</div>`;
  }
  // 明细表
  h += d.type === 'packing' ? packTable(d) : priceTable(d, cur);
  // SAY TOTAL + Total（价格类）
  if (d.showTotal && d.type !== 'packing') {
    let extra = '';
    if (cur !== 'CNY' && cur !== 'RMB' && d.rate) {
      const r = total * Number(d.rate);
      extra = `<div class="doc-saytotal" style="margin-top:-4px"><span></span><span>折合 CNY：<b>¥ ${Math.round(r).toLocaleString()}</b> <span style="color:#666">(rate ${d.rate})</span></span></div>`;
    }
    h += `<div class="doc-saytotal">
      <span class="say">SAY TOTAL ${curName} ${capLabel} ONLY</span>
      <span class="total-right">Total <b>${money(total, cur)}</b></span>
    </div>${extra}`;
  }
  // Terms / 条款
  if (d.notes) h += `<div class="doc-terms">${esc(d.notes).replace(/\n/g, '<br>')}</div>`;
  // After-sales（PI）
  if (d.type === 'pi' && d.afterSales) h += `<div class="doc-aftersales"><b>${L('afterSales')}：</b><br>${esc(d.afterSales).replace(/\n/g, '<br>')}</div>`;
  // Bank（PI / CI）
  if (d.type !== 'packing' && d.seller.bank) h += `<div class="doc-bank"><b>${L('bank')}：</b><br>${esc(d.seller.bank).replace(/\n/g, '<br>')}</div>`;
  // 签名
  h += `<div class="doc-sign">
    <div>
      <div><b>BUYER：</b>${esc(d.buyer.name) || '—'}</div>
      <div class="ln">REPRESENTATIE：</div>
      <div class="ln">STAMP&amp;SIGNATURE：</div>
      <div class="ln">DATE：</div>
    </div>
    <div>
      <div><b>SELLER：</b>${esc(d.seller.name) || esc(sellerName())}</div>
      <div class="ln">REPRESENTATIE：</div>
      <div class="ln">STAMP&amp;SIGNATURE：</div>
      <div class="ln">DATE：</div>
    </div>
  </div>`;
  h += `</div>`;
  return h;
}

function renderPreview() {
  updateDocNumberHint();
  $('#d_preview').innerHTML = `<style>${DOC_CSS}</style>` + buildInner(collectDoc());
}
function printDoc() {
  if (!val('d_docNo').trim()) {toast('请先填写单号');$('#d_docNo').focus();return;} 
  const d = collectDoc();
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(d.docNo)}</title><style>${DOC_CSS}</style></head><body>${buildInner(d)}</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('请允许浏览器弹出窗口以打印/另存为 PDF'); return; }
  w.document.open(); w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 400);
}

function applyRate(force) {
  const cur = val('d_currency');
  if (rateData && cur) {
    const r = rateOf(cur, 'CNY');
    if (r != null && (force || !val('d_rate'))) $('#d_rate').value = r.toFixed(4);
  }
}
function applyLangDefaults() {
  $('#s_name').value = docLang === 'cn' ? SELLER_DEFAULT.nameCn : (docLang === 'bi' ? `${SELLER_DEFAULT.nameEn} / ${SELLER_DEFAULT.nameCn}` : SELLER_DEFAULT.nameEn);
  $('#s_addr').value = docLang === 'cn' ? SELLER_DEFAULT.addrCn : (docLang === 'bi' ? `${SELLER_DEFAULT.addrEn} / ${SELLER_DEFAULT.addrCn}` : SELLER_DEFAULT.addrEn);
  $('#s_tel').value = docLang === 'cn' ? SELLER_DEFAULT.telCn : SELLER_DEFAULT.tel;
  if (!$('#s_bank').value) $('#s_bank').value = docLang === 'cn' ? SELLER_DEFAULT.bankCn : SELLER_DEFAULT.bankEn;
  $('#s_contact').value = docLang === 'cn' ? SELLER_DEFAULT.contact : SELLER_DEFAULT.contact;
  $('#s_email').value = docLang === 'cn' ? SELLER_DEFAULT.email : SELLER_DEFAULT.email;
}

function toggleAfterSales() {
  const w = document.getElementById('d_afterSales_wrap');
  if (w) w.style.display = docType === 'pi' ? '' : 'none';
}

function initDocs() {
  const cs = $('#d_currency');
  cs.innerHTML = CURRENCIES.map((c) => `<option ${c === 'USD' ? 'selected' : ''}>${c}</option>`).join('');
  const cl = $('#d_client');
  cl.innerHTML = '<option value="">— 手动输入 —</option>' + clients.map((c) => `<option value="${c.id}">${esc(c.company)}</option>`).join('');

  if (docLogo) { const p = $('#d_logo_preview'); p.src = docLogo; p.classList.remove('hidden'); }
  $('#d_logo').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { docLogo = rd.result; LS.set('logo', docLogo); const p = $('#d_logo_preview'); p.src = docLogo; p.classList.remove('hidden'); renderPreview(); };
    rd.readAsDataURL(f);
  });

  applyLangDefaults();
  $('#d_date').value = todayStr();
  $('#d_docNo').value = suggestDocNo('quotation');
  $('#d_tradeTerm').value = 'FOB Shenzhen';
  $('#d_payment').value = 'T/T 50% deposit, 50% before shipment';
  $('#d_delivery').value = '35 working days after deposit';
  $('#d_showTotal').checked = true; docShowTotal = true;
  docItems = [defaultItem()];
  docNotesDefault = defaultNotes('quotation', 'en');
  docAfterDefault = defaultAfterSales('en');
  $('#d_notes').value = docNotesDefault;
  $('#d_afterSales').value = docAfterDefault;
  toggleAfterSales();

  $$('.doc-type').forEach((b) => b.addEventListener('click', () => {
    $$('.doc-type').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    docType = b.dataset.doctype;
    if (/^(QT|PI|SC|CI|PL)-ST/.test($('#d_docNo').value)) $('#d_docNo').value = $('#d_docNo').value.replace(/^(QT|PI|SC|CI|PL)/, DOC_PREFIX[docType]);
    const nd = defaultNotes(docType, docLang);
    const ad = docType === 'pi' ? defaultAfterSales(docLang) : '';
    if (!val('d_notes') || val('d_notes') === docNotesDefault) $('#d_notes').value = nd;
    docNotesDefault = nd;
    if (docType === 'pi' && (!val('d_afterSales') || val('d_afterSales') === docAfterDefault)) $('#d_afterSales').value = ad;
    docAfterDefault = ad;
    toggleAfterSales();
    renderItems(); renderPreview();
  }));

  $('#d_lang').addEventListener('change', () => {
    docLang = $('#d_lang').value;
    applyLangDefaults();
    const nd = defaultNotes(docType, docLang);
    const ad = docType === 'pi' ? defaultAfterSales(docLang) : '';
    if (!val('d_notes') || val('d_notes') === docNotesDefault) $('#d_notes').value = nd;
    docNotesDefault = nd;
    if (docType === 'pi' && (!val('d_afterSales') || val('d_afterSales') === docAfterDefault)) $('#d_afterSales').value = ad;
    docAfterDefault = ad;
    renderItems(); renderPreview();
  });

  $('#d_showTotal').addEventListener('change', () => { docShowTotal = $('#d_showTotal').checked; renderPreview(); });

  $('#d_addItem').addEventListener('click', () => { docItems.push(defaultItem()); renderItems(); renderPreview(); });
  $('#d_print').addEventListener('click', printDoc);

  cl.addEventListener('change', () => {
    const c = clients.find((x) => x.id === cl.value);
    if (c) {
      $('#b_name').value = c.company || '';
      $('#b_country').value = c.country || '';
      $('#b_addr').value = c.address || c.addr || '';
      $('#b_nif').value = c.nif || c.taxId || '';
      $('#b_lc').value = '';
      $('#b_contact').value = c.contactName || '';
      $('#b_email').value = c.contactEmail || '';
      $('#b_tel').value = c.contactPhone || '';
    }
  });

  cs.addEventListener('change', () => { applyRate(true); renderPreview(); });

  $('#view-docs').addEventListener('input', (e) => { if (e.target.closest('#d_items')) return; renderPreview(); });
  $('#view-docs').addEventListener('change', (e) => { if (e.target.closest('#d_items')) return; renderPreview(); });

  $('[data-view="docs"]').addEventListener('click', () => {
    refreshDocClients();
    applyRate(false); renderPreview();
  });

  renderItems();
  renderPreview();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDocs);
else initDocs();

// 从报价记录加载到单证生成页
function loadQuoteIntoDoc(q) {
  if (!q) return;
  // 切换到报价单
  const qtBtn = document.querySelector('.doc-type[data-doctype="quotation"]');
  if (qtBtn) qtBtn.click();
  // 基础字段
  $('#d_docNo').value = q.quoteNo || suggestDocNo('quotation');
  $('#d_date').value = q.createdAt ? new Date(q.createdAt).toISOString().slice(0, 10) : todayStr();
  if (q.currency && [...$('#d_currency').options].some((o) => o.value === q.currency)) $('#d_currency').value = q.currency;
  applyRate(false);
  // 客户
  const linked = clients.find((c) => c.id === q.clientId || c.company === q.clientName);
  if (linked && $('#d_client')) {
    $('#d_client').value = linked.id;
    $('#b_name').value = linked.company || '';
    $('#b_country').value = linked.country || '';
    $('#b_contact').value = q.contactName || linked.contactName || '';
    $('#b_email').value = linked.contactEmail || '';
    $('#b_tel').value = linked.contactPhone || '';
  } else {
    $('#d_client').value = '';
    $('#b_country').value = q.country || '';
    $('#b_email').value = q.contactEmail || '';
    $('#b_tel').value = q.contactPhone || '';
    $('#b_name').value = q.clientName || '';
    $('#b_contact').value = q.contactName || '';
  }
  // 付款/交期/备注
  $('#d_payment').value = q.paymentTerms || (q.depositPercent==null?'':`${q.depositPercent}% deposit, ${100-q.depositPercent}% balance`);
  $('#d_tradeTerm').value=q.tradeTerms||'';
  $('#d_delivery').value = q.deliveryDays ? q.deliveryDays + ' working days after deposit' : '';
  $('#d_notes').value = q.notes || '';
  // 分项
  docItems = (q.items || []).map((it) => ({
    name: it.name || '',
    parameters: it.description || '',
    qty: Number(it.qty) || 1,
    unit: it.unit || 'SET',
    unitPrice: Number(it.unitPrice) || 0,
    img: '',
  }));
  if (!docItems.length) docItems = [defaultItem()];
  renderItems();
  renderPreview();
  toast('已加载报价单：' + (q.quoteNo || ''));
}
window.loadQuoteIntoDoc = loadQuoteIntoDoc;
// Buyer refresh across sidebar, quick links and newly loaded client records.
function refreshDocClients() {
  const select=$('#d_client');if(!select)return;
  const selected=select.value;
  select.innerHTML='<option value="">— 手动输入 —</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.company)}${c.country?' · '+esc(c.country):''}</option>`).join('');
  select.value=clients.some(c=>c.id===selected)?selected:'';
  const input=select.previousElementSibling?.querySelector('input');
  if(input)input.value=select.selectedOptions[0]?.text || '';
}
let docBanks=[];
async function refreshDocBanks() {
  try {
    const r=await api('/api/settings');if(!r.ok)throw Error('读取失败');
    const settings=await r.json();docBanks=Array.isArray(settings.docBankAccounts)?settings.docBankAccounts:[];
    const select=$('#d_bank'),selected=select.value;
    select.innerHTML='<option value="">当前单证 / 手动填写</option>'+docBanks.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
    select.value=docBanks.some(b=>b.id===selected)?selected:'';
    const input=select.previousElementSibling?.querySelector('input');if(input)input.value=select.selectedOptions[0]?.text || '';
    $('#d_bankStatus').textContent='账户保存到 NAS，供单证重复选用。';
  }catch {$('#d_bankStatus').textContent='暂时无法读取账户，可先手动填写，重新进入本页重试。';}
}
function editDocBank(existing) {
  openModal(existing?'编辑收款账户':'新增收款账户',`<div class="field full"><label>账户名称 *</label><input name="bankName" required value="${esc(existing?.name||'')}" placeholder="例如：美元收款账户" /></div><div class="field full"><label>完整收款信息 *</label><textarea name="bankDetails" rows="9" required placeholder="收款人名称、账号、开户银行、SWIFT、银行地址、币种等">${esc(existing?.details||'')}</textarea></div><p class="muted">保存后可重复选择，按此处内容带入单证。</p>`);
  $('#modalForm').onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.target),name=String(fd.get('bankName')||'').trim(),details=String(fd.get('bankDetails')||'').trim();if(!name||!details)return toast('请填写账户名称和收款信息');
    const button=$('#modalFoot [type="submit"]');if(button)button.disabled=true;
    try {
      const r=await api('/api/settings');if(!r.ok)throw Error('读取账户失败');
      const settings=await r.json(),list=Array.isArray(settings.docBankAccounts)?settings.docBankAccounts:[];
      const account={id:existing?.id||('bank_'+Date.now().toString(36)+'_'+Array.from(crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(36)).join('')),name,details};const i=list.findIndex(b=>b.id===account.id);if(i>=0)list[i]=account;else list.push(account);
      const saved=await api('/api/settings',{method:'PUT',body:JSON.stringify({docBankAccounts:list})});if(!saved.ok)throw Error('保存失败，请重试');
      await refreshDocBanks();$('#d_bank').value=account.id;$('#d_bank').dispatchEvent(new Event('change',{bubbles:true}));closeModal();toast('收款账户已保存');
    }catch(err){toast(err.message);}finally{if(button)button.disabled=false;}
  };
}
function bindDocConnections(){
  $('#d_bank').addEventListener('change',()=>{const b=docBanks.find(b=>b.id===$('#d_bank').value);if(b){$('#s_bank').value=b.details;renderPreview();}});
  $('#d_bankNew').onclick=()=>editDocBank();
  $('#d_bankEdit').onclick=()=>{const b=docBanks.find(b=>b.id===$('#d_bank').value);if(!b)return toast('请先选择一个已保存账户');editDocBank(b);};
  const refresh=()=>{if(location.hash==='#/docs'){refreshDocClients();refreshDocBanks();}};
  window.addEventListener('hashchange',refresh);
  $('#d_client').addEventListener('focus',refreshDocClients);
  document.addEventListener('focus',e=>{if(e.target.closest('.ftw-combo')?.nextElementSibling?.id==='d_client')refreshDocClients();},true);
  refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindDocConnections);else bindDocConnections();
