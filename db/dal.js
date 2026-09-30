// db/dal.js — 数据访问层（MySQL / JSON 双后端，2026-08-21 升级）
// 设计目标：对外暴露与原 readJson/writeJson 一致的能力，但底层可切换为 MySQL 规范化表。
// - 数组集合（clients/orders/inquiries…）：每行一条记录，主要字段落真实列，嵌套结构(chatLog/items/lines)用 JSON 列。
// - 对象集合 users/sales：users 拆 users 表、sales 拆 sales_targets 表，读取时重组为原对象形状。
// - 单例配置(settings/ai-config/mail…)：统一存 kv_store 表。
// - audit：独立 audit 表，逐行插入。
// 单一事实来源是本文件的 ARRAYS/KV/OBJECTS 描述，DDL 由 buildSchemaSQL() 据此生成，避免 SQL 与代码漂移。

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.FTW_DATA_DIR ? path.resolve(process.env.FTW_DATA_DIR) : path.join(process.cwd(), 'data');

let pool = null;
let mode = 'json';            // 'mysql' | 'json'
let usersCache = [];          // 同步读取用的用户缓存（getCurrentUser 是同步的）

const AI_DEFAULT = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen2.5:7b',
  apiKey: '',
  temperature: 0.2,
  timeout: 120000,
};

// ---------- 集合描述（规范化表结构，单一事实来源） ----------
// 每个数组集合：fields=列名；int/dec/date/bool/json/text=特殊类型列（其余按字符串 TEXT 处理）
const ARRAYS = {
  clients: {
    fields: ['id', 'company', 'country', 'contactName', 'stage', 'contactEmail', 'contactPhone', 'source', 'annualValue', 'nextFollowUp', 'notes', 'owner', 'ownerName', 'createdAt', 'updatedAt'],
    int: ['createdAt', 'updatedAt'],
  },
  contacts: {
    fields: ['id', 'clientId', 'name', 'role', 'title', 'phone', 'email', 'isPrimary', 'notes', 'owner', 'createdAt', 'updatedAt'],
    int: ['createdAt', 'updatedAt'], bool: ['isPrimary'],
  },
  orders: {
    fields: ['id', 'orderNo', 'clientName', 'country', 'amount', 'currency', 'status', 'orderDate', 'deliveryDate', 'paymentTerms', 'notes', 'owner', 'ownerName', 'clientId', 'source', 'quoteId', 'createdAt', 'updatedAt', 'items', 'productionProgress', 'depositPercent', 'paidPercent'],
    int: ['createdAt', 'updatedAt'], json: ['items'], dec: ['amount','productionProgress','depositPercent','paidPercent'], date: ['orderDate', 'deliveryDate'],
  },
  inquiries: {
    fields: ['id', 'clientName', 'country', 'contactName', 'contactEmail', 'source', 'receivedAt', 'product', 'model', 'status', 'expectedAmount', 'currency', 'sampleSent', 'owner', 'lastFollowAt', 'nextFollowAt', 'notes', 'createdAt', 'updatedAt', 'ownerName', 'contactPhone', 'wonAt', 'clientId', 'chatLog', 'attachments'],
    int: ['createdAt', 'updatedAt', 'wonAt'], dec: ['expectedAmount'], date: ['receivedAt', 'lastFollowAt', 'nextFollowAt'], json: ['chatLog', 'attachments'],
  },
  chats: {
    fields: ['id', 'createdAt', 'updatedAt', 'lines', 'clientName', 'title', 'raw', 'owner', 'ownerName'],
    int: ['createdAt', 'updatedAt'], json: ['lines'], text: ['raw'],
  },
  comms: {
    fields: ['id', 'createdAt', 'updatedAt', 'clientName', 'channel', 'date', 'summary', 'content', 'owner', 'ownerName'],
    int: ['createdAt', 'updatedAt'], date: ['date'], text: ['content'],
  },
  exceptions: {
    fields: ['id', 'inquiryId', 'type', 'desc', 'status', 'owner', 'createdAt', 'updatedAt', 'ownerName'],
    int: ['createdAt', 'updatedAt'], text: ['desc'],
  },
  quotations: {
    fields: ['id', 'createdAt', 'updatedAt', 'version', 'status', 'quoteNo', 'clientName', 'projectName', 'contactName', 'currency', 'validUntil', 'deliveryDays', 'paymentTerms', 'owner', 'notes', 'inquiryId', 'orderId', 'clientId', 'ownerName', 'items', 'totalAmount', 'depositPercent', 'tradeTerms', 'revisionHistory'],
    int: ['createdAt', 'updatedAt', 'version', 'deliveryDays'], dec: ['totalAmount','depositPercent'], date: ['validUntil'], json: ['items','revisionHistory'], text: ['notes'],
  },
  // 通用集合（当前为空，行结构待定）：id + data(JSON)
  'comm-templates': { generic: true },
  emails: { generic: true },
  finance: { generic: true },
  'hs-code': { generic: true },
  knowledge: { generic: true },
  products: { generic: true },
  shipments: { generic: true },
  suppliers: { generic: true },
  tasks: { generic: true },
  // 2026-09-30：文件型 CRM 导入任务（/api/crm-imports）。此前漏注册，
  // 导致 MySQL 模式下 writeCollection 静默丢弃、readCollection 恒返回空数组 ——
  // 表现为「上传成功但点 AI 识别报导入任务不存在」。
  'crm-imports': { generic: true },
};

const KV = ['settings', 'ai-config', 'mail', 'mail-sent', 'notifications', 'system-notices'];
const OBJECTS = ['users', 'sales'];

const tableOf = (base) => base.replace(/-/g, '_');

// ---------- DDL 生成 ----------
function colType(key, desc) {
  if (desc.int && desc.int.includes(key)) return 'BIGINT DEFAULT NULL';
  if (desc.dec && desc.dec.includes(key)) return 'DECIMAL(18,2) DEFAULT NULL';
  if (desc.date && desc.date.includes(key)) return 'DATE DEFAULT NULL';
  if (desc.bool && desc.bool.includes(key)) return 'TINYINT(1) DEFAULT 0';
  if (desc.json && desc.json.includes(key)) return 'JSON';
  if (desc.text && desc.text.includes(key)) return 'TEXT';
  return 'TEXT';
}

function buildSchemaSQL() {
  const stmts = [];
  for (const [base, desc] of Object.entries(ARRAYS)) {
    const table = tableOf(base);
    if (desc.generic) {
      stmts.push(`CREATE TABLE IF NOT EXISTS \`${table}\` (id VARCHAR(64) NOT NULL PRIMARY KEY, data JSON)`);
    } else {
      const cols = desc.fields.map((k) =>
        k === 'id' ? '`id` VARCHAR(64) NOT NULL PRIMARY KEY' : `\`${k}\` ${colType(k, desc)}`,
      ).join(', ');
      stmts.push(`CREATE TABLE IF NOT EXISTS \`${table}\` (${cols})`);
    }
  }
  stmts.push(`CREATE TABLE IF NOT EXISTS \`users\` (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    username VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password TEXT NOT NULL,
    role VARCHAR(32) DEFAULT 'sales',
    managerId VARCHAR(64) DEFAULT NULL,
    mustChangePassword TINYINT(1) DEFAULT 0
  )`);
  stmts.push(`CREATE TABLE IF NOT EXISTS \`sales_targets\` (
    user_id VARCHAR(64) NOT NULL,
    ym VARCHAR(16) NOT NULL,
    amount DECIMAL(18,2) DEFAULT NULL,
    PRIMARY KEY(user_id, ym)
  )`);
  stmts.push(`CREATE TABLE IF NOT EXISTS \`kv_store\` (
    name VARCHAR(128) NOT NULL PRIMARY KEY,
    data JSON
  )`);
  stmts.push(`CREATE TABLE IF NOT EXISTS \`audit\` (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ts BIGINT DEFAULT NULL,
    userId VARCHAR(64),
    userName VARCHAR(128),
    role VARCHAR(32),
    action VARCHAR(32),
    \`tbl\` VARCHAR(64),
    recordId VARCHAR(64) DEFAULT NULL,
    summary VARCHAR(255)
  )`);
  return stmts;
}

// ---------- 类型转换 ----------
function toSqlVal(v, desc, k) {
  if (v === undefined || v === null) return null;
  if (desc.json && desc.json.includes(k)) return JSON.stringify(v);
  if (desc.bool && desc.bool.includes(k)) return v ? 1 : 0;
  if (desc.int && desc.int.includes(k)) return Number(v) || 0;
  if (desc.dec && desc.dec.includes(k)) return (v === '' || v == null) ? null : Number(v);
  if (desc.date && desc.date.includes(k)) return (v && String(v).trim()) ? String(v).slice(0, 10) : null;
  return String(v);
}

function rowToObj(r, desc) {
  const o = {};
  for (const k of desc.fields) {
    if (!(k in r)) continue;
    let v = r[k];
    if (v === undefined) continue;
    if (desc.json && desc.json.includes(k)) {
      // mysql2 已把 JSON 列解析为对象/数组/字符串；仅当值为字符串且看起来像 JSON 时才再解析，
      // 否则保留原文（避免 chatLog 这类纯文本字符串被误解析成 null 而丢失）
      o[k] = (v == null) ? null : (typeof v === 'string' ? (safeParse(v) ?? v) : v);
    } else if (desc.bool && desc.bool.includes(k)) {
      o[k] = !!v;
    } else if ((desc.int && desc.int.includes(k)) || (desc.dec && desc.dec.includes(k))) {
      o[k] = (v == null) ? null : Number(v);
    } else if (desc.date && desc.date.includes(k)) {
      o[k] = (v == null) ? null : String(v).slice(0, 10);
    } else {
      o[k] = (v == null) ? null : String(v);
    }
  }
  return o;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------- 连接 + 初始化 ----------
async function createPool() {
  // mysql2 只在真正尝试 MySQL 时懒加载，避免 JSON 模式下因缺包而无法启动
  let mysql;
  try {
    mysql = (await import('mysql2/promise')).default;
  } catch (e) {
    throw new Error('未安装 mysql2 依赖：' + (e && e.message));
  }
  const cfg = {
    host: process.env.FTW_DB_HOST || '127.0.0.1',
    port: Number(process.env.FTW_DB_PORT || 3306),
    user: process.env.FTW_DB_USER || 'root',
    password: process.env.FTW_DB_PASSWORD || '',
    database: process.env.FTW_DB_NAME || 'ftw',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
  let lastErr;
  for (let i = 0; i < 15; i++) {
    try {
      const p = mysql.createPool(cfg);
      await p.query('SELECT 1');
      return p;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function seedDefaults() {
  if (!pool) return;
  const seed = async (name, obj) => {
    await pool.query('INSERT IGNORE INTO `kv_store` (name, data) VALUES (?, ?)', [name, JSON.stringify(obj)]);
  };
  await seed('settings', { inquirySources: ['阿里巴巴', '官网', '展会', 'Google', 'LinkedIn', '客户介绍', '其他'] });
  await seed('ai-config', AI_DEFAULT);
  await seed('sales', {});
  await seed('mail', {});
  await seed('mail-sent', {});
  await seed('notifications', {});
}

export async function initDAL() {
  const wantMysql = (process.env.FTW_STORAGE || 'json').toLowerCase() === 'mysql';
  if (!wantMysql) {
    mode = 'json';
    return 'json';
  }
  try {
    pool = await createPool();
    for (const sql of buildSchemaSQL()) {
      await pool.query(sql);
    }
    try {
      const [itemColumns] = await pool.query("SHOW COLUMNS FROM `orders` LIKE 'items'");
      if (!itemColumns.length) await pool.query('ALTER TABLE `orders` ADD COLUMN `items` JSON NULL');
    } catch (error) { error.orderItemsMigration = true; throw error; }
    try {
      for (const [table,columns] of Object.entries({orders:{productionProgress:'DECIMAL(5,2)',depositPercent:'DECIMAL(5,2)',paidPercent:'DECIMAL(5,2)'},quotations:{depositPercent:'DECIMAL(5,2)',tradeTerms:'TEXT',revisionHistory:'JSON'}})) {
        const [existing]=await pool.query('SHOW COLUMNS FROM `'+table+'`');
        const names=new Set(existing.map(c=>c.Field));
        for(const [column,type] of Object.entries(columns)) if(!names.has(column)) await pool.query('ALTER TABLE `'+table+'` ADD COLUMN `'+column+'` '+type+' NULL');
      }
    } catch(error) { error.salesMigration=true; throw error; }
    await seedDefaults();
    // 注意：此时缓存尚未建立，必须用 readUsersTable() 直接读表，不能调 readCollection('users')（它返回的是空缓存）
    usersCache = await readUsersTable();
    mode = 'mysql';
    console.log('[dal] MySQL 存储已启用（数据库 ' + (process.env.FTW_DB_NAME || 'ftw') + '）');
    return 'mysql';
  } catch (e) {
    if (e.orderItemsMigration || e.salesMigration) throw e; // Migration failure must not switch business storage.
    console.error('[dal] MySQL 初始化失败，降级为 JSON 文件模式：', e && e.message);
    mode = 'json';
    pool = null;
    return 'json';
  }
}

export function getMode() { return mode; }
export function getUsersSync() { return usersCache; }

// ---------- 集合读写 ----------
export async function readCollection(base, fallback) {
  if (base === 'users') return { users: usersCache };
  if (base === 'sales') return await readSales();
  if (KV.includes(base)) return await readKv(base, fallback);
  if (ARRAYS[base]) return await readArray(base);
  // 未知集合：回退读 JSON 文件
  return fallback !== undefined ? fallback : [];
}

export async function writeCollection(base, data) {
  if (base === 'users') { await writeUsersAsync(data); return; }
  if (base === 'sales') { await writeSales(data); return; }
  if (KV.includes(base)) { await writeKv(base, data); return; }
  if (ARRAYS[base]) { await writeArray(base, data); return; }
}

async function readArray(base) {
  const desc = ARRAYS[base];
  const table = tableOf(base);
  if (desc.generic) {
    const [rows] = await pool.query(`SELECT id, data FROM \`${table}\``);
    // MariaDB 的 JSON 列会被 mysql2 自动解析成对象；字符串则再解析一次
    return rows.map((r) => ((typeof r.data === 'string' ? safeParse(r.data) : r.data) || { id: r.id }));
  }
  const cols = desc.fields.map((c) => '`' + c + '`').join(', ');
  const [rows] = await pool.query(`SELECT ${cols} FROM \`${table}\``);
  return rows.map((r) => rowToObj(r, desc));
}

async function writeArray(base, data) {
  const desc = ARRAYS[base];
  const table = tableOf(base);
  const list = Array.isArray(data) ? data : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (desc.generic) {
      await conn.query(`DELETE FROM \`${table}\``);
      for (const o of list) {
        await conn.query(`INSERT INTO \`${table}\` (id, data) VALUES (?, ?)`, [o.id, JSON.stringify(o)]);
      }
    } else {
      const cols = desc.fields;
      const ph = cols.map(() => '?').join(', ');
      const insCols = cols.map((c) => '`' + c + '`').join(', ');
      const upd = cols.filter((c) => c !== 'id').map((c) => '`' + c + '`=VALUES(`' + c + '`)').join(', ');
      const sql = `INSERT INTO \`${table}\` (${insCols}) VALUES (${ph}) ON DUPLICATE KEY UPDATE ${upd}`;
      for (const o of list) {
        const vals = cols.map((k) => toSqlVal(o[k], desc, k));
        await conn.query(sql, vals);
      }
      const ids = list.map((o) => o.id).filter(Boolean);
      if (ids.length) {
        await conn.query(`DELETE FROM \`${table}\` WHERE \`id\` NOT IN (${ids.map(() => '?').join(',')})`, ids);
      } else {
        await conn.query(`DELETE FROM \`${table}\``);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function readKv(base, fallback) {
  const [rows] = await pool.query('SELECT data FROM `kv_store` WHERE name = ?', [base]);
  if (!rows.length) return fallback !== undefined ? fallback : {};
  // 注意：data 列是 JSON 类型，mysql2 会自动把 JSON 列解析成对象（不是字符串），
  // 这里必须两种形态都兼容；否则 JSON.parse("[object Object]") 失败 → 永远返回 {}，
  // 导致 settings/ai-config/mail/notifications 等 KV 数据「写入成功但读出来永远为空」。
  const d = rows[0].data;
  const parsed = (typeof d === 'string') ? safeParse(d) : d;
  return parsed || {};
}

async function writeKv(base, obj) {
  await pool.query(
    'INSERT INTO `kv_store` (name, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [base, JSON.stringify(obj)],
  );
}

async function readSales() {
  const [rows] = await pool.query('SELECT user_id, ym, amount FROM `sales_targets`');
  const out = {};
  for (const r of rows) {
    if (!out[r.user_id]) out[r.user_id] = { yearMonthly: {} };
    out[r.user_id].yearMonthly[r.ym] = (r.amount == null) ? null : Number(r.amount);
  }
  return out;
}

async function writeSales(obj) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM `sales_targets`');
    for (const [uid, val] of Object.entries(obj || {})) {
      const ym = (val && val.yearMonthly) || {};
      for (const [month, amt] of Object.entries(ym)) {
        await conn.query(
          'INSERT INTO `sales_targets` (user_id, ym, amount) VALUES (?, ?, ?)',
          [uid, month, (amt == null || amt === '') ? null : Number(amt)],
        );
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function readUsersTable() {
  const [rows] = await pool.query('SELECT id, username, name, password, role, managerId, mustChangePassword FROM `users`');
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    name: r.name,
    password: r.password,
    role: r.role || 'sales',
    managerId: r.managerId || null,
    mustChangePassword: !!r.mustChangePassword,
  }));
}

export async function writeUsersAsync(obj) {
  const list = (obj && obj.users) || [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM `users`');
    for (const u of list) {
      await conn.query(
        'INSERT INTO `users` (id, username, name, password, role, managerId, mustChangePassword) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [u.id, u.username, u.name, u.password, u.role || 'sales', u.managerId || null, u.mustChangePassword ? 1 : 0],
      );
    }
    await conn.commit();
    usersCache = list.map((u) => ({ ...u, mustChangePassword: !!u.mustChangePassword }));
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------- 审计 ----------
export async function insertAudit(entries) {
  if (!pool || !entries.length) return;
  const sql = 'INSERT INTO `audit` (ts, userId, userName, role, action, `tbl`, recordId, summary) VALUES ?';
  const rows = entries.map((e) => [
    e.ts || Date.now(),
    e.userId || null,
    e.userName || null,
    e.role || null,
    e.action || null,
    e.table || null,
    e.recordId || null,
    String(e.summary || '').slice(0, 255),
  ]);
  await pool.query(sql, [rows]);
}

export async function selectAudit() {
  if (!pool) return [];
  const [rows] = await pool.query('SELECT ts, userId, userName, role, action, `tbl` AS `table`, recordId, summary FROM `audit` ORDER BY id ASC');
  return rows;
}

// ---------- 全量导出（每日快照用） ----------
export async function exportAll() {
  const out = {};
  for (const base of Object.keys(ARRAYS)) out[base] = await readArray(base);
  for (const base of KV) out[base] = await readKv(base, {});
  out.users = usersCache;
  out.sales = await readSales();
  return out;
}

export { DATA_DIR, ARRAYS, KV, OBJECTS };

// Update only selected order fields, in one transaction; never rewrite the collection.
export async function patchOrders(ids, patch, canAccess) {
  const desc = ARRAYS.orders;
  const keys = Object.keys(patch).filter(k => desc.fields.includes(k) && !['id','createdAt'].includes(k));
  if (!keys.length) throw new Error('没有可更新字段');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM `orders` WHERE `id` IN (?) FOR UPDATE', [ids]);
    const byId = new Map(rows.map(r => [r.id, r]));
    const succeeded = [], failed = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) failed.push({id, reason:'订单不存在'});
      else if (!canAccess(row.owner)) failed.push({id, reason:'无修改权限'});
      else succeeded.push(id);
    }
    if (succeeded.length) {
      await conn.query('UPDATE `orders` SET ' + keys.map(k => '`'+k+'` = ?').join(', ') + ' WHERE `id` IN (?)', [...keys.map(k => toSqlVal(patch[k], desc, k)), succeeded]);
    }
    await conn.commit();
    return {succeeded, failed, patch};
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

// All changed client associations and the survivor commit together.
export async function applyClientMerge(changes, removedIds){
 const conn=await pool.getConnection();
 try{
 await conn.beginTransaction();
 for(const [base,rows] of Object.entries(changes)){
  const desc=ARRAYS[base];if(!desc)throw Error('Unknown collection');
  for(const row of rows){
   if(desc.generic)await conn.query('UPDATE `'+tableOf(base)+'` SET data=? WHERE id=?',[JSON.stringify(row),row.id]);
   else {const cols=desc.fields.filter(k=>k!=='id');await conn.query('UPDATE `'+tableOf(base)+'` SET '+cols.map(k=>'`'+k+'`=?').join(',')+' WHERE id=?',[...cols.map(k=>toSqlVal(row[k],desc,k)),row.id]);}
  }
 }
 await conn.query('DELETE FROM clients WHERE id IN ('+removedIds.map(()=>'?').join(',')+')',removedIds);
 await conn.commit();
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
