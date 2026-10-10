import { createHash } from 'node:crypto';

export const isCatalogManager = user => !!user && ['admin', 'manager'].includes(user.role);
export const key = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const str = value => String(value ?? '').trim();
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const error = (message, status = 400) => Object.assign(new Error(message), { status });
export function numberOrNull(value) {
  if (value == null || str(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function dateOrBlank(value) {
  const text = str(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(text + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === text ? text : '';
}
export function productKey(product) {
  return [product.category, product.catalogName || product.name, product.model, product.unit].map(key).join('\u001f');
}
function separatedProductName(name) {
  if (!name.includes('|')) return '';
  const parts = name.split('|').map(str).filter(Boolean);
  const first = parts.find(part => !/^\d+[.)、]?$/.test(part));
  // Recover an explicit name column, without inventing a name from specifications.
  if (first && first.length <= 80 && /输送|机|电机|泵|阀|皮带|辊|轴|齿|柜|变频|电缆|螺|模具|托盘|motor|conveyor|roller|belt|pump|valve|bearing|machine|reducer|chain|sensor|wheel|rack|tank/i.test(first)) return first;
  return '';
}
export function classifyLine(line) {
  const category = line.category, name = line.catalogName || line.name;
  if (/规格\/续行片段/.test(category)) return { disposition: 'review', reason: '规格续行，需确认所属产品' };
  if (/费用/.test(category) || /^(运费|海运费|保险费|安装费|调试费|税费|利润率|利润总额|项目总成本|进项税额|折扣|合计|总计)/.test(name)) {
    return { disposition: 'fee', reason: '服务、费用或核算项' };
  }
  if (!name || name.length > 100 || name.includes('|') || /[$¥￥€%]/.test(name)
    || !/[A-Za-z\u4e00-\u9fff]/.test(name)
    || /^&(?:[a-z]+|#\d+)/i.test(name) || /balance\s+payment|payment\s+terms|incoterms/i.test(name)
    || (name.match(/\d+\.\d+/g) || []).length >= 2
    || /^[\s、(（]*(付款方式|合同|货款|订金|备注|报价|单价|金额|payment|currency|made in|subtotal|total|validity|delivery)/i.test(name)
    || /^(\d+[.、 ]+)?(长度|宽度|高度|尺寸|容量|直径|材质|功率|电压|转速|含税|含运)\s*[:：]/.test(name)) {
    return { disposition: 'review', reason: '名称混合规格或抽取片段，需整理' };
  }
  if (/^(其他\/未分类|其他设备)$/.test(category) && !/机|设备|输送|电机|辊|轴|带|轮|泵|阀|管|齿|柜|开关|变频|电缆|螺|胶|板|架|网|模具|磨|刷|钢|密封|升降|平台|机器人|夹具|托盘|motor|conveyor|roller|belt|pump|valve|bearing|gear|shaft|machine|wheel|switch|cable|sensor|cylinder|screw|brush|frame|rack|mould|mold|nozzle|reducer|seal|chain|robot|filter|panel|tank|controller|plate|spring|coupling|block|bracket|inverter|rubber|tile/i.test(name)) {
    return { disposition: 'review', reason: '未分类名称，需确认是否为产品' };
  }
  return { disposition: 'product', reason: '' };
}

export function prepareSource(kb) {
  if (!kb || !Array.isArray(kb.full) || !Array.isArray(kb.rows) || !Array.isArray(kb.dcols) || !Array.isArray(kb.docs)) throw error('历史报价数据格式错误');
  for (const name of ['设备/物料名称', '型号/规格', '设备品类', '客户', '路径', '单价']) if (!kb.full.includes(name)) throw error('缺少来源字段：' + name);
  if (!kb.dcols.includes('路径')) throw error('缺少单据来源路径');
  if (kb.rows.some(r => !Array.isArray(r) || r.length !== kb.full.length) || kb.docs.some(r => !Array.isArray(r) || r.length !== kb.dcols.length)) throw error('来源记录字段数量不一致');
  const hash = digest(JSON.stringify(kb)), batchId = 'wb_' + hash;
  const docs = kb.docs.map((values, index) => {
    const d = Object.fromEntries(kb.dcols.map((field, i) => [field, values[i]]));
    return { id: 'hd_' + digest(batchId + ':' + index), batchId, quoteNo: str(d['报价单号']), date: dateOrBlank(d['日期']), rawDate: str(d['日期']), continent: str(d['洲']), country: str(d['国家']), clientName: str(d['客户']), kind: str(d['资料类别']), currency: str(d['币种']), tradeTerms: str(d['贸易条款']), amount: numberOrNull(d['单据总额']), validUntil: str(d['有效期']), paymentTerms: str(d['付款方式']), delivery: str(d['交期']), filename: str(d['文件']), sourcePath: str(d['路径']), sourceIndex: index, sourceValues: values };
  });
  const docsByPath = new Map();
  for (const d of docs) { const list = docsByPath.get(d.sourcePath) || []; list.push(d); docsByPath.set(d.sourcePath, list); }
  const rows = kb.rows.map((values, index) => {
    const r = Object.fromEntries(kb.full.map((field, i) => [field, values[i]]));
    const line = { id: 'hl_' + digest(batchId + ':' + index), batchId, sourceIndex: index, quoteNo: str(r['报价单号']), date: dateOrBlank(r['日期']), rawDate: str(r['日期']), continent: str(r['洲']), country: str(r['国家']), clientName: str(r['客户']), kind: str(r['资料类别']), category: str(r['设备品类']), name: str(r['设备/物料名称']), model: str(r['型号/规格']), qty: numberOrNull(r['数量']), unit: str(r['单位']), unitPrice: numberOrNull(r['单价']), amount: numberOrNull(r['金额']), currency: str(r['币种']), tradeTerms: str(r['贸易条款']), notes: str(r['备注']), filename: str(r['来源文件']), sourcePath: str(r['路径']), sourceValues: values };
    line.catalogName = separatedProductName(line.name);
    const candidates = docsByPath.get(line.sourcePath) || [];
    const matches = candidates.filter(d => d.quoteNo === line.quoteNo && d.clientName === line.clientName);
    line.documentIds = (matches.length ? matches : candidates).map(d => d.id);
    return { ...line, ...classifyLine(line) };
  });
  return { batchId, rows, docs, sourceColumns: kb.full, documentColumns: kb.dcols };
}

export function planImport(source, products, history, user, now = Date.now()) {
  const byKey = new Map();
  for (const product of products.filter(p => !p.mergedInto && p.status !== '停用')) {
    const k = productKey(product); const list = byKey.get(k) || []; list.push(product); byKey.set(k, list);
  }
  const existing = new Map(history.map(r => [r.id, r]));
  const additions = [], counts = { total: source.rows.length, linked: 0, created: 0, fee: 0, review: 0, alreadyImported: 0 };
  const rows = source.rows.map(original => {
    const previous = existing.get(original.id);
    if (previous) { counts.alreadyImported++; return previous; }
    const row = { ...original, owner: user.id, ownerName: user.name, importedAt: now };
    if (row.disposition === 'product') {
      const k = productKey(row), matches = byKey.get(k) || [];
      if (matches.length > 1) { row.disposition = 'review'; row.reason = '多个同名同规格产品，需选择档案'; }
      else {
        let p = matches[0];
        if (!p) {
          p = { id: 'hp_' + digest(k), code: 'H-' + digest(k).slice(0, 8).toUpperCase(), name: row.catalogName || row.name, model: row.model, category: row.category, unit: row.unit, description: row.model, nameEn: '', aliases: [], status: '待完善', price: null, currency: '', source: '历史报价', importBatchId: source.batchId, createdAt: now, updatedAt: now, owner: user.id, ownerName: user.name };
          // Never reuse a retired deterministic id or overwrite a different existing record.
          if (products.some(x => x.id === p.id)) p.id += '_' + digest(source.batchId).slice(0, 6);
          additions.push(p); byKey.set(k, [p]); counts.created++;
        }
        row.productId = p.id; row.disposition = 'linked'; counts.linked++;
      }
    }
    if (row.disposition === 'fee') counts.fee++;
    if (row.disposition === 'review') counts.review++;
    return row;
  });
  return { additions, rows, counts };
}

export function visibleHistory(rows, user, clients) {
  if (isCatalogManager(user)) return rows;
  const ownedNames = new Set(clients.filter(c => c.owner === user.id).map(c => key(c.company)).filter(Boolean));
  const foreignNames = new Set(clients.filter(c => c.owner !== user.id).map(c => key(c.company)).filter(Boolean));
  return rows.filter(r => r.kind !== '内部资料(非对外)' && (r.owner === user.id || (ownedNames.has(key(r.clientName)) && !foreignNames.has(key(r.clientName)))));
}
export function paged(rows, params) {
  const size = Math.max(1, Math.min(100, Number(params.get('pageSize')) || 25));
  const total = rows.length, pages = Math.max(1, Math.ceil(total / size));
  const page = Math.max(1, Math.min(pages, Math.trunc(Number(params.get('page')) || 1)));
  return { items: rows.slice((page - 1) * size, page * size), total, page, pageSize: size, pages };
}
export const publicHistoryRow = ({ sourceValues, documentColumns, ...row }) => row;
export function filterHistory(rows, params) {
  const words = key(params.get('q')).split(' ').filter(Boolean);
  return rows.filter(r => {
    for (const field of ['productId', 'clientName', 'country', 'category', 'currency', 'kind', 'disposition']) if (params.get(field) && r[field] !== params.get(field)) return false;
    if (params.get('year') && (!r.date || !r.date.startsWith(params.get('year')))) return false;
    if (params.get('missingDate') === '1' && r.date) return false;
    return words.every(w => key([r.name, r.model, r.quoteNo, r.clientName, r.filename, r.notes].join(' ')).includes(w));
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.sourceIndex - b.sourceIndex);
}
export function priceGroups(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.disposition !== 'linked' || r.unitPrice == null || !Number.isFinite(r.unitPrice) || r.unitPrice < 0) continue;
    const k = JSON.stringify([r.kind, r.currency, r.unit, r.model, r.tradeTerms]);
    const group = groups.get(k) || { kind: r.kind, currency: r.currency, unit: r.unit, model: r.model, tradeTerms: r.tradeTerms, min: r.unitPrice, max: r.unitPrice, count: 0, latest: null };
    group.min = Math.min(group.min, r.unitPrice); group.max = Math.max(group.max, r.unitPrice); group.count++;
    if (r.date && (!group.latest || group.latest.date < r.date)) group.latest = { date: r.date, price: r.unitPrice, qty: r.qty };
    groups.set(k, group);
  }
  const rank = kind => kind === '客户对外报价' ? 0 : /内部/.test(kind) ? 2 : 1;
  return [...groups.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || (b.latest?.date || '').localeCompare(a.latest?.date || ''));
}
export function completeness(p) {
  return Math.round([p.name, p.model, p.category, p.unit, p.description, p.nameEn].filter(v => str(v)).length / 6 * 100);
}

export function validateProduct(input, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('产品格式错误');
  const out = {};
  const limits = { name: 150, nameEn: 200, code: 80, model: 4000, category: 100, unit: 40, description: 12000, descriptionEn: 12000, status: 20, currency: 10, supplierId: 100, leadTime: 100, parameters: 8000, notes: 4000 };
  for (const [field, limit] of Object.entries(limits)) if (field in input) {
    if (typeof input[field] !== 'string') throw error('字段格式错误：' + field);
    out[field] = input[field].trim(); if (out[field].length > limit) throw error('字段过长：' + field);
  }
  if (!str(out.name ?? previous.name)) throw error('请填写产品名称');
  if ('status' in out && !['在用', '待完善', '停用'].includes(out.status)) throw error('产品状态错误');
  if ('price' in input) {
    out.price = numberOrNull(input.price);
    if (str(input.price) && (out.price == null || out.price < 0)) throw error('参考价应为非负数字');
    if (out.price != null && !str(out.currency ?? previous.currency)) throw error('设置参考价时请填写币种');
  }
  if ('aliases' in input) {
    if (!Array.isArray(input.aliases) || input.aliases.length > 30 || input.aliases.some(x => typeof x !== 'string' || x.length > 150)) throw error('别名格式错误');
    out.aliases = [...new Set(input.aliases.map(str).filter(Boolean))];
  }
  for (const field of ['tags', 'industries']) if (field in input) {
    if (!Array.isArray(input[field]) || input[field].length > 20 || input[field].some(v => typeof v !== 'string' || v.length > 40)) throw error('标签或行业格式错误');
    out[field] = [...new Set(input[field].map(str).filter(Boolean))];
  }
  if ('attachments' in input) {
    if (!Array.isArray(input.attachments) || input.attachments.length > 50) throw error('每个产品最多50份资料');
    out.attachments = input.attachments.map(file => {
      if (!file || typeof file.name !== 'string' || file.name.length > 200 || typeof file.url !== 'string' || !/^\/uploads\//.test(file.url) || /[?#\r\n]/.test(file.url) || file.url.split('/').includes('..') || !/\.(png|jpe?g|gif|webp|mp4|webm|pdf|docx?|xlsx?|txt|csv|zip)$/i.test(file.url)) throw error('产品资料格式错误');
      return { name: file.name, url: file.url, size: numberOrNull(file.size), type: /\.(png|jpe?g|gif|webp)$/i.test(file.url) ? 'image' : /\.(mp4|webm)$/i.test(file.url) ? 'video' : 'document' };
    });
  }
  return out;
}

export function quoteProductLines(items, products, previousItems = []) {
  if (!Array.isArray(items)) return items;
  return items.map((line, index) => {
    if (!line.productId) return line;
    const previous = previousItems[index];
    if (previous?.productSnapshot && ['productId', 'name', 'description', 'unit'].every(field => line[field] === previous[field])) return { ...line, productSnapshot: previous.productSnapshot };
    const product = products.find(p => p.id === line.productId);
    if (!product) throw error('关联产品不存在');
    return { ...line, productSnapshot: { id: product.id, code: product.code || '', name: str(line.name), model: str(line.description), unit: str(line.unit), category: product.category || '', nameEn: product.nameEn || '' } };
  });
}
