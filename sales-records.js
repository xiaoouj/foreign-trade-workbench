// Business validation and authoritative quotation revisions (shared by JSON/MySQL APIs).
const percentageFields = ['productionProgress', 'depositPercent', 'paidPercent'];
export function normalizeSalesFields(input, fields = percentageFields) {
  const out = { ...input };
  for (const key of fields) {
    if (!(key in out)) continue;
    if (out[key] === '' || out[key] == null) { out[key] = null; continue; }
    if (!['number', 'string'].includes(typeof out[key]) || String(out[key]).trim() === '') throw new Error('比例必须为 0–100 之间的数字');
    const value = Number(out[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw new Error('比例必须为 0–100，最多保留两位小数');
    out[key] = value;
  }
  return out;
}
const fields = {
  quoteNo:'报价单号',clientName:'客户',projectName:'项目',contactName:'联系人',currency:'币种',
  validUntil:'有效期',deliveryDays:'交货期',paymentTerms:'付款条款',depositPercent:'定金比例',
  tradeTerms:'贸易条款',country:'买方国家',contactEmail:'买方邮箱',contactPhone:'买方电话',website:'买方网站',notes:'备注',items:'产品明细'
};
const numeric = new Set(['qty','unitPrice','lineAmount','deliveryDays','depositPercent']);
function canonical(value, key) {
  if (numeric.has(key)) return value == null || value === '' ? null : Number(value);
  if (Array.isArray(value)) return value.map(item=>canonical(item,''));
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!=null && value[k]!=='').map(k=>[k,canonical(value[k],k)]));
  return value == null ? '' : value;
}
function snapshot(quote) { return Object.fromEntries(Object.keys(fields).map(key=>[key,quote[key]??null])); }
const versionOf = q => Number.isSafeInteger(Number(q.version)) && Number(q.version)>0 ? Number(q.version) : 1;
const actor = user => ({userId:user.id, userName:user.name || user.username});
export function createQuote(input, user, now, id) {
  const {revisionHistory,version,baseVersion,...body}=normalizeSalesFields(input,['depositPercent']);
  return {...body,id,createdAt:now,updatedAt:now,status:body.status||'草稿',version:1,
    revisionHistory:[{version:1,kind:'created',at:now,...actor(user),changes:['创建报价'],snapshot:snapshot(body)}]};
}
export function reviseQuote(previous, input, user, now) {
  const {revisionHistory,version,baseVersion,...body}=normalizeSalesFields(input,['depositPercent']);
  if(baseVersion != null && Number(baseVersion)!==versionOf(previous)) {
    const error=new Error('此报价已被其他人修改，请刷新后重新编辑');error.status=409;throw error;
  }
  const changes=Object.keys(fields).filter(k=>k in body && JSON.stringify(canonical(previous[k],k))!==JSON.stringify(canonical(body[k],k)));
  const next={...previous,...body,id:previous.id,createdAt:previous.createdAt,updatedAt:now,version:versionOf(previous)};
  const history=Array.isArray(previous.revisionHistory)?previous.revisionHistory.slice():[];
  if(changes.length){
    if(!history.length)history.push({version:versionOf(previous),kind:'baseline',at:now,...actor(user),changes:['历史报价起点；此前修改无详细记录'],snapshot:snapshot(previous)});
    next.version++;
    history.push({version:next.version,kind:'modified',at:now,...actor(user),changes:changes.map(k=>fields[k]),snapshot:snapshot(next)});
  }
  next.revisionHistory=history;
  return next;
}
