import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { uploadedQuoteSource } from './catalog-upload.js';
import { isCatalogManager, key, planImport, visibleHistory, paged, publicHistoryRow, filterHistory, priceGroups, completeness, validateProduct } from './product-catalog.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const facets = (rows, fields) => Object.fromEntries(fields.map(field => [field, [...new Set(rows.map(r => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))]));
const defaultCategoryImage = category => /滚筒/.test(category) ? '/category-images/roller-conveyor.png' : /配件.*(?:轴承|齿轮|电机)/.test(category) ? '/category-images/mechanical-parts.png' : '';
export function createCatalogRoutes({ root, read, write, commit, body, send, audit }) {
  const importTemplate = {
    sourceColumns: ['设备/物料名称','型号/规格','设备品类','客户','路径','单价','日期','洲','国家','资料类别','币种','贸易条款','金额','数量','单位','备注','来源文件','报价单号','有效期','付款方式','交期'],
    documentColumns: ['报价单号','日期','洲','国家','客户','资料类别','币种','贸易条款','单据总额','有效期','付款方式','交期','文件','路径']
  };
  const source = async () => { throw Object.assign(new Error('请上传 CSV 或 JSON 格式的历史报价数据'), { status: 503 }); };
  const manager = user => { if (!isCatalogManager(user)) fail('需要管理员或经理权限', 403); };
  async function historyFor(user) { return visibleHistory(await read('product-history'), user, await read('clients')); }
  return async function route(req, res, url, p, method, user) {
    if (!p.startsWith('/api/products')) return false;
    const reply = (status, data) => { res.setHeader('Cache-Control', 'no-store'); send(res, status, data); return true; };
    const all = await read('products');
    const products = all.filter(x => !x.mergedInto);
    if (p === '/api/products/catalog' && method === 'GET') {
      const params = url.searchParams, words = key(params.get('q')).split(' ').filter(Boolean);
      let rows = products.filter(r => ['category', 'status', 'unit'].every(field => !params.get(field) || (r[field] || (field === 'status' ? '在用' : '')) === params.get(field)) && words.every(word => key([r.name, r.nameEn, r.code, r.model, r.category, r.description, r.parameters, ...(r.tags || []), ...(r.industries || []), ...(r.aliases || [])].join(' ')).includes(word)));
      if (params.get('industry')) rows = rows.filter(p => (p.industries || []).includes(params.get('industry')));
      if (params.get('incomplete') === '1') rows = rows.filter(p => completeness(p) < 100);
      rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name, 'zh-CN'));
      const history = new Map();
      for (const row of await historyFor(user)) if (row.productId) { const list = history.get(row.productId) || []; list.push(row); history.set(row.productId, list); }
      const pricesFor = p => priceGroups(history.get(p.id) || []);
      if (params.get('priceMode') === 'history') rows = rows.filter(p => pricesFor(p).length > 0);
      if (params.get('priceMode') === 'manual') rows = rows.filter(p => p.price != null && p.price !== '');
      if (params.get('priceMode') === 'missing') rows = rows.filter(p => (p.price == null || p.price === '') && !pricesFor(p).length);
      const page = paged(rows, params);
      const items = page.items.map(p => ({ ...p, completeness: completeness(p), prices: pricesFor(p), historyCount: (history.get(p.id) || []).length }));
      const categorySettings = new Map((await read('product-category-settings')).map(item => [item.category, item.image || '']));
      const categories = new Map();
      for (const p of products) if (p.category) {
        const group = categories.get(p.category) || { name: p.category, count: 0 };
        group.count++; categories.set(p.category, group);
      }
      const categoryRows = [...categories.values()].map(category => {
        const customImage = categorySettings.get(category.name) || '';
        const defaultImage = defaultCategoryImage(category.name);
        return { ...category, image: customImage || defaultImage, defaultImage, customImage: !!customImage };
      }).sort((a,b) => b.count - a.count || a.name.localeCompare(b.name,'zh-CN'));
      return reply(200, { ...page, items, categories: categoryRows, facets: { ...facets(products, ['category','unit']), industry: [...new Set(products.flatMap(p => p.industries || []))].sort((a,b)=>a.localeCompare(b,'zh-CN')) }, stats: { total: products.length, active: products.filter(p => !p.status || p.status === '在用').length, pending: products.filter(p => p.status === '待完善').length, categories: categories.size }, canManage: isCatalogManager(user) });
    }
    if (p === '/api/products/category-images' && method === 'PUT') {
      manager(user);
      const input = await body(req), category = String(input.category || '').trim(), image = String(input.image || '').trim();
      if (!category || category.length > 100 || !products.some(product => product.category === category)) fail('产品分类不存在');
      if (image && !/^\/(?:uploads\/[A-Za-z0-9._-]+|category-images\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp))$/i.test(image)) fail('分类图片地址无效');
      const settings = await read('product-category-settings');
      const id = createHash('sha256').update(category).digest('hex');
      const previous = settings.find(item => item.id === id);
      const setting = { id, category, image, updatedAt: Date.now(), updatedBy: user.id, updatedByName: user.name };
      await commit({ 'product-category-settings': [...settings.filter(item => item.id !== id), setting] });
      audit(user, 'update', 'products', id, image ? `更新分类图片：${category}` : `恢复分类默认图片：${category}`);
      return reply(200, { ...setting, defaultImage: defaultCategoryImage(category), customImage: !!image, previousImage: previous?.image || '' });
    }
    if (p === '/api/products/history' && method === 'GET') {
      const visible = await historyFor(user), rows = filterHistory(visible, url.searchParams);
      return reply(200, { ...paged(rows.map(publicHistoryRow), url.searchParams), facets: facets(visible, ['country', 'clientName', 'category', 'currency', 'kind', 'disposition']), years: [...new Set(visible.map(r => r.date?.slice(0, 4)).filter(Boolean))].sort().reverse(), stats: { total: visible.length, linked: visible.filter(r => r.disposition === 'linked').length, fee: visible.filter(r => r.disposition === 'fee').length, review: visible.filter(r => r.disposition === 'review').length }, canManage: isCatalogManager(user) });
    }
    if (p === '/api/products/documents' && method === 'GET') {
      const visible = await historyFor(user), ids = new Set(visible.flatMap(r => r.documentIds || []));
      const clients = await read('clients');
      const docs = visibleHistory(await read('product-documents'), user, clients).filter(d => isCatalogManager(user) || ids.has(d.id));
      const counts = new Map(); for (const r of visible) for (const id of r.documentIds || []) counts.set(id, (counts.get(id) || 0) + 1);
      return reply(200, { ...paged(filterHistory(docs, url.searchParams).map(d => ({ ...publicHistoryRow(d), detailCount: counts.get(d.id) || 0 })), url.searchParams), facets: facets(docs, ['clientName', 'country', 'currency', 'kind']) });
    }
    if (p === '/api/products/imports' && method === 'GET') {
      manager(user);
      const batches = await read('product-imports');
      return reply(200, batches.map(({ sourceColumns, documentColumns, ...record }) => record).sort((a, b) => b.importedAt - a.importedAt));
    }
    if (p === '/api/products/import-template' && method === 'GET') {
      manager(user); return reply(200, { columns: importTemplate.sourceColumns });
    }
    if (p === '/api/products/import-preview' && ['GET', 'POST'].includes(method)) {
      manager(user); const upload = method === 'POST' ? await body(req) : null;
      const s = upload ? uploadedQuoteSource(upload, importTemplate) : await source();
      const history = await read('product-history'), plan = planImport(s, all, history, user);
      return reply(200, { batchId: s.batchId, counts: plan.counts, documents: s.docs.length, samples: plan.additions.slice(0, 12), sourceUrl: '', filename: s.filename || '报价数据', sourceGeneratedDate: '' });
    }
    if (p === '/api/products/import-history' && method === 'POST') {
      manager(user); const input = await body(req);
      const s = input.upload ? uploadedQuoteSource(input.upload, importTemplate) : await source();
      if (input.batchId !== s.batchId) fail('来源已变化，请重新预览', 409);
      const history = await read('product-history'), documents = await read('product-documents'), batches = await read('product-imports');
      const plan = planImport(s, all, history, user), oldIds = new Set(history.map(r => r.id)), oldDocs = new Set(documents.map(d => d.id));
      const additions = plan.rows.filter(r => !oldIds.has(r.id));
      if (!additions.length && s.docs.every(d => oldDocs.has(d.id))) return reply(200, { imported: false, counts: plan.counts, batchId: s.batchId });
      const now = Date.now();
      const batch = { id: s.batchId, sourceUrl: '', filename: s.filename || '报价数据', format: input.upload.format, sourceGeneratedDate: '', importedAt: now, importedBy: user.id, importedByName: user.name, sourceColumns: s.sourceColumns, documentColumns: s.documentColumns, counts: plan.counts, documents: s.docs.length };
      await commit({ products: [...all, ...plan.additions], 'product-history': [...history, ...additions], 'product-documents': [...documents, ...s.docs.filter(d => !oldDocs.has(d.id)).map(d => ({ ...d, owner: user.id, ownerName: user.name }))], 'product-imports': [...batches.filter(b => b.id !== s.batchId), batch] });
      audit(user, 'create', 'products', s.batchId, '历史报价导入：' + plan.counts.created + ' 个产品，' + additions.length + ' 条明细');
      return reply(201, { imported: true, counts: plan.counts, batchId: s.batchId });
    }
    if (p === '/api/products/bulk' && method === 'POST') {
      manager(user); const input = await body(req), ids = [...new Set(input.ids || [])];
      if (!ids.length || ids.length > 100 || ids.some(id => !products.some(p => p.id === id))) fail('请选择至多100个有效产品');
      const patch = {}; for (const k of ['category', 'status']) if (k in (input.patch || {})) patch[k] = input.patch[k];
      if (!Object.keys(patch).length) fail('请选择分类或状态');
      const normalized = validateProduct(patch, { name: '批量更新' }), now = Date.now();
      await write('products', all.map(p => ids.includes(p.id) ? { ...p, ...normalized, updatedAt: now } : p));
      audit(user, 'update', 'products', '', '批量更新' + ids.length + '个产品');
      return reply(200, { updated: ids.length });
    }
    if (p === '/api/products/merge' && method === 'POST') {
      manager(user); const input = await body(req), keep = products.find(p => p.id === input.keepId);
      const ids = [...new Set(input.removeIds || [])];
      if (!keep || !ids.length || ids.length > 50 || ids.includes(keep.id) || ids.some(id => !products.some(p => p.id === id))) fail('请选择保留产品和要合并的产品');
      const sources = products.filter(p => ids.includes(p.id)), now = Date.now();
      const updated = all.map(p => p.id === keep.id ? { ...p, aliases: [...new Set([...(p.aliases || []), ...sources.flatMap(s => [s.name, ...(s.aliases || [])])])].filter(a => a !== p.name), updatedAt: now } : ids.includes(p.id) ? { ...p, status: '停用', mergedInto: keep.id, updatedAt: now } : p);
      const history = (await read('product-history')).map(r => ids.includes(r.productId) ? { ...r, originalProductId: r.originalProductId || r.productId, productId: keep.id } : r);
      await commit({ products: updated, 'product-history': history });
      audit(user, 'update', 'products', keep.id, '合并产品，原档案和旧报价快照保留');
      return reply(200, { merged: ids.length, keepId: keep.id });
    }
    const reviewMatch = p.match(/^\/api\/products\/review\/([\w-]+)$/);
    if (reviewMatch && method === 'POST') {
      manager(user); const input = await body(req), history = await read('product-history'), index = history.findIndex(r => r.id === reviewMatch[1]);
      if (index < 0) fail('历史明细不存在', 404);
      const row = history[index]; if (input.expectedDisposition && input.expectedDisposition !== row.disposition) fail('明细已被整理，请刷新后重试', 409); let product, nextProducts = all;
      if (input.action === 'link') { product = products.find(p => p.id === input.productId && p.status !== '停用'); if (!product) fail('产品不存在或已停用'); }
      else if (input.action === 'create') {
        const fields = validateProduct(input.product);
        product = { ...fields, id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), status: fields.status || '待完善', source: '历史报价整理', owner: user.id, ownerName: user.name };
        nextProducts = [...all, product];
      } else if (input.action !== 'fee') fail('请选择关联产品、新建产品或服务费用');
      history[index] = { ...row, disposition: product ? 'linked' : 'fee', productId: product?.id || null, reason: '人工整理', reviewedBy: user.id, reviewedAt: Date.now() };
      await commit({ products: nextProducts, 'product-history': history });
      audit(user, 'update', 'products', product?.id || '', '整理历史报价明细');
      return reply(200, { row: publicHistoryRow(history[index]), product });
    }
    const detail = p.match(/^\/api\/products\/([\w-]+)\/detail$/);
    if (detail && method === 'GET') {
      const product = all.find(p => p.id === detail[1]); if (!product) fail('产品不存在', 404);
      const linked = (await historyFor(user)).filter(r => r.productId === product.id);
      const params = new URLSearchParams(url.searchParams); params.set('productId', product.id);
      const clients = new Map();
      for (const row of linked) if (row.clientName) {
        const key = JSON.stringify([row.clientName,row.country]);
        const c = clients.get(key) || { name: row.clientName, country: row.country, count: 0, latestDate: '' };
        c.count++; if (row.date > c.latestDate) c.latestDate = row.date; clients.set(key,c);
      }
      return reply(200, { relatedClients: [...clients.values()].sort((a,b)=>b.count-a.count), product: { ...product, completeness: completeness(product) }, history: paged(filterHistory(linked, params).map(publicHistoryRow), params), prices: priceGroups(linked), canManage: isCatalogManager(user) });
    }
    if (p === '/api/products' && method === 'GET') return reply(200, products);
    if (p === '/api/products' && method === 'POST') {
      const fields = validateProduct(await body(req)), now = Date.now();
      const product = { ...fields, id: randomUUID(), status: fields.status || '在用', owner: user.id, ownerName: user.name, createdAt: now, updatedAt: now };
      await write('products', [...all, product]); audit(user, 'create', 'products', product.id, product.name);
      return reply(201, product);
    }
    const match = p.match(/^\/api\/products\/([\w-]+)$/);
    if (match && ['PUT', 'DELETE'].includes(method)) {
      const index = all.findIndex(p => p.id === match[1]); if (index < 0) fail('产品不存在', 404);
      const previous = all[index]; if (previous.mergedInto) fail('此产品已合并，请使用保留档案', 409);
      const input = method === 'DELETE' ? { status: '停用' } : await body(req);
      if ('expectedUpdatedAt' in input && input.expectedUpdatedAt !== previous.updatedAt) fail('产品已被修改，请刷新后重试', 409);
      const fields = validateProduct(input, previous), product = { ...previous, ...fields, updatedAt: Date.now() };
      all[index] = product; await write('products', all); audit(user, 'update', 'products', product.id, method === 'DELETE' ? '停用产品' : '更新产品档案');
      return reply(200, product);
    }
    return reply(404, { error: '产品接口不存在' });
  };
}
