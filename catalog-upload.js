import { dateOrBlank, prepareSource } from './product-catalog.js';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function parseQuoteCsv(text) {
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else value += ch;
    } else if (ch === '"') {
      if (value || closed) fail('CSV 引号格式错误');
      quoted = true;
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(value); value = ''; closed = false;
      if (ch !== ',') {
        if (row.some(v => v.trim())) rows.push(row);
        row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closed) fail('CSV 引号后应为分隔符');
      value += ch;
    }
  }
  if (quoted) fail('CSV 有未闭合的引号');
  row.push(value); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

export function uploadedQuoteSource(upload, template) {
  if (!upload || !['csv', 'json'].includes(upload.format) || typeof upload.content !== 'string' || !upload.content.trim()) fail('请选择 CSV 或 JSON 报价数据文件');
  if (Buffer.byteLength(upload.content) > 20 * 1024 * 1024) fail('报价数据文件不能超过20 MB');
  const filename = String(upload.filename || '报价数据').replace(/[\\/\r\n]/g, '').slice(0, 200);
  let data;
  if (upload.format === 'json') {
    try { data = JSON.parse(upload.content); } catch { fail('JSON 文件格式错误'); }
  } else {
    const csv = parseQuoteCsv(upload.content), columns = csv.shift()?.map(v => v.trim());
    if (!columns?.length || new Set(columns).size !== columns.length) fail('CSV 表头不能为空或重复');
    for (const field of ['设备/物料名称', '型号/规格', '设备品类', '客户', '路径', '单价']) if (!columns.includes(field)) fail('CSV 缺少字段：' + field);
    if (csv.some(r => r.length !== columns.length)) fail('CSV 行的字段数与表头不一致');
    const rows = csv.map(values => {
      const r = Object.fromEntries(columns.map((field, i) => [field, values[i]]));
      if (!r['设备/物料名称']?.trim()) fail('每条报价明细都需要设备/物料名称');
      for (const field of ['数量', '单价', '金额']) if (r[field]?.trim() && (!Number.isFinite(Number(r[field])) || Number(r[field]) < 0)) fail(field + '请填写非负数字，千位分隔符请移除');
      if (r['单价']?.trim() && !r['币种']?.trim()) fail('填写单价时需要币种');
      if (r['日期']?.trim() && !dateOrBlank(r['日期'])) fail('日期请用有效的 YYYY-MM-DD 格式');
      r['路径'] ||= r['来源文件'] || filename;
      r['来源文件'] ||= filename;
      r['资料类别'] ||= '客户对外报价';
      return template.sourceColumns.map(field => r[field] || '');
    });
    const docs = new Map();
    for (const values of rows) {
      const r = Object.fromEntries(template.sourceColumns.map((field, i) => [field, values[i]]));
      const fields = { ...r, '文件': r['来源文件'], '单据总额': '' };
      const doc = template.documentColumns.map(field => fields[field] || '');
      docs.set(JSON.stringify([r['路径'], r['报价单号'], r['客户']]), doc);
    }
    data = { full: template.sourceColumns, rows, dcols: template.documentColumns, docs: [...docs.values()] };
  }
  if (!data || !Array.isArray(data.rows) || !data.rows.length || data.rows.length > 50000 || !Array.isArray(data.docs) || data.docs.length > 10000) fail('文件须包含1–50,000条明细，最多10,000份单据');
  for (const fields of [data.full, data.dcols]) {
    if (!Array.isArray(fields) || fields.length > 100 || fields.some(v => typeof v !== 'string' || v.length > 100) || new Set(fields).size !== fields.length) fail('来源表头格式错误');
  }
  for (const rows of [data.rows, data.docs]) if (rows.some(row => !Array.isArray(row) || row.some(v => v != null && !['string', 'number', 'boolean'].includes(typeof v)))) fail('来源单元格须为文字、数字或空值');
  return { ...prepareSource(data), filename };
}
