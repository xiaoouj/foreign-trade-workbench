// 外贸人个人工作台 - 后端服务（Node 内置 http，无第三方依赖）
// 功能：静态资源托管 + 汇率代理（fxratesapi 优先，免费源兜底）+ 客户/订单 JSON 文件存储
//      + 多用户登录（HMAC 签名 token 会话，cookie 携带）+ 数据归属 owner + 分人业绩目标
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
// 数据访问层（MySQL / JSON 双后端，2026-08-21 升级）。对外 readJson/writeJson 签名不变，底层按 STORAGE_MODE 切换。
import * as dal from './db/dal.js';
import {normalizeSalesFields, createQuote, reviseQuote} from './sales-records.js';
// AI 管家编排层（2026-08-26 P0）：工具协议 + 查询工具服务端执行；写动作返回前端确认后走现有 REST（继承 RBAC/审计）
import { handleAiAgent } from './ai-agent.js';
// 文档解析（PDF/Word/Excel，2026-09-14 升级：替换手写实现）
import { parseDocument } from './doc-parser.js';
import { createReleaseNotice, blockedPublicPath, announcementWasRead } from './release-notice.js';
let releaseNotice;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 数据目录：默认项目内 data/，可通过环境变量 FTW_DATA_DIR 指向 NAS 共享文件夹（自动联动/备份）
const DATA_DIR = process.env.FTW_DATA_DIR ? path.resolve(process.env.FTW_DATA_DIR) : path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const INQ_FILE = path.join(DATA_DIR, 'inquiries.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const EXC_FILE = path.join(DATA_DIR, 'exceptions.json');
const SHIP_FILE = path.join(DATA_DIR, 'shipments.json');
const SUPP_FILE = path.join(DATA_DIR, 'suppliers.json');
const FIN_FILE = path.join(DATA_DIR, 'finance.json');
const COMM_FILE = path.join(DATA_DIR, 'comms.json');
const CTMPL_FILE = path.join(DATA_DIR, 'comm-templates.json');
const MAIL_FILE = path.join(DATA_DIR, 'mail.json');
const MAIL_SENT_FILE = path.join(DATA_DIR, 'mail-sent.json');
const SALES_FILE = path.join(DATA_DIR, 'sales.json');
const QUOTATIONS_FILE = path.join(DATA_DIR, 'quotations.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const AI_FILE = path.join(DATA_DIR, 'ai-config.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.json');
const SYSTEM_NOTICES_FILE = path.join(DATA_DIR, 'system-notices.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const CRM_IMPORTS_FILE = path.join(DATA_DIR, 'crm-imports.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CRM_IMPORT_DIR = path.join(UPLOAD_DIR, 'crm-imports');
// 供应商资料附件夹：每个供应商一个独立目录 data/uploads/suppliers/<supplierId>/<子文件夹>/
const SUPP_UPLOAD_DIR = path.join(UPLOAD_DIR, 'suppliers');
const BACKUP_DIR = path.join(DATA_DIR, '.backups');
const BACKUP_KEEP = 30; // 每个数据文件保留最近 30 份历史版本
const PORT = process.env.PORT || 4173;
// 存储后端：'mysql' 或 'json'。由 ensureStore() 调用 dal.initDAL() 后确定（MySQL 不可用时自动降级 'json'）。
let STORAGE_MODE = 'json';

// AI 默认配置：OpenAI 兼容接口（Ollama / LM Studio / vLLM / 云端均可）
const AI_DEFAULT = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen2.5:7b',
  apiKey: '',
  temperature: 0.2,
  timeout: 120000,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

// ---------- 签名密钥（持久化到数据目录，cookie 重启后仍有效） ----------
function loadSecret() {
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {
    const s = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); } catch { /* 忽略 */ }
    return s;
  }
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const SECRET = loadSecret();

// ---------- 密码哈希（scrypt + 盐） ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + h;
}
function verifyPw(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const hh = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  // 长度安全比较
  const a = Buffer.from(h, 'hex'), b = Buffer.from(hh, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- 会话 token（HMAC 签名，无状态，存于 cookie） ----------
function signToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function unsignToken(tok) {
  try {
    const [p, s] = String(tok).split('.');
    if (!p || !s) return null;
    const sig = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
    const a = Buffer.from(s), b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const obj = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (obj.exp && obj.exp < Date.now()) return null;
    return obj;
  } catch { return null; }
}

// ---------- 用户存储 ----------
// users.json 是全系统最关键的文件：旧实现解析失败会返回 { users: [] }，
// 表现为「全员无法登录」，而此时只要有人在用户管理里保存一次，真实账号就被永久覆盖。
// 因此这里同样上 备份 + 原子写 + 损坏自愈（同步版，因为调用方都是同步的）。
function backupUsersSync() {
  try {
    const cur = fs.readFileSync(USERS_FILE, 'utf8');
    if (!cur.trim()) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUP_DIR, `users.${stamp}.json`), cur, 'utf8');
    const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('users.') && f.endsWith('.json')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
function readUsers() {
  if (STORAGE_MODE === 'mysql') return { users: dal.getUsersSync() || [] };
  let raw;
  try { raw = fs.readFileSync(USERS_FILE, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { users: [] }; throw e; }
  if (!raw.trim()) return { users: [] };
  try { return JSON.parse(raw); }
  catch (e) {
    try {
      const all = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('users.') && f.endsWith('.json')).sort().reverse();
      for (const b of all) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, b), 'utf8'));
          console.error(`[store] users.json 已损坏，自动回退到备份 ${b}`);
          return data;
        } catch { /* 这份也坏，继续往前找 */ }
      }
    } catch { /* ignore */ }
    // 宁可让接口报错，也绝不返回空用户列表（那会导致真实账号被覆盖）
    throw new Error('users.json 已损坏且无可用备份，请从 data/.backups/ 手动恢复');
  }
}
async function writeUsers(obj) {
  if (STORAGE_MODE === 'mysql') { await dal.writeUsersAsync(obj); return; }
  const text = JSON.stringify(obj, null, 2);
  backupUsersSync();
  const tmp = `${USERS_FILE}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, USERS_FILE);
}
function getUserById(id) {
  const u = readUsers().users.find((x) => x.id === id);
  return u ? { id: u.id, username: u.username, name: u.name, role: u.role || 'sales', managerId: u.managerId || null } : null;
}
function decodeCookieVal(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}
function getCurrentUser(req) {
  // 1) 优先 cookie：兼容存在多个同名 ftw_sid 的情况（旧版本残留导致刷新后鉴权失败），
  //    逐个尝试，取首个有效的；避免“刷新回登录 / 重登无响应”的经典多 cookie 冲突
  const cookie = req.headers.cookie || '';
  const sidVals = cookie.split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('ftw_sid='))
    .map((p) => decodeCookieVal(p.slice('ftw_sid='.length)));
  for (const t of sidVals) {
    const tok = unsignToken(t);
    if (tok) { const u = getUserById(tok.uid); if (u) return u; }
  }
  // 2) 兜底：Authorization: Bearer <token>（前端 localStorage 持久化，刷新页面不丢失，比纯 cookie 更稳）
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const tok = unsignToken(auth.slice(7).trim());
    if (tok) { const u = getUserById(tok.uid); if (u) return u; }
  }
  return null;
}

// ---------- 数据文件初始化 ----------
async function ensureStore() {
  // 初始化存储后端（MySQL 或 JSON 文件）。STORAGE_MODE 由 dal.initDAL() 决定：
  // 若设置了 FTW_STORAGE=mysql 且 MariaDB 可连，则启用 MySQL；否则自动降级为 JSON 文件模式。
  STORAGE_MODE = await dal.initDAL();
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(CRM_IMPORT_DIR, { recursive: true });
  await fsp.mkdir(SUPP_UPLOAD_DIR, { recursive: true });

  if (STORAGE_MODE === 'mysql') {
    // MySQL 模式：schema 与默认值已由 dal 建好，这里仅确保首个管理员账号（若库为空且配置了强密码）
    const users = dal.getUsersSync();
    if ((!users || users.length === 0) && process.env.FTW_ADMIN_PASSWORD && String(process.env.FTW_ADMIN_PASSWORD).length >= 10) {
      const u = { id: 'u_' + genId().slice(0, 8), username: 'admin', name: '管理员', password: hashPw(process.env.FTW_ADMIN_PASSWORD), role: 'admin', managerId: null, mustChangePassword: true };
      await dal.writeUsersAsync({ users: [u] });
    }
    return;
  }

  // ---------- JSON 文件模式（降级 / 未启用 MySQL 时） ----------
  await fsp.mkdir(DATA_DIR, { recursive: true });
  // 用户：首次启动使用环境变量配置的管理员密码
  try { await fsp.access(USERS_FILE); } catch {
    const initialPassword = String(process.env.FTW_ADMIN_PASSWORD || '');
    if (initialPassword.length < 10) {
      throw new Error('首次启动必须设置 FTW_ADMIN_PASSWORD，且长度至少 10 位');
    }
    const u = { id: 'u_' + genId().slice(0, 8), username: 'admin', name: '管理员', password: hashPw(initialPassword), role: 'admin', managerId: null, mustChangePassword: true };
    await fsp.writeFile(USERS_FILE, JSON.stringify({ users: [u] }, null, 2), 'utf8');
  }
  for (const f of [CLIENTS_FILE, ORDERS_FILE, INQ_FILE, EMAILS_FILE, PRODUCTS_FILE, EXC_FILE, SHIP_FILE, SUPP_FILE, FIN_FILE, COMM_FILE, CTMPL_FILE, QUOTATIONS_FILE, TASKS_FILE, CONTACTS_FILE, CHATS_FILE, KNOWLEDGE_FILE, CRM_IMPORTS_FILE]) {
    try { await fsp.access(f); } catch { await fsp.writeFile(f, '[]', 'utf8'); }
  }
  // 跟进提醒：按用户存已读标记 { [uid]: { [key]: {read:true, at} } }
  try { await fsp.access(NOTIFICATIONS_FILE); } catch { await fsp.writeFile(NOTIFICATIONS_FILE, '{}', 'utf8'); }
  // 邮件账号：按 userId 存为对象 { [userId]: {...} }，不能用数组初始化（否则 JSON.stringify 会丢弃属性）
  // 兼容旧部署：若文件已存在却是 []（早期 bug 写成数组），读取后归一化为 {}，否则配置无法持久化。
  try {
    const raw = JSON.parse(await fsp.readFile(MAIL_FILE, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('reset');
  } catch { await fsp.writeFile(MAIL_FILE, '{}', 'utf8'); }
  // 发信历史文件
  try { await fsp.access(MAIL_SENT_FILE); } catch { await fsp.writeFile(MAIL_SENT_FILE, '{}', 'utf8'); }
  // 业绩目标：按用户存储 { [userId]: { yearMonthly } }
  try { await fsp.access(SALES_FILE); } catch { await fsp.writeFile(SALES_FILE, JSON.stringify({}, null, 2), 'utf8'); }
  // AI 配置：单对象
  try { await fsp.access(AI_FILE); } catch { await fsp.writeFile(AI_FILE, JSON.stringify(AI_DEFAULT, null, 2), 'utf8'); }
  // 系统设置（询盘来源等可配置项）
  try { await fsp.access(SETTINGS_FILE); } catch {
      await fsp.writeFile(SETTINGS_FILE, JSON.stringify({ inquirySources: ['阿里巴巴', '官网', '展会', 'Google', 'LinkedIn', '客户介绍', '其他'] }, null, 2), 'utf8');
  }
  // 操作审计日志：初始为空文件，运行时按 JSONL 逐行追加（见 logAudit）
  try { await fsp.access(AUDIT_FILE); } catch { await fsp.writeFile(AUDIT_FILE, '', 'utf8'); }
}

// 一次性迁移：把存量客户的单联系人字段（contactName/contactEmail/contactPhone）
// 转为 contacts.json 里的「主联系人」记录。仅当 contacts.json 为空时执行，幂等。
async function migrateContacts() {
  try {
    const list = await readJson(CONTACTS_FILE);
    if (Array.isArray(list) && list.length) return; // 已迁移过，跳过
    const clients = await readJson(CLIENTS_FILE);
    const rows = [];
    for (const c of clients) {
      const name = (c.contactName || '').trim();
      if (!name && !c.contactEmail && !c.contactPhone) continue;
      rows.push({
        id: genId(),
        clientId: c.id,
        name: name || (c.contactEmail || c.contactPhone || '联系人'),
        role: '采购',
        title: '',
        phone: c.contactPhone || '',
        email: c.contactEmail || '',
        isPrimary: true,
        notes: '',
        owner: c.owner || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    if (rows.length) await writeJson(CONTACTS_FILE, rows);
  } catch (e) {
    console.error('migrateContacts 跳过:', e.message);
  }
}
// ---------- JSON 存储层（2026-08-07 加固） ----------
// 旧实现有三个致命问题，这里逐条解决：
//   1) 直接覆盖写：写到一半断电/容器被杀会留下半截文件 → 改为 写.tmp + fsync + rename 原子替换
//   2) 无任何备份：改错/写坏无法回溯          → 每次覆盖前自动留档到 data/.backups/
//   3) 读失败静默返回 []：数据损坏会伪装成"暂无数据"，用户以为没数据其实是丢了
//      → 改为先尝试用最近一份完好备份自动恢复，恢复不了就抛错让接口显式 500
// 以下文件存的是对象而非数组，缺省空值必须是 {}（旧实现一律返回 [] 是个隐藏 bug）
const OBJECT_FILES = new Set([MAIL_FILE, MAIL_SENT_FILE, SALES_FILE, AI_FILE, SETTINGS_FILE, NOTIFICATIONS_FILE]);
const emptyFor = (file) => (OBJECT_FILES.has(file) ? {} : []);

// 同一文件的写入串行化，避免两个请求同时 rename 互相踩踏
const fileLocks = new Map();
function withFileLock(file, fn) {
  const next = (fileLocks.get(file) || Promise.resolve()).then(fn, fn);
  fileLocks.set(file, next.catch(() => {}));
  return next;
}

// 覆盖前留档；备份失败不阻断主流程（宁可写成功也不能因备份卡住业务）
async function backupFile(file) {
  try {
    const cur = await fsp.readFile(file, 'utf8');
    if (!cur.trim()) return;
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const name = path.basename(file, '.json');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(path.join(BACKUP_DIR, `${name}.${stamp}.json`), cur, 'utf8');
    const all = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.startsWith(name + '.') && f.endsWith('.json')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
      await fsp.unlink(path.join(BACKUP_DIR, old)).catch(() => {});
    }
  } catch { /* ignore */ }
}

// 从最新一份能正常解析的备份里把数据捞回来
async function restoreFromBackup(file) {
  try {
    const name = path.basename(file, '.json');
    const all = (await fsp.readdir(BACKUP_DIR))
      .filter((f) => f.startsWith(name + '.') && f.endsWith('.json')).sort().reverse();
    for (const b of all) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(BACKUP_DIR, b), 'utf8'));
        console.error(`[store] ${path.basename(file)} 解析失败，已自动回退到备份 ${b}`);
        return data;
      } catch { /* 这份也坏，继续往前找 */ }
    }
  } catch { /* ignore */ }
  return undefined;
}

async function jsonRead(file, fallback) {
  const empty = () => (fallback !== undefined ? fallback : emptyFor(file));
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return empty(); // 文件还没建，属正常
    throw e;
  }
  if (!raw.trim()) return empty();
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 文件在、内容却解析不了 = 数据损坏，尝试自愈
    const rescued = await restoreFromBackup(file);
    if (rescued !== undefined) {
      await fsp.rename(file, `${file}.corrupt.${Date.now()}`).catch(() => {}); // 留证据
      await writeJson(file, rescued).catch(() => {});
      return rescued;
    }
    throw new Error(`数据文件已损坏且无可用备份：${path.basename(file)}（${e.message}）`);
  }
}

async function jsonWrite(file, data) {
  // 先序列化：循环引用等问题在这里就抛出，绝不让原文件被截断成空
  const text = JSON.stringify(data, null, 2);
  if (typeof text !== 'string') throw new Error('数据无法序列化为 JSON');
  return withFileLock(file, async () => {
    await backupFile(file);
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync(); // 确认落盘再改名，断电也不会产生半截文件
    } finally {
      await fh.close();
    }
    // 同目录 rename = 原子替换；Windows 下偶发 EPERM/EBUSY（杀毒/索引占用），重试 + 兜底
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await fsp.rename(tmp, file); return; }
      catch (e) {
        lastErr = e;
        if (e && (e.code === 'EPERM' || e.code === 'EBUSY')) { await new Promise((r) => setTimeout(r, 25 * (attempt + 1))); continue; }
        throw e;
      }
    }
    // 兜底：先删旧文件再改名（牺牲原子性换取一定能落盘，仅在极端锁竞争时触发）
    try { await fsp.unlink(file).catch(() => {}); await fsp.rename(tmp, file); }
    catch (e) { throw lastErr || e; }
  });
}

// ---------- 双后端分发器（2026-08-21 升级） ----------
// 业务代码调用的仍是 readJson/writeJson，签名完全不变；底层按 STORAGE_MODE 切到 MySQL 或 JSON 文件。
async function readJson(file, fallback) {
  if (STORAGE_MODE === 'mysql') {
    const base = path.basename(file, '.json');
    return dal.readCollection(base, fallback);
  }
  return jsonRead(file, fallback);
}
async function writeJson(file, data) {
  if (STORAGE_MODE === 'mysql') {
    const base = path.basename(file, '.json');
    return dal.writeCollection(base, data);
  }
  return jsonWrite(file, data);
}

// 每日快照：当天第一次启动时把整个 data/ 完整留一份，误删/误改可整体回滚
async function dailySnapshot() {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(BACKUP_DIR, 'daily', day);
    try { await fsp.access(dir); return; } catch { /* 今天还没做，继续 */ }
    await fsp.mkdir(dir, { recursive: true });
    if (STORAGE_MODE === 'mysql') {
      // MySQL 模式：把全量集合导出为一份 JSON 快照（mysqldump 另行做物理备份）
      const all = await dal.exportAll();
      await fsp.writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(all, null, 2), 'utf8');
    } else {
      for (const f of await fsp.readdir(DATA_DIR)) {
        if (!f.endsWith('.json')) continue;
        await fsp.copyFile(path.join(DATA_DIR, f), path.join(dir, f)).catch(() => {});
      }
    }
    // 只留最近 14 天
    const days = (await fsp.readdir(path.join(BACKUP_DIR, 'daily'))).sort();
    for (const old of days.slice(0, Math.max(0, days.length - 14))) {
      await fsp.rm(path.join(BACKUP_DIR, 'daily', old), { recursive: true, force: true }).catch(() => {});
    }
    console.log(`[store] 已生成每日快照: ${dir}`);
  } catch (e) { console.error('[store] 每日快照失败', e.message); }
}
// 读取某用户的业绩目标（兼容旧结构：旧的全局 yearMonthly 迁移到首个访问用户，保留其他用户数据）
async function getSalesForUser(uid) {
  const data = await readJson(SALES_FILE);
  if (Array.isArray(data)) return { yearMonthly: {} };
  if (data && data.yearMonthly && !data[uid]) {
    const migrated = { ...data };      // 保留已有的按人数据
    delete migrated.yearMonthly;       // 移除旧的顶层全局键
    migrated[uid] = { yearMonthly: data.yearMonthly };
    await writeJson(SALES_FILE, migrated);
    return migrated[uid];
  }
  return data[uid] || { yearMonthly: {} };
}

// ---------- 汇率模块 ----------
// 缓存：避免频繁请求外部 API
let ratesCache = { at: 0, data: null, ttl: 30 * 1000 };

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 免费实时汇率：主源 fxratesapi（用户指定源，免费、免 key、近实时），被拦截时兜底到多个免费源。
// 不依赖任何付费服务（如 XE）。所有源均免费、无需 API key。
function abortAfter(ms = 8000) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function fetchRates(base, symbols) {
  const syms = (symbols || []).filter(Boolean);
  const rates = {};
  const sources = [];

  const fill = (obj) => {
    let n = 0;
    for (const s of syms) {
      if (!(s in rates) && typeof obj[s] === 'number') { rates[s] = obj[s]; n++; }
    }
    return n;
  };

  // 0) fxratesapi.com：免费、免 key 实时汇率（用户指定源，首选）
  try {
    const r = await fetch(`https://api.fxratesapi.com/latest?base=${base}&symbols=${syms.join(',')}`, { signal: abortAfter(12000) });
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && fill(j.rates)) sources.push('fxratesapi');
    }
  } catch (e) { /* 继续兜底 */ }

  // 1) freeforexapi：真·实时外汇报价，免 key（仅支持 USD 基准）
  if (base === 'USD') {
    try {
      const pairs = syms.filter((s) => s !== 'USD').map((s) => `USD${s}`).join(',');
      if (pairs) {
        const r = await fetch(`https://api.freeforexapi.com/v1/rates?pairs=${pairs}`, { signal: abortAfter() });
        if (r.ok) {
          const j = await r.json();
          const map = {};
          for (const k of Object.keys(j.rates || {})) {
            const sym = k.replace(/^USD/, '');
            if (j.rates[k] && typeof j.rates[k].rate === 'number') map[sym] = j.rates[k].rate;
          }
          if (fill(map)) sources.push('freeforexapi（实时）');
        }
      }
    } catch (e) { /* 继续兜底 */ }
  }

  // 2) exchangerate-api v4：免费、免 key（日更）
  try {
    const r = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`, { signal: abortAfter() });
    if (r.ok) {
      const j = await r.json();
      if (fill(j.rates || {})) sources.push('exchangerate-api');
    }
  } catch (e) { /* 继续兜底 */ }

  // 3) fawazahmed0（jsDelivr CDN）：免费、免 key（日更）
  try {
    const bl = base.toLowerCase(), sl = syms.map((s) => s.toLowerCase());
    const r = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${bl}.json`, { signal: abortAfter() });
    if (r.ok) {
      const j = await r.json();
      const obj = {};
      for (const s of sl) if (j[bl] && typeof j[bl][s] === 'number') obj[s.toUpperCase()] = j[bl][s];
      if (fill(obj)) sources.push('fawazahmed0');
    }
  } catch (e) { /* 继续兜底 */ }

  // 4) frankfurter（欧洲央行）：免费、免 key（日更）
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${syms.join(',')}`, { signal: abortAfter() });
    if (r.ok) {
      const j = await r.json();
      if (fill(j.rates || {})) sources.push('frankfurter(ECB)');
    }
  } catch (e) { /* 失败 */ }

  if (!Object.keys(rates).length) throw new Error('所有免费汇率源均不可用');
  rates[base] = 1; // 基准币种自身汇率恒为 1；各源返回的 rates 均为 base 相对值，但 frankfurter/freeforexapi 等会省略基准键，补全以避免 USD 等基准币种换算失败
  return { base, rates, source: sources.join(' + ') || 'unknown', updated: Date.now() };
}

async function getRates(base, symbols) {
  const now = Date.now();
  if (ratesCache.data && now - ratesCache.at < ratesCache.ttl && ratesCache.data.base === base) {
    // 命中缓存，但补齐可能新增的 symbol
    const need = symbols.filter((s) => !(s in ratesCache.data.rates));
    if (need.length === 0) return ratesCache.data;
  }
  const data = await fetchRates(base, symbols);
  ratesCache = { at: now, data, ttl: ratesCache.ttl };
  return data;
}

// ---------- HTTP 工具 ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  // 记下响应里的主键，供审计补全新建记录的 recordId（POST 时 URL 中没有 id）
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.id) res._auditId = obj.id;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
// Read once at arrival, outside the mutation queue. An aborted or slow upload
// must not retain the global write lock or leave a later reader waiting for 'end'.
function receiveBody(req) {
  if (req._rawBody) return req._rawBody;
  req._rawBody = new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, settled = false;
    const finish = (error) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      req.removeListener('data', onData); req.removeListener('end', onEnd);
      req.removeListener('aborted', onAbort); req.removeListener('error', onError);
      if (error) reject(error); else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) { finish(permissionError('请求内容过大',413)); req.resume(); }
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onAbort = () => finish(permissionError('请求已中断',400));
    const onError = error => finish(error);
    const timer = setTimeout(() => { finish(permissionError('请求正文接收超时',408)); req.resume(); },30000);
    req.on('data',onData); req.once('end',onEnd); req.once('aborted',onAbort); req.once('error',onError);
    if (req.aborted || (req.destroyed && !req.complete)) onAbort();
    else if (req.readableEnded) onEnd();
  });
  return req._rawBody;
}
async function readBody(req) {
  const raw = await receiveBody(req);
  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { throw permissionError('请求不是有效 JSON',400); }
  return validateBusinessBody(req,body);
}
// 附件按关联业务记录授权；无关联的新附件仅上传人可见，历史孤立附件留给管理人员。
function uploadLinks(value, result = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\/uploads\/[^\s"'<>\)]+/g)) {
      try { result.add(decodeURIComponent(match[0].split(/[?#]/)[0])); } catch {}
    }
  } else if (Array.isArray(value)) value.forEach(x => uploadLinks(x, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(x => uploadLinks(x, result));
  return result;
}
async function canReadUpload(user, urlPath) {
  if (!user) return false;
  if (isBusinessManager(user)) return true;
  if (urlPath.startsWith('/uploads/suppliers/')) return true;
  let referenced = false;
  for (const file of [CLIENTS_FILE, INQ_FILE, ORDERS_FILE, QUOTATIONS_FILE, SHIP_FILE, EXC_FILE, FIN_FILE, COMM_FILE, EMAILS_FILE, TASKS_FILE, CONTACTS_FILE, CHATS_FILE, KNOWLEDGE_FILE, PRODUCTS_FILE, SUPP_FILE, CTMPL_FILE]) {
    const shared = [PRODUCTS_FILE, SUPP_FILE, CTMPL_FILE].includes(file);
    for (const row of await readJson(file)) {
      if (!uploadLinks(row).has(urlPath)) continue;
      referenced = true;
      if (shared || canAccessRecord(user, row.owner)) return true;
    }
  }
  if (urlPath.startsWith('/uploads/crm-imports/')) {
    const job = (await readJson(CRM_IMPORTS_FILE)).find(x => '/uploads/crm-imports/' + x.storedName === urlPath);
    return !!job && canAccessRecord(user, job.owner);
  }
  if (referenced) return false;
  const owners = await jsonRead(path.join(DATA_DIR, 'upload-owners.json'), {});
  return owners[urlPath] === user.id;
}
async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // /uploads/ 路径从数据目录读取（询盘附件等）
  if (urlPath.startsWith('/uploads/')) {
    const uploadFile = path.resolve(UPLOAD_DIR, urlPath.slice('/uploads/'.length));
    if (!uploadFile.startsWith(UPLOAD_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    if (!getCurrentUser(req)) return sendJson(res, 401, { error: '未登录' });
    if (!await canReadUpload(getCurrentUser(req), '/uploads/' + path.relative(UPLOAD_DIR, uploadFile).split(path.sep).join('/'))) return sendJson(res, 403, { error: '无权访问该附件' });
    try {
      const buf = await fsp.readFile(uploadFile);
      const extMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };
      res.writeHead(200, { 'Content-Type': extMap[path.extname(uploadFile).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    } catch { res.writeHead(404); return res.end('404 Not Found'); }
  }
  if (blockedPublicPath(urlPath)) { res.writeHead(404); return res.end('404 Not Found'); }
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const buf = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // 关键：静态资源禁用强缓存，避免浏览器缓存到「开发中途」的旧 JS/HTML，
    // 否则旧版本（模块未写完）会在登录后立刻报错并闪退回登录页。
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(ext === '.html' ? releaseNotice.inject(buf.toString('utf8')) : buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

// ---------- AI 辅助函数 ----------
function safeImportFileName(value) {
  return String(value || 'file').replace(/[/\\:*?"<>|#]/g, '_').slice(0, 200) || 'file';
}
function decodeImportFile(name, data) {
  const ext = path.extname(name).toLowerCase();
  const supported = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.csv']);
  if (!supported.has(ext)) throw new Error('仅支持 PDF、DOCX、XLSX、TXT、CSV；旧版 DOC/XLS 请先另存为 DOCX/XLSX。');
  const raw = String(data || '').trim();
  if (!raw) throw new Error('缺少文件数据');
  const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > 20 * 1024 * 1024) throw new Error('单个文件须小于 20 MB');
  return { ext, buf };
}
async function parseImportDocument(ext, buf) {
  // 2026-09-14：改为调用 doc-parser.js（mammoth/xlsx/pdf-parse）
  return await parseDocument(ext, buf);
}
function importText(value, max = 2000) { return String(value == null ? '' : value).trim().slice(0, max); }
function importKey(value) { return importText(value, 300).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function parseImportAiJson(raw) {
  const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(text); } catch {
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('AI 返回的不是有效 JSON，请重试或换用更稳定的模型。');
  }
}
async function visibleImportClients(user) {
  const all = await readJson(CLIENTS_FILE);
  const owners = buildVisibleOwners(user);
  return owners ? all.filter((x) => owners.has(x.owner)) : all;
}
function normalizeImportAnalysis(raw, existing) {
  const seen = new Set();
  const clients = [];
  for (const item of (Array.isArray(raw?.clients) ? raw.clients : []).slice(0, 200)) {
    const company = importText(item?.company, 300);
    if (!company || seen.has(importKey(company))) continue;
    seen.add(importKey(company));
    const email = importText(item?.contactEmail, 300).toLowerCase();
    const match = existing.find((x) => importKey(x.company) === importKey(company) || (email && importText(x.contactEmail, 300).toLowerCase() === email));
    clients.push({ rowId: 'c_' + clients.length, decision: match ? 'skip' : 'create', duplicateOf: match ? { id: match.id, company: match.company } : null, data: { company, country: importText(item.country, 120), website: importText(item.website, 500), address: importText(item.address, 500), contactName: importText(item.contactName, 160), contactEmail: email, contactPhone: importText(item.contactPhone, 120), stage: importText(item.stage, 50) || '潜在', source: importText(item.source, 100) || '文件导入', tags: Array.isArray(item.tags) ? item.tags.map((x) => importText(x, 50)).filter(Boolean).slice(0, 20) : [], notes: importText(item.notes, 4000) } });
  }
  const companyKnown = new Set(clients.map((x) => importKey(x.data.company)));
  const entities = (key, fields) => (Array.isArray(raw?.[key]) ? raw[key] : []).map((x, i) => ({ rowId: key.slice(0, 1) + '_' + i, data: Object.fromEntries(fields.map((f) => [f, importText(x?.[f], f === 'content' || f === 'notes' ? 8000 : 500)])), companyKey: importKey(x?.company) })).filter((x) => x.companyKey && (companyKnown.has(x.companyKey) || existing.some((c) => importKey(c.company) === x.companyKey)));
  return { clients, contacts: entities('contacts', ['company', 'name', 'role', 'email', 'phone']), inquiries: entities('inquiries', ['company', 'product', 'country', 'contactName', 'contactEmail', 'expectedAmount', 'currency', 'source', 'notes']), comms: entities('comms', ['company', 'channel', 'content', 'date']) };
}
function importJobForClient(job) {
  const { sourceText, storedName, ...safe } = job;
  return { ...safe, textLength: String(sourceText || '').length };
}
async function commitImportJob(job, decisions, user) {
  const clients = await readJson(CLIENTS_FILE), contacts = await readJson(CONTACTS_FILE), inquiries = await readJson(INQ_FILE), comms = await readJson(COMM_FILE);
  const now = Date.now(), result = { created: 0, updated: 0, skipped: 0, contacts: 0, inquiries: 0, comms: 0 };
  const sourceDoc = { importJobId: job.id, name: job.originalName, importedAt: now };
  const byCompany = new Map(visibleRecords(clients, user).map((c) => [importKey(c.company), c]));
  for (const row of job.analysis.clients || []) {
    const choice = ['create', 'update', 'skip'].includes(decisions[row.rowId]) ? decisions[row.rowId] : row.decision;
    const incoming = row.data || {}; const key = importKey(incoming.company); const old = byCompany.get(key);
    if (choice === 'skip') { result.skipped++; continue; }
    if (old && choice === 'update') {
      if (!canAccessRecord(user, old.owner)) { result.skipped++; continue; }
      for (const k of ['country', 'website', 'address', 'contactName', 'contactEmail', 'contactPhone', 'stage', 'source', 'notes']) if (incoming[k]) old[k] = incoming[k];
      old.tags = [...new Set([...(old.tags || []), ...(incoming.tags || [])])];
      old.sourceDocuments = [...(old.sourceDocuments || []), sourceDoc]; old.updatedAt = now; result.updated++; continue;
    }
    if (old) { result.skipped++; continue; }
    const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner({ ...incoming, sourceDocuments: [sourceDoc], importJobId: job.id }, user) };
    clients.push(item); byCompany.set(key, item); result.created++;
  }
  for (const row of job.analysis.contacts || []) {
    const client = byCompany.get(row.companyKey), d = row.data || {};
    if (!client || !d.name) continue;
    const exists = contacts.some((x) => x.clientId === client.id && ((d.email && String(x.email || '').toLowerCase() === d.email.toLowerCase()) || importKey(x.name) === importKey(d.name)));
    if (!exists) { contacts.push({ id: genId(), createdAt: now, updatedAt: now, ...withOwner({ clientId: client.id, name: d.name, role: d.role, email: d.email, phone: d.phone, importJobId: job.id }, user) }); result.contacts++; }
  }
  for (const row of job.analysis.inquiries || []) {
    const client = byCompany.get(row.companyKey), d = row.data || {};
    if (!client || !d.product) continue;
    inquiries.push({ id: genId(), createdAt: now, updatedAt: now, clientId: client.id, clientName: client.company, country: d.country || client.country, contactName: d.contactName || client.contactName, contactEmail: d.contactEmail || client.contactEmail, product: d.product, expectedAmount: d.expectedAmount, currency: d.currency || 'USD', source: d.source || '文件导入', notes: d.notes, status: '新询盘', receivedAt: new Date().toISOString().slice(0, 10), owner: user.id, ownerName: user.name, importJobId: job.id }); result.inquiries++;
  }
  for (const row of job.analysis.comms || []) {
    const client = byCompany.get(row.companyKey), d = row.data || {};
    if (!client || !d.content) continue;
    comms.push({ id: genId(), createdAt: now, updatedAt: now, ...withOwner({ clientId: client.id, clientName: client.company, channel: d.channel || '文件导入', content: d.content, date: d.date || new Date().toISOString().slice(0, 10), source: 'file-import', importJobId: job.id }, user) }); result.comms++;
  }
  await writeJson(CLIENTS_FILE, clients); await writeJson(CONTACTS_FILE, contacts); await writeJson(INQ_FILE, inquiries); await writeJson(COMM_FILE, comms);
  return result;
}
function resolveAiCfg(override = {}) {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(AI_FILE, 'utf8')); } catch { stored = {}; }
  const merged = { ...AI_DEFAULT, ...stored };
  for (const k of ['baseUrl', 'model', 'apiKey', 'temperature', 'timeout']) {
    if (override[k] === undefined || override[k] === '') continue;
    if (override[k] === '********') merged[k] = stored[k]; // 掩码回传，保留原值
    else merged[k] = override[k];
  }
  if (merged.baseUrl && !/^https?:\/\//i.test(merged.baseUrl)) merged.baseUrl = 'http://' + merged.baseUrl;
  return merged;
}
function joinUrl(base, suffix) {
  const b = (base || '').trim().replace(/\/+$/, '');
  let s = suffix || '';
  if (!s.startsWith('/')) s = '/' + s;
  return b + s;
}
function aiHeaders(cfg) {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) h['Authorization'] = 'Bearer ' + cfg.apiKey;
  return h;
}
function aiErrMsg(e, cfg) {
  if (e && e.name === 'AbortError') return `连接 ${cfg.baseUrl} 超时（请确认本地 AI 服务已启动且地址正确）`;
  return `无法连接 AI 接口 ${cfg.baseUrl}：${e && e.message ? e.message : e}`;
}

// 管理员、经理处理全员业务；业务员仅处理本人，未归属记录不对业务员开放。
function isBusinessManager(user) { return !!user && ['admin', 'manager'].includes(user.role); }
function buildVisibleOwners(user) { return isBusinessManager(user) ? null : new Set(user ? [user.id] : []); }
function canAccessRecord(user, ownerId) { return !!user && (isBusinessManager(user) || (!!ownerId && ownerId === user.id)); }
function visibleRecords(rows, user) { return rows.filter(row => canAccessRecord(user, row.owner)); }
function permissionError(message, status = 403) { return Object.assign(new Error(message), { status }); }
function ownerFields(body, user) {
  const owner = body.owner || user.id;
  if (!isBusinessManager(user) && owner !== user.id) throw permissionError('业务员只能设置本人为跟进人');
  const target = readUsers().users.find(u => u.id === owner);
  if (!target) throw permissionError('跟进人不存在', 400);
  return { owner: target.id, ownerName: target.name || target.username };
}
function withOwner(body, user) {
  const { id, createdAt, updatedAt, ...fields } = body;
  return { ...fields, ...ownerFields(body, user) };
}
const OWNED_API = /^\/api\/(clients|orders|inquiries|quotations|shipments|emails|comms|exceptions|finance|tasks|contacts|chats|knowledge|comm-templates|products|suppliers)(?:\/|$)/;
async function validateBusinessBody(req, body) {
  if (!req.user || !OWNED_API.test(new URL(req.url, 'http://local').pathname)) return body;
  const user = req.user;
  const validate = async value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw permissionError('记录格式错误', 400);
    if ('owner' in value) Object.assign(value, ownerFields(value, user));
    else delete value.ownerName; // 姓名由服务端根据账号确定，不能伪造
    delete value.id; delete value.createdAt; delete value.updatedAt;
    for (const [key, file] of [['clientId', CLIENTS_FILE], ['inquiryId', INQ_FILE], ['orderId', ORDERS_FILE], ['quotationId', QUOTATIONS_FILE], ['quoteId', QUOTATIONS_FILE]]) {
      if (!value[key]) continue;
      const target = (await readJson(file)).find(row => row.id === value[key]);
      if (!target || !canAccessRecord(user, target.owner)) throw permissionError('无权限关联该业务记录');
    }
    for (const link of uploadLinks(value)) if (!await canReadUpload(user, link)) throw permissionError('无权关联该附件');
    return value;
  };
  await validate(body);
  if (Array.isArray(body.records)) { for (const record of body.records) await validate(record); }
  if (body.patch) await validate(body.patch);
  return body;
}
async function unmarkPrimary(list, clientId, exceptId, user) {
  if (!clientId) return;
  for (const c of list) if (c.clientId === clientId && c.id !== exceptId && c.isPrimary && canAccessRecord(user, c.owner)) c.isPrimary = false;
}

// ---------- 操作审计日志 ----------
// 操作审计：独立内存队列 + 逐行追加(JSONL)，避免高频 read-modify-write-rename 在 Windows 下的锁竞争与丢更新。
// 审计文件本身不做 owner 隔离（仅管理员可查看）。
const _auditQueue = [];
let _auditFlushing = false;
function logAudit(user, action, table, recordId, summary) {
  if (!user) return;
  _auditQueue.push({
    ts: Date.now(),
    userId: user.id,
    userName: user.name,
    role: user.role || 'sales',
    action,        // create | update | delete | login
    table,         // clients | orders | inquiries | ... | auth
    recordId: recordId || null,
    summary: String(summary || '').slice(0, 200),
  });
  if (!_auditFlushing) { _auditFlushing = true; flushAudit().catch(() => {}); }
}
async function flushAudit() {
  try {
    while (_auditQueue.length) {
      const batch = _auditQueue.splice(0, 200);
      if (STORAGE_MODE === 'mysql') {
        await dal.insertAudit(batch);
      } else {
        const lines = batch.map((e) => JSON.stringify(e) + '\n').join('');
        const fh = await fsp.open(AUDIT_FILE, 'a');
        try { await fh.writeFile(lines, 'utf8'); await fh.sync(); } finally { await fh.close(); }
      }
    }
  } catch (e) { console.error('[audit] 写入失败', e.message); }
  finally { _auditFlushing = false; }
}
async function readAudit() {
  if (STORAGE_MODE === 'mysql') {
    try { return await dal.selectAudit(); } catch { return []; }
  }
  try {
    const raw = await fsp.readFile(AUDIT_FILE, 'utf8');
    return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

// ---------- 邮件发送（Node 内置 net/tls，无第三方依赖） ----------
// 返回 Promise；成功 resolve({ok:true})，失败 reject(Error)
function sendSmtpMail(cfg) {
  const port = Number(cfg.port) || (cfg.secure ? 465 : 587);
  const doStarttls = !cfg.secure && cfg.starttls !== false;
  let buf = '';
  let dataHandler = null;
  return new Promise((resolve, reject) => {
    let sock;
    try {
      sock = cfg.secure
        ? tls.connect({ host: cfg.host, port, rejectUnauthorized: false, timeout: 30000 })
        : net.connect({ host: cfg.host, port, timeout: 30000 });
    } catch (e) { return reject(e); }

    let expecting = null;
    function waitFor(code) {
      return new Promise((res, rej) => { expecting = { code, res, rej }; });
    }
    function sendline(s) { try { sock.write(s + '\r\n'); } catch (e) { reject(e); } }
    const caps = [];
    function onLine(line) {
      const m = /^(\d{3})([\s-])(.*)$/.exec(line);
      if (!m) return;
      const code = m[1];
      if (m[2] === '-') { if (/STARTTLS/i.test(line)) caps.push('STARTTLS'); return; }
      if (/STARTTLS/i.test(line)) caps.push('STARTTLS');
      const exp = expecting; expecting = null;
      if (!exp) return;
      if (code[0] === '2' || code === exp.code) exp.res({ code, text: m[3] });
      else exp.rej(new Error(`SMTP ${code}: ${m[3]}`));
    }
    function attachData(s) {
      if (dataHandler) s.removeListener('data', dataHandler);
      dataHandler = (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          onLine(line);
        }
      };
      s.on('data', dataHandler);
    }
    sock.on('error', (e) => { if (expecting) { expecting.rej(e); expecting = null; } else reject(e); });
    sock.on('timeout', () => { try { sock.destroy(); } catch {} reject(new Error('SMTP 连接超时')); });
    attachData(sock);

    (async () => {
      try {
        await waitFor('220'); // 服务就绪
        sendline('EHLO ' + (cfg.helo || 'localhost'));
        await waitFor('250');
        if (doStarttls && caps.includes('STARTTLS')) {
          sendline('STARTTLS');
          await waitFor('220');
          const tlsSock = await new Promise((res, rej) => {
            const t = tls.connect({ socket: sock, rejectUnauthorized: false });
            t.on('secureConnect', () => res(t));
            t.on('error', rej);
          });
          sock.removeListener('data', dataHandler);
          sock = tlsSock;
          sock.on('error', (e) => { if (expecting) { expecting.rej(e); expecting = null; } else reject(e); });
          sock.on('timeout', () => { try { sock.destroy(); } catch {} reject(new Error('SMTP 连接超时')); });
          caps.length = 0;
          attachData(sock);
          sendline('EHLO ' + (cfg.helo || 'localhost'));
          await waitFor('250');
        }
        if (cfg.user) {
          sendline('AUTH LOGIN');
          await waitFor('334');
          sendline(Buffer.from(String(cfg.user), 'utf8').toString('base64'));
          await waitFor('334');
          sendline(Buffer.from(String(cfg.pass || ''), 'utf8').toString('base64'));
          await waitFor('235');
        }
        sendline('MAIL FROM:<' + cfg.from + '>');
        await waitFor('250');
        const recips = [cfg.to, cfg.cc, cfg.bcc].filter(Boolean)
          .flatMap((x) => String(x).split(','))
          .map((s) => s.trim()).filter(Boolean);
        for (const r of recips) { sendline('RCPT TO:<' + r + '>'); await waitFor('250'); }
        sendline('DATA');
        await waitFor('354');
        sendline(buildMime({
          from: cfg.from, to: cfg.to, cc: cfg.cc,
          subject: cfg.subject || '(无主题)', text: cfg.text || '', html: cfg.html || '',
        }));
        sendline('.');
        await waitFor('250');
        sendline('QUIT');
        resolve({ ok: true });
      } catch (e) {
        try { sock.write('QUIT\r\n'); } catch {}
        reject(e);
      }
    })();
  });
}
function buildMime({ from, to, cc, subject, text, html }) {
  const boundary = '----ftw' + Date.now().toString(36);
  const headers = [
    'From: ' + from,
    'To: ' + to,
    cc ? 'Cc: ' + cc : '',
    'Subject: =?UTF-8?B?' + Buffer.from(subject || '', 'utf8').toString('base64') + '?=',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
  ].filter(Boolean).join('\r\n');
  let parts = '';
  if (text) parts += '--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') + '\r\n';
  if (html) parts += '--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n' + html.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') + '\r\n';
  parts += '--' + boundary + '--\r\n';
  return headers + '\r\n' + parts;
}

// ---------- 供应商资料附件夹 ----------
// 目录两级结构（方便按产品找资料）：
//   data/uploads/suppliers/<产品分类>/<公司名称>/<8位前缀>-<文件名>
// 第一层 = 产品分类（取供应商 category，未填归「未分类」）；第二层 = 公司名称（取供应商 name）。
// 类型白名单：在 /api/upload 基础上补充外贸常用格式（PPT / DWG / STEP / 压缩包等）
const SUPP_FILE_ALLOWED = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.zip', '.rar', '.7z', '.mp4',
  '.dwg', '.dxf', '.step', '.stp', '.igs', '.iges',
]);
// 路径片段消毒：去掉分隔符 / 非法字符与首尾点，杜绝 ../ 穿越
function cleanSeg(seg, max) {
  return String(seg || '')
    .replace(/[/\\:*?"<>|]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 60);
}
// 供应商资料目录相对路径：<产品分类>/<公司名称>
function suppRelDir(s) {
  const cat = cleanSeg(s && s.category) || '未分类';
  let nm = cleanSeg(s && s.name) || '';
  if (!nm) nm = 'supplier-' + String((s && s.id) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'supplier';
  return cat + '/' + nm;
}
function suppFileDir(s) {
  return path.join(SUPP_UPLOAD_DIR, suppRelDir(s));
}
// 文件名消毒：去掉路径分隔符与 Windows 非法字符，去首尾点，限长 160
function safeSuppFileName(name) {
  const cleaned = String(name || '')
    .replace(/[/\\:*?"<>|]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '_')
    .trim();
  return (cleaned || 'file').slice(0, 160);
}
// 列出某供应商资料目录下的全部附件（按修改时间倒序）
async function listSuppFiles(s) {
  const base = suppFileDir(s);
  const out = [];
  let names = [];
  try { names = await fsp.readdir(base); } catch { return out; }
  for (const n of names) {
    const full = path.join(base, n);
    let st;
    try { st = await fsp.stat(full); } catch { continue; }
    if (!st.isFile()) continue;
    // 存储名格式 <8位hex>-<原文件名>，去掉前缀还原展示名
    const m = n.match(/^[0-9a-f]{8}-(.*)$/);
    out.push({
      stored: n,
      name: m ? m[1] : n,
      size: st.size,
      mtime: st.mtimeMs,
      ext: path.extname(n).toLowerCase(),
      url: '/uploads/suppliers/' + suppRelDir(s).split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(n),
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------- 路由 ----------
// maxHeaderSize 提高到 64KB：cookie 按「域名」共享（与端口无关），QNAP 管理台及
// 同主机其它应用的 cookie 会全部带到本服务；Node 默认 16KB 超限会直接 431 断开，
// 表现为「不删除 cookies 连登录都提交不了」。64KB 对局域网应用是安全上限。
// 需要串行执行的写接口：它们都是"读全表 → 改一条 → 写回全表"，并发跑会丢更新
// （两个人同时改客户，后写的会把先写的整份覆盖掉）。这类操作只是本地毫秒级读写，
// 排队不影响体验；AI 对话、邮件收发、汇率等耗时接口刻意不入队，避免相互阻塞。
const WRITE_LOCK_PATHS = /^\/api\/(clients|orders|inquiries|shipments|products|emails|comms|comm-templates|suppliers|finance|exceptions|sales|settings|users|tasks|contacts|chats|webhook|quotations|knowledge|notifications|system-notices|announcement|crm-imports|upload|mail|ai)\b/;
let writeChain = Promise.resolve();
function serializeWrite(fn) {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

const server = http.createServer({ maxHeaderSize: 64 * 1024 }, async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const method = req.method;
  // These AI operations only read business data; keeping them in the write
  // queue blocks ordinary saves for the duration of the remote model request.
  const readOnlyAi = method === 'POST' && /^\/api\/ai\/(test|chat|agent)$/.test(p);
  try {
    if (!['GET','HEAD','OPTIONS'].includes(method)) await receiveBody(req);
    const run = () => {
      if (req.aborted || res.destroyed) return;
      return handleRequest(req,res,url,p,method);
    };
    if (method !== 'GET' && WRITE_LOCK_PATHS.test(p) && !readOnlyAi) return await serializeWrite(run);
    return await run();
  } catch (error) {
    if (!res.destroyed && !res.headersSent) sendJson(res,error.status || 400,{error:error.message});
  }
});

async function handleRequest(req, res, url, p, method) {
  try {
    // ---------- 公开路由 ----------
    if (p === '/api/version' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 200, await releaseNotice.version());
    }
    // 登录
    if (p === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const users = readUsers().users;
      const u = users.find((x) => x.username === String(body.username || '').trim());
      if (!u || !verifyPw(body.password || '', u.password)) return sendJson(res, 401, { error: '用户名或密码错误' });
      const token = signToken(u.id);
      // 同时清理旧版本残留的 Path=/api 同名 cookie（旧版 Set-Cookie 未指定 Path 时默认 /api，
      // 该 cookie 永不失效且无法被 Path=/ 的新 cookie 覆盖，会长期占用请求头体积）
      res.setHeader('Set-Cookie', [
        `ftw_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
        'ftw_sid=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0',
      ]);
      // 同时回传 token，前端写入 localStorage 并以 Bearer 头发送，刷新页面不丢失会话
      logAudit({ id: u.id, name: u.name, role: u.role || 'sales' }, 'login', 'auth', null, '登录成功');
      return sendJson(res, 200, { id: u.id, username: u.username, name: u.name, role: u.role || 'sales', token });
    }
    // 登出
    if (p === '/api/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', [
        'ftw_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        'ftw_sid=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0',
      ]);
      return sendJson(res, 200, { ok: true });
    }
    // 当前登录用户
    if (p === '/api/me' && method === 'GET') {
      const u = getCurrentUser(req);
      if (!u) return sendJson(res, 401, { error: '未登录' });
      return sendJson(res, 200, u);
    }
    // 汇率（公开）
    if (p === '/api/rates' && method === 'GET') {
      const base = (url.searchParams.get('base') || 'USD').toUpperCase();
      const symbols = (url.searchParams.get('symbols') || 'CNY,EUR,GBP,JPY')
        .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      try {
        const data = await getRates(base, symbols);
        return sendJson(res, 200, data);
      } catch (e) {
        return sendJson(res, 502, { error: e.message });
      }
    }

    // ---------- 消息接入 Webhook（自建接入端推入 WhatsApp/微信/邮件消息） ----------
    // 鉴权独立于此处下方的登录态校验：接入端用 FTW_WEBHOOK_SECRET 作为 Bearer token。
    // 无归属的接入消息仅管理员和经理可见，由管理人员分配。
    if (p === '/api/webhook/incoming' && method === 'POST') {
      const secret = process.env.FTW_WEBHOOK_SECRET || '';
      if (!secret) return sendJson(res, 503, { error: 'Webhook 未配置：请在环境变量中设置 FTW_WEBHOOK_SECRET' });
      const auth = req.headers.authorization || '';
      const supplied = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const a = Buffer.from(supplied), b = Buffer.from(secret);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return sendJson(res, 401, { error: 'Webhook 鉴权失败' });
      }
      const body = await readBody(req);
      const CH_MAP = { whatsapp: 'WhatsApp', wechat: '微信', email: '邮件', phone: '电话' };
      const channel = CH_MAP[String(body.channel || '').toLowerCase()] || '其他';
      const clientName = String(body.contactName || body.clientName || '').trim();
      const content = String(body.content || '').trim();
      if (!clientName || !content) return sendJson(res, 400, { error: 'contactName 与 content 必填' });
      if (clientName.length > 200 || content.length > 20000) return sendJson(res, 413, { error: '消息内容超出限制' });
      const list = await readJson(COMM_FILE);
      const now = Date.now();
      const item = {
        id: 'wh_' + genId(),
        createdAt: now,
        updatedAt: now,
        clientName,
        channel,
        content,
        summary: String(body.summary || '').slice(0, 300),
        date: String(body.date || new Date().toISOString().slice(0, 10)),
        source: 'webhook', // 标记来源，便于后续区分手动记录与接入端推送
      };
      list.push(item);
      await writeJson(COMM_FILE, list);
      return sendJson(res, 201, { received: true, id: item.id });
    }

    // ---------- 鉴权：其余 API 必须登录 ----------
    const user = getCurrentUser(req);
    if (p.startsWith('/api/') && !user) return sendJson(res, 401, { error: '未登录' });
    req.user = user;

    // ---------- 文件上传（base64 编码，前端用 FileReader 读取后提交） ----------
    // 仅接受 JSON body { filename, data: "base64..." }，存入 data/uploads/，返回访问路径
    if (p === '/api/upload' && method === 'POST') {
      const body = await readBody(req);
      const name = (String(body.filename || body.name || '')).replace(/[/\\:*?"<>|#]/g, '_').slice(0, 200) || 'file';
      const ext = path.extname(name).toLowerCase();
      // 只允许常见文件类型
      const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv', '.mp4', '.webm', '.zip']);
      if (!ext || !ALLOWED.has(ext)) return sendJson(res, 400, { error: '不支持的文件类型' });
      const raw = String(body.data || '').trim();
      if (!raw) return sendJson(res, 400, { error: '缺少文件数据' });
      // 去掉 data:...base64, 前缀
      const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
      let buf;
      try { buf = Buffer.from(b64, 'base64'); } catch { return sendJson(res, 400, { error: '文件数据编码无效' }); }
      if (buf.length > 20 * 1024 * 1024) return sendJson(res, 413, { error: '单个文件不超过 20 MB' });
      const id = randomUUID().slice(0, 8);
      const fname = id + '-' + name;
      await fsp.writeFile(path.join(UPLOAD_DIR, fname), buf);
      const ownerFile = path.join(DATA_DIR, 'upload-owners.json');
      const uploadOwners = await jsonRead(ownerFile, {});
      uploadOwners['/uploads/' + fname] = user.id;
      await jsonWrite(ownerFile, uploadOwners);
      return sendJson(res, 201, { url: '/uploads/' + fname, name, size: buf.length });
    }

    // ---------- 文件内容解析（AI 录入订单用）：上传文档 → 提取纯文本 ----------
    if (p === '/api/parse-doc' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.filename || body.name || 'file');
      const ext = path.extname(name).toLowerCase();
      const raw = String(body.data || '').trim();
      if (!raw) return sendJson(res, 400, { error: '缺少文件数据' });
      const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
      let buf;
      try { buf = Buffer.from(b64, 'base64'); } catch { return sendJson(res, 400, { error: '文件数据编码无效' }); }
      if (buf.length > 20 * 1024 * 1024) return sendJson(res, 413, { error: '单个文件不超过 20 MB' });
      let text = '';
      try {
        if (ext === '.txt' || ext === '.csv') text = buf.toString('utf8');
        else if (['.docx', '.xlsx', '.xls', '.pdf'].includes(ext)) text = await parseDocument(ext, buf);
        else return sendJson(res, 400, { error: '仅支持 PDF / Word / Excel / TXT / CSV' });
      } catch (e) { return sendJson(res, 500, { error: '解析失败：' + e.message }); }
      if (!text || !text.trim()) return sendJson(res, 422, { error: '未能从文件中提取到文本（可能是扫描件或加密文档）' });
      return sendJson(res, 200, { text: text.slice(0, 60000), size: buf.length, ext });
    }

    if (p === '/api/announcement' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const announcement = releaseNotice.announcement;
      const notis = announcement ? await readJson(NOTIFICATIONS_FILE) : {};
      return sendJson(res, 200, { userId: user.id, announcement,
        read: announcementWasRead(notis, user.id, announcement) });
    }
    if (p === '/api/announcement/read' && method === 'POST') {
      res.setHeader('Cache-Control', 'no-store');
      const body = await readBody(req);
      if (body.userId !== user.id) return sendJson(res, 409, { error: '登录账号已变化，请重新检查公告' });
      const announcement = releaseNotice.announcement;
      if (!announcement || ![announcement.id, ...(announcement.legacyIds || [])].includes(body.id)) return sendJson(res, 409, { error: '公告已更新' });
      const notis = await readJson(NOTIFICATIONS_FILE);
      if (!notis[user.id]) notis[user.id] = {};
      notis[user.id]['announce:' + announcement.id] = { read: true, at: Date.now() };
      await writeJson(NOTIFICATIONS_FILE, notis);
      return sendJson(res, 200, { ok: true });
    }

    // 系统提醒：历史更新按日汇总，人工通知仅管理员发布，已读按登录账号保存。
    if (p === '/api/system-notices' || p === '/api/system-notices/read') {
      res.setHeader('Cache-Control', 'no-store');
      const notices = await readJson(SYSTEM_NOTICES_FILE, []);
      const updates = releaseNotice.announcements.map(a => ({ ...a, kind: 'update', createdAt: a.date ? Date.parse(a.date + 'T00:00:00+08:00') : 0 }));
      const items = [...updates, ...notices].sort((a, b) => b.createdAt - a.createdAt);
      if (p === '/api/system-notices' && method === 'GET') {
        const notis = await readJson(NOTIFICATIONS_FILE);
        const rows = items.map(item => ({ ...item, read: item.kind === 'update' ? announcementWasRead(notis, user.id, item) : !!notis?.[user.id]?.['system:' + item.id]?.read }));
        return sendJson(res, 200, { userId: user.id, items: rows, unread: rows.filter(x => !x.read).length });
      }
      if (p === '/api/system-notices' && method === 'POST') {
        if (user.role !== 'admin') return sendJson(res, 403, { error: '仅管理员可发布系统通知' });
        const body = await readBody(req);
        const title = String(body.title || '').trim(), content = String(body.content || '').trim();
        if (!title || !content || title.length > 120 || content.length > 8000) return sendJson(res, 400, { error: '请填写标题（最多120字）和正文（最多8000字）' });
        const item = { id: 'sys_' + genId(), kind: 'system', title, items: content.split(/\r?\n/).filter(x => x.trim()), createdAt: Date.now(), authorName: user.name };
        notices.push(item); await writeJson(SYSTEM_NOTICES_FILE, notices);
        logAudit(user, 'create', 'system-notices', item.id, title);
        return sendJson(res, 201, item);
      }
      if (p === '/api/system-notices/read' && method === 'POST') {
        const body = await readBody(req);
        if (body.userId !== user.id) return sendJson(res, 409, { error: '登录账号已变化，请重新打开提醒中心' });
        const item = items.find(x => x.id === body.id);
        if (!item) return sendJson(res, 404, { error: '通知不存在' });
        const notis = await readJson(NOTIFICATIONS_FILE);
        if (!notis[user.id]) notis[user.id] = {};
        notis[user.id][(item.kind === 'update' ? 'announce:' : 'system:') + item.id] = { read: true, at: Date.now() };
        await writeJson(NOTIFICATIONS_FILE, notis);
        return sendJson(res, 200, { ok: true });
      }
    }

    if(p==='/api/clients/merge'&&method==='POST'){
      if(user.role!=='admin')return sendJson(res,403,{error:'合并客户需要管理员权限'});
      const body=await readBody(req),keepId=String(body.keepId||''),ids=[...new Set((Array.isArray(body.removeIds)?body.removeIds:[]).map(String))];
      if(!ids.length||ids.length>100||ids.includes(keepId))return sendJson(res,400,{error:'请选择保留客户及需要合并的记录'});
      const all=await readJson(CLIENTS_FILE),keep=all.find(c=>c.id===keepId),sources=all.filter(c=>ids.includes(c.id));
      if(!keep||sources.length!==ids.length)return sendJson(res,409,{error:'客户记录已变化，请重新检查'});
      const merged={...keep,updatedAt:Date.now()},conflicts=[];
      for(const c of sources){
        for(const [k,v] of Object.entries(c)){
          if(['id','createdAt','updatedAt','owner','ownerName'].includes(k)||v==null||v==='')continue;
          if(k==='notes'){if(v!==merged.notes)merged.notes=[merged.notes,'【合并自 '+c.company+'】'+v].filter(Boolean).join('\n');continue;}
          if(Array.isArray(v)){merged[k]=[...new Map([...(Array.isArray(merged[k])?merged[k]:[]),...v].map(x=>[JSON.stringify(x),x])).values()];continue;}
          if(merged[k]==null||merged[k]==='')merged[k]=v;
          else if(JSON.stringify(v)!==JSON.stringify(merged[k]))conflicts.push(k+'：'+(typeof v==='object'?JSON.stringify(v):v));
        }
      }
      if(conflicts.length)merged.notes=[merged.notes,'【合并时保留的其他资料】',...conflicts].filter(Boolean).join('\n');
      const names=new Set([keep,...sources].map(c=>c.company).filter(Boolean));
      const ambiguous=new Set(all.filter(c=>c.id!==keepId&&!ids.includes(c.id)&&names.has(c.company)).map(c=>c.company));
      const changes={clients:[merged]},originals={},nexts={};
      for(const base of Object.keys(dal.ARRAYS)){
        if(base==='clients')continue;
        const file=path.join(DATA_DIR,base+'.json'),rows=await readJson(file,[]);if(!Array.isArray(rows))continue;
        const updated=rows.map(row=>{
          const matchId=ids.includes(String(row.clientId||'')),matchName=!row.clientId&&names.has(row.clientName);
          const matchRef=['client','clients'].includes(row.refType)&&ids.includes(String(row.refId||''));
          if(matchName&&ambiguous.has(row.clientName))throw Object.assign(new Error('同名客户存在歧义，请先为关联记录指定客户后再合并'),{status:409});
          const matchRelated=['client','clients'].includes(row.relatedKind)&&ids.includes(String(row.relatedId||''));
          if(!matchId&&!matchName&&!matchRef&&!matchRelated)return row;
          const n={...row};if(matchId||matchName){n.clientId=keepId;if('clientName' in n)n.clientName=merged.company;}
          if(matchRef)n.refId=keepId;
          if(matchRelated){n.relatedId=keepId;n.relatedName=merged.company;}
          if('updatedAt' in n)n.updatedAt=Date.now();return n;
        });
        const changed=updated.filter((x,i)=>x!==rows[i]);if(changed.length){changes[base]=changed;originals[base]=rows;nexts[base]=updated;}
      }
      originals.clients=all;nexts.clients=all.filter(c=>!ids.includes(c.id)).map(c=>c.id===keepId?merged:c);
      const backup=path.join(BACKUP_DIR,'client-merges',Date.now()+'-'+randomUUID()+'.json');await fsp.mkdir(path.dirname(backup),{recursive:true});await fsp.writeFile(backup,JSON.stringify({keepId,removeIds:ids,originals}),{mode:0o600});
      if(STORAGE_MODE==='mysql')await dal.applyClientMerge(changes,ids);
      else {const written=[];try{for(const [base,rows] of Object.entries(nexts)){written.push(base);await writeJson(path.join(DATA_DIR,base+'.json'),rows);}}catch(e){for(const base of written)await writeJson(path.join(DATA_DIR,base+'.json'),originals[base]);throw e;}}
      logAudit(user,'merge','clients',keepId,'合并客户 '+ids.join(',')+' 至 '+keepId);
      return sendJson(res,200,{ok:true,client:merged,linked:Object.fromEntries(Object.entries(changes).filter(([k])=>k!=='clients').map(([k,v])=>[k,v.length]))});
    }

    if (p === '/api/order-capabilities' && method === 'GET') return sendJson(res, 200, { items: true });

    // ---------- 操作审计：对所有业务数据表的增删改（含登录）记录轨迹 ----------
    if (method !== 'GET' && user) {
      const am = p.match(/^\/api\/([a-z-]+)(?:\/([\w-]+))?$/);
      if (am) {
        const at = am[1];
        const AUDIT_SET = new Set(['clients', 'orders', 'inquiries', 'shipments', 'products', 'emails', 'comms', 'comm-templates', 'suppliers', 'finance', 'exceptions', 'users']);
        if (AUDIT_SET.has(at)) {
          const act = method === 'POST' ? 'create' : method === 'PUT' ? 'update' : method === 'DELETE' ? 'delete' : null;
          // 延迟到响应真正结束再落审计：只有 2xx 才算操作成功；403 单独记为「越权拦截」
          // （这是审计最该抓的事件）；其余失败(400/404/500)不入库，避免噪音淹没真实轨迹。
          if (act) {
            res.once('finish', () => {
              const sc = res.statusCode;
              // AI 管家来源标记：前端执行 ActionCard 时带 X-AI-Action 头，审计里可区分人工/AI 发起
              const aiMark = (req.headers && req.headers['x-ai-action']) ? `AI管家·${String(req.headers['x-ai-action']).slice(0, 40)}` : '';
              if (sc >= 200 && sc < 300) logAudit(user, act, at, am[2] || res._auditId || null, aiMark);
              else if (sc === 403) logAudit(user, 'denied', at, am[2] || null, `越权尝试：${act}（已拒绝）${aiMark ? ' · ' + aiMark : ''}`);
            });
          }
        }
      }
    }

    // ---------- 用户管理（仅管理员可管理团队成员） ----------
    if (p === '/api/users' && method === 'GET') {
      return sendJson(res, 200, readUsers().users.map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role || 'sales', managerId: u.managerId || null })));
    }
    if (p === '/api/users' && method === 'POST') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: '仅管理员可新增用户' });
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const name = String(body.name || username).trim();
      const pw = String(body.password || '');
      if (!username || !pw) return sendJson(res, 400, { error: '用户名和密码必填' });
      const all = readUsers();
      if (all.users.some((x) => x.username === username)) return sendJson(res, 400, { error: '用户名已存在' });
      const role = ['admin', 'manager', 'sales'].includes(body.role) ? body.role : 'sales';
      // 管理员不挂上级；其余角色若指定上级需校验合法性
      let managerId = role === 'admin' ? null : (body.managerId || null);
      if (managerId) {
        const m = all.users.find((x) => x.id === managerId);
        if (!m) return sendJson(res, 400, { error: '指定的上级不存在' });
        if (!['admin', 'manager'].includes(m.role || 'sales')) return sendJson(res, 400, { error: '上级必须是经理或管理员' });
      }
      const u = { id: 'u_' + genId().slice(0, 8), username, name, password: hashPw(pw), role, managerId };
      all.users.push(u);
      await writeUsers(all);
      return sendJson(res, 201, { id: u.id, username: u.username, name: u.name, role, managerId });
    }
    const um = p.match(/^\/api\/users\/([\w-]+)$/);
    if (um) {
      const all = readUsers();
      const idx = all.users.findIndex((x) => x.id === um[1]);
      if (idx === -1) return sendJson(res, 404, { error: '用户不存在' });
      if (method === 'PUT') {
        const body = await readBody(req);
        const isSelf = um[1] === user.id;
        if (!isSelf && user.role !== 'admin') return sendJson(res, 403, { error: '仅管理员可修改其他用户' });
        const target = all.users[idx];
        const pw = String(body.password || '');
        if (pw) target.password = hashPw(pw);
        if (body.name != null) {
          const nm = String(body.name).trim();
          if (!nm) return sendJson(res, 400, { error: '姓名不能为空' });
          target.name = nm;
        }
        // 角色 / 直属上级：仅管理员可设置
        if (user.role === 'admin') {
          if (body.role && ['admin', 'manager', 'sales'].includes(body.role) && body.role !== (target.role || 'sales')) {
            // 防自锁：不允许管理员改自己的角色
            if (isSelf) return sendJson(res, 400, { error: '不能修改自己的角色，请由其他管理员操作' });
            // 防失守：系统必须至少保留一名管理员
            if ((target.role || 'sales') === 'admin' && body.role !== 'admin') {
              const admins = all.users.filter((x) => (x.role || 'sales') === 'admin');
              if (admins.length <= 1) return sendJson(res, 400, { error: '系统至少需保留一名管理员' });
            }
            target.role = body.role;
            if (body.role === 'admin') target.managerId = null; // 管理员不挂上级
          }
          if ('managerId' in body && (target.role || 'sales') !== 'admin') {
            const mid = body.managerId || null;
            if (mid) {
              if (mid === target.id) return sendJson(res, 400, { error: '上级不能是本人' });
              const m = all.users.find((x) => x.id === mid);
              if (!m) return sendJson(res, 400, { error: '指定的上级不存在' });
              if (!['admin', 'manager'].includes(m.role || 'sales')) return sendJson(res, 400, { error: '上级必须是经理或管理员' });
              const seen = new Set([target.id]);
              let ancestor = m;
              while (ancestor) {
                if (seen.has(ancestor.id)) return sendJson(res, 400, { error: '上下级关系不能形成循环' });
                seen.add(ancestor.id);
                ancestor = all.users.find(x => x.id === ancestor.managerId);
              }
            }
            target.managerId = mid;
          }
        }
        await writeUsers(all);
        const u = all.users[idx];
        return sendJson(res, 200, { id: u.id, username: u.username, name: u.name, role: u.role || 'sales', managerId: u.managerId || null });
      }
      if (method === 'DELETE') {
        if (user.role !== 'admin') return sendJson(res, 403, { error: '仅管理员可删除用户' });
        if (um[1] === user.id) return sendJson(res, 400, { error: '不能删除当前登录账号' });
        if ((all.users[idx].role || 'sales') === 'admin') {
          const admins = all.users.filter((x) => (x.role || 'sales') === 'admin');
          if (admins.length <= 1) return sendJson(res, 400, { error: '系统至少需保留一名管理员' });
        }
        const goneId = all.users[idx].id;
        all.users.splice(idx, 1);
        // 解除下属对已删除上级的引用，避免出现"孤儿上级"
        for (const x of all.users) if (x.managerId === goneId) x.managerId = null;
        await writeUsers(all);
        return sendJson(res, 200, { ok: true });
      }
    }

    // ---------- 操作日志（仅管理员可查看） ----------
    if (p === '/api/audit' && method === 'GET') {
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: '仅管理员可查看操作日志' });
      let list = [];
      try { list = await readAudit(); } catch { list = []; }
      const qUser = url.searchParams.get('user') || '';
      const qTable = url.searchParams.get('table') || '';
      const qAction = url.searchParams.get('action') || '';
      const qFrom = Number(url.searchParams.get('from') || 0);
      const qTo = Number(url.searchParams.get('to') || 0);
      if (qUser) list = list.filter((x) => x.userId === qUser || x.userName === qUser);
      if (qTable) list = list.filter((x) => x.table === qTable);
      if (qAction) list = list.filter((x) => x.action === qAction);
      if (qFrom) list = list.filter((x) => x.ts >= qFrom);
      if (qTo) list = list.filter((x) => x.ts <= qTo);
      list.sort((a, b) => b.ts - a.ts);
      const limit = Math.min(Number(url.searchParams.get('limit') || 500), 2000);
      return sendJson(res, 200, { items: list.slice(0, limit), total: list.length });
    }

    // 报价内一键建档：同权限范围内按公司名去重，写锁避免重复点击/并发创建重复客户。
    if (p === '/api/clients/from-quotation' && method === 'POST') {
      const body = await readBody(req);
      const company = String(body.company || '').trim();
      if (!company || company.length > 300) return sendJson(res, 400, { error: '请填写有效的客户公司名称（最多300字）' });
      const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      const list = await readJson(CLIENTS_FILE);
      const matches = visibleRecords(list, user).filter(c => normalize(c.company) === normalize(company));
      const existing = matches.find(c => c.owner === (body.owner || user.id)) || matches[0];
      if (existing) return sendJson(res, 200, { client: existing, created: false });
      const fields = { company, stage: '潜在', source: '报价建档' };
      for (const key of ['contactName', 'country', 'contactEmail', 'contactPhone', 'website']) fields[key] = String(body[key] || '').trim().slice(0, 500);
      const now = Date.now();
      const client = { ...withOwner({ ...fields, owner: body.owner || user.id }, user), id: genId(), createdAt: now, updatedAt: now };
      list.push(client); await writeJson(CLIENTS_FILE, list);
      logAudit(user, 'create', 'clients', client.id, '报价单一键建档');
      return sendJson(res, 201, { client, created: true });
    }

    // 客户 CRUD
    if (p === '/api/clients') {
      if (method === 'GET') {
        const all = await readJson(CLIENTS_FILE);
        const va = buildVisibleOwners(user);
        const visible = va ? all.filter((o) => va.has(o.owner)) : all;
        // 跟进健康度：合并该客户名下询盘的最后跟进/接收日期，得到「上次跟进」虚拟字段（不落盘）
        if (visible.length && Array.isArray((await readJson(INQ_FILE)))) {
          try {
            const inqs = visibleRecords(await readJson(INQ_FILE), user);
            const byCo = new Map();
            for (const iq of inqs) {
              const co = String(iq.clientName || '').trim();
              if (!co) continue;
              const ds = byCo.get(co) || new Set();
              ['lastFollowAt', 'receivedAt'].forEach((k) => { if (iq[k]) ds.add(String(iq[k]).slice(0, 10)); });
              byCo.set(co, ds);
            }
            visible.forEach((c) => {
              const ds = byCo.get(String(c.company || '').trim());
              if (ds && ds.size) c.lastFollowAt = [...ds].filter(Boolean).sort().pop();
            });
          } catch { /* 非关键增强，失败不影响列表 */ }
        }
        return sendJson(res, 200, visible);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(CLIENTS_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(CLIENTS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const cm = p.match(/^\/api\/clients\/([\w-]+)$/);
    if (cm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(CLIENTS_FILE);
      const idx = list.findIndex((c) => c.id === cm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') {
        list.splice(idx, 1);
        await writeJson(CLIENTS_FILE, list);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: cm[1], updatedAt: Date.now() };
      await writeJson(CLIENTS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // Bulk field update: one request and one SQL UPDATE for all authorized rows.
    if (p === '/api/orders/batch' && method === 'PATCH') {
      const body = await readBody(req);
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 5000 || body.ids.some(id => typeof id !== 'string' || !/^[\w-]+$/.test(id))) return sendJson(res, 400, {error:'请选择 1–5000 笔有效订单'});
      const ids = [...new Set(body.ids)], input = body.patch;
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['status','owner','ownerName'].includes(k))) return sendJson(res, 400, {error:'不支持的批量修改字段'});
      const patch = {updatedAt:Date.now()};
      if ('status' in input) {
        if (!['待确认','已确认','生产中','已发货','已收款','已完成','已取消'].includes(input.status)) return sendJson(res, 400, {error:'无效订单状态'});
        patch.status = input.status;
      }
      if ('owner' in input) {
        const target = readUsers().users.find(u => u.id === input.owner);
        if (!target) return sendJson(res, 400, {error:'业务员不存在'});
        patch.owner = target.id; patch.ownerName = target.name || '';
      }
      if (Object.keys(patch).length === 1) return sendJson(res, 400, {error:'请选择修改字段'});
      if (STORAGE_MODE === 'mysql') return sendJson(res, 200, await dal.patchOrders(ids, patch, owner => canAccessRecord(user, owner)));
      const list = await readJson(ORDERS_FILE), succeeded = [], failed = [];
      for (const id of ids) {
        const row = list.find(o => o.id === id);
        if (!row) failed.push({id,reason:'订单不存在'});
        else if (!canAccessRecord(user,row.owner)) failed.push({id,reason:'无修改权限'});
        else { Object.assign(row,patch); succeeded.push(id); }
      }
      if (succeeded.length) await writeJson(ORDERS_FILE,list);
      return sendJson(res,200,{succeeded,failed,patch});
    }

    // 订单 CRUD
    if (p === '/api/orders') {
      if (method === 'GET') {
        const all = await readJson(ORDERS_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((o) => va.has(o.owner)) : all);
      }
      if (method === 'POST') {
        let body = await readBody(req);
        try { body = normalizeSalesFields(body); } catch (error) { return sendJson(res,400,{error:error.message}); }
        const list = await readJson(ORDERS_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(ORDERS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const om = p.match(/^\/api\/orders\/([\w-]+)$/);
    if (om && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(ORDERS_FILE);
      const idx = list.findIndex((o) => o.id === om[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') {
        list.splice(idx, 1);
        await writeJson(ORDERS_FILE, list);
        return sendJson(res, 200, { ok: true });
      }
      let body = await readBody(req);
        try { body = normalizeSalesFields(body); } catch (error) { return sendJson(res,400,{error:error.message}); }
      list[idx] = { ...list[idx], ...body, id: om[1], updatedAt: Date.now() };
      await writeJson(ORDERS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // 报价单 CRUD（项目型报价：支持分项、版本、状态、关联询盘/订单）
    if (p === '/api/quotations') {
      if (method === 'GET') {
        const all = await readJson(QUOTATIONS_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((q) => va.has(q.owner)) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(QUOTATIONS_FILE);
        const now = Date.now();
        let item;
        try { item = createQuote(withOwner(body,user),user,now,genId()); } catch(error) { return sendJson(res,400,{error:error.message}); }
        list.push(item);
        await writeJson(QUOTATIONS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const qm = p.match(/^\/api\/quotations\/([\w-]+)$/);
    if (qm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(QUOTATIONS_FILE);
      const idx = list.findIndex((q) => q.id === qm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') {
        list.splice(idx, 1);
        await writeJson(QUOTATIONS_FILE, list);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      try { list[idx] = reviseQuote(list[idx],body,user,Date.now()); }
      catch(error) { return sendJson(res,error.status||400,{error:error.message}); }
      await writeJson(QUOTATIONS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 批量导入（客户 / 沟通记录，文本粘贴或 Excel 解析后提交） ----------
    // 每条记录做最小校验：客户需 company，沟通需 content；单批上限 500 条。
    if ((p === '/api/clients/import' || p === '/api/comms/import') && method === 'POST') {
      const body = await readBody(req);
      const records = Array.isArray(body.records) ? body.records.slice(0, 500) : [];
      if (!records.length) return sendJson(res, 400, { error: '没有可导入的记录' });
      const file = p === '/api/clients/import' ? CLIENTS_FILE : COMM_FILE;
      const list = await readJson(file);
      const now = Date.now();
      let added = 0, skipped = 0;
      for (const raw of records) {
        if (!raw || typeof raw !== 'object') { skipped++; continue; }
        if (file === CLIENTS_FILE && !String(raw.company || '').trim()) { skipped++; continue; }
        if (file === COMM_FILE && !String(raw.content || '').trim()) { skipped++; continue; }
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(raw, user) };
        // 导入记录默认归属当前操作人，前端显式指定跟进人时保留
        if (!item.owner && user) { item.owner = user.id; item.ownerName = user.name; }
        list.push(item);
        added++;
      }
      if (added > 0) await writeJson(file, list);
      return sendJson(res, 201, { added, skipped });
    }

    // 询盘 CRUD（统一业务归属权限）
    if (p === '/api/inquiries') {
      if (method === 'GET') {
        return sendJson(res, 200, visibleRecords(await readJson(INQ_FILE), user));
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(INQ_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        // 跟进人默认=登录用户；表单显式指定（责任人下拉）则采用所选项
        if (user) {
          if (!item.owner) item.owner = user.id;
          if (!item.ownerName) item.ownerName = user.name;
        }
        list.push(item);
        await writeJson(INQ_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const im = p.match(/^\/api\/inquiries\/([\w-]+)$/);
    if (im && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(INQ_FILE);
      const idx = list.findIndex((o) => o.id === im[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该询盘' });
      if (method === 'DELETE') {
        list.splice(idx, 1);
        await writeJson(INQ_FILE, list);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: im[1], updatedAt: Date.now() };
      await writeJson(INQ_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // 询盘异常登记 CRUD
    if (p === '/api/exceptions') {
      if (method === 'GET') {
        const all = await readJson(EXC_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((o) => va.has(o.owner)) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(EXC_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(EXC_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const em = p.match(/^\/api\/exceptions\/([\w-]+)$/);
    if (em && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(EXC_FILE);
      const idx = list.findIndex((o) => o.id === em[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') {
        list.splice(idx, 1);
        await writeJson(EXC_FILE, list);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: em[1], updatedAt: Date.now() };
      await writeJson(EXC_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // 开发信草稿 CRUD（按 RBAC 可见范围过滤；历史无 owner 视为共享）
    if (p === '/api/emails') {
      if (method === 'GET') {
        const all = await readJson(EMAILS_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((o) => va.has(o.owner)) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(EMAILS_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(EMAILS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const emm = p.match(/^\/api\/emails\/([\w-]+)$/);
    if (emm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(EMAILS_FILE);
      const idx = list.findIndex((o) => o.id === emm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') {
        list.splice(idx, 1);
        await writeJson(EMAILS_FILE, list);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: emm[1], updatedAt: Date.now() };
      await writeJson(EMAILS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // 产品内容库 CRUD（公司主数据，与供应商同级：全员共享，不做 owner 隔离）
    if (p === '/api/products') {
      if (method === 'GET') {
        return sendJson(res, 200, await readJson(PRODUCTS_FILE));
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(PRODUCTS_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(PRODUCTS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const pm = p.match(/^\/api\/products\/([\w-]+)$/);
    if (pm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(PRODUCTS_FILE);
      const idx = list.findIndex((o) => o.id === pm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (method === 'DELETE') {
        list.splice(idx, 1);
        await writeJson(PRODUCTS_FILE, list);
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: pm[1], updatedAt: Date.now() };
      await writeJson(PRODUCTS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 出货 / 物流（按 RBAC 可见范围过滤；历史无 owner 视为共享） ----------
    if (p === '/api/shipments') {
      if (method === 'GET') {
        const all = await readJson(SHIP_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((o) => va.has(o.owner)) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(SHIP_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(SHIP_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const shm = p.match(/^\/api\/shipments\/([\w-]+)$/);
    if (shm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(SHIP_FILE);
      const idx = list.findIndex((o) => o.id === shm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(SHIP_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: shm[1], updatedAt: Date.now() };
      await writeJson(SHIP_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 供应商（公司主数据，所有人共享，不做 owner 隔离） ----------
    if (p === '/api/suppliers') {
      if (method === 'GET') return sendJson(res, 200, await readJson(SUPP_FILE));
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(SUPP_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...body };
        list.push(item);
        await writeJson(SUPP_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const supm = p.match(/^\/api\/suppliers\/([\w-]+)$/);
    if (supm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(SUPP_FILE);
      const idx = list.findIndex((o) => o.id === supm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (method === 'DELETE') {
        const old = list[idx];
        list.splice(idx, 1); await writeJson(SUPP_FILE, list);
        // 级联清理该供应商的资料附件夹（整目录删除，避免留下孤儿文件）
        try { await fsp.rm(suppFileDir(old), { recursive: true, force: true }); } catch { /* 目录不存在时忽略 */ }
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      // 编辑后产品分类 / 公司名称可能变化 → 附件目录跟着变，把旧目录整体搬过去，避免资料"丢失"
      const old = list[idx];
      const oldDir = suppFileDir(old);
      list[idx] = { ...old, ...body, id: supm[1], updatedAt: Date.now() };
      await writeJson(SUPP_FILE, list);
      const newDir = suppFileDir(list[idx]);
      if (oldDir !== newDir) {
        try {
          await fsp.access(oldDir); // 旧目录存在才迁移
          await fsp.mkdir(path.dirname(newDir), { recursive: true });
          try {
            await fsp.access(newDir); // 目标已被其他供应商占用 → 逐文件搬移并避免覆盖
            const olds = await fsp.readdir(oldDir).catch(() => []);
            for (const n of olds) {
              let dest = path.join(newDir, n);
              try { await fsp.rename(path.join(oldDir, n), dest); }
              catch { dest = path.join(newDir, Math.random().toString(36).slice(2, 6) + '-' + n); await fsp.rename(path.join(oldDir, n), dest); }
            }
            await fsp.rm(oldDir, { recursive: true, force: true });
          } catch { await fsp.rename(oldDir, newDir); }
        } catch { /* 旧目录不存在则跳过迁移 */ }
      }
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 供应商资料附件夹（目录 = <产品分类>/<公司名称>，两级结构方便按产品查找） ----------
    // GET    /api/suppliers/:id/files                → 列出该供应商全部附件
    // POST   /api/suppliers/:id/files                → 上传（base64，与 /api/upload 同约定），body: { filename, data }
    // DELETE /api/suppliers/:id/files?f=<存储名>      → 删除指定附件
    // 文件实际落在 data/uploads/suppliers/<产品分类>/<公司名称>/，经 /uploads/ 静态路由可直接下载
    const supfm = p.match(/^\/api\/suppliers\/([\w-]+)\/files$/);
    if (supfm && (method === 'GET' || method === 'POST' || method === 'DELETE')) {
      const sid = supfm[1];
      const list = await readJson(SUPP_FILE);
      const sup = list.find((s) => s.id === sid);
      if (!sup) return sendJson(res, 404, { error: '供应商不存在' });
      const base = suppFileDir(sup);

      if (method === 'GET') {
        return sendJson(res, 200, { path: suppRelDir(sup), files: await listSuppFiles(sup) });
      }

      if (method === 'POST') {
        const body = await readBody(req);
        const rawName = safeSuppFileName(body.filename || body.name);
        const ext = path.extname(rawName).toLowerCase();
        if (!ext || !SUPP_FILE_ALLOWED.has(ext)) return sendJson(res, 400, { error: '不支持的文件类型：' + (ext || '无扩展名') });
        const raw = String(body.data || '').trim();
        if (!raw) return sendJson(res, 400, { error: '缺少文件数据' });
        const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
        let buf;
        try { buf = Buffer.from(b64, 'base64'); } catch { return sendJson(res, 400, { error: '文件数据编码无效' }); }
        if (!buf.length) return sendJson(res, 400, { error: '文件内容为空' });
        if (buf.length > 20 * 1024 * 1024) return sendJson(res, 413, { error: '单个文件不超过 20 MB' });
        await fsp.mkdir(base, { recursive: true });
        // 存储名 = 8 位随机前缀 + 原文件名：既避免同名覆盖，也能还原展示名
        const stored = randomUUID().slice(0, 8) + '-' + rawName;
        await fsp.writeFile(path.join(base, stored), buf);
        logAudit(user, 'create', 'supplier-file', sid, `上传 ${suppRelDir(sup)}/${rawName}`);
        return sendJson(res, 201, { ok: true, name: rawName, size: buf.length, path: suppRelDir(sup) });
      }

      // DELETE：?f=<存储名>，单段 basename 校验，杜绝路径穿越
      const rel = String(url.searchParams.get('f') || '');
      if (!rel || rel.includes('/') || rel.includes('\\') || rel !== path.basename(rel)) return sendJson(res, 400, { error: '参数错误' });
      const target = path.join(base, rel);
      if (!target.startsWith(base + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
      try {
        await fsp.unlink(target);
      } catch {
        return sendJson(res, 404, { error: '文件不存在' });
      }
      logAudit(user, 'delete', 'supplier-file', sid, `删除 ${suppRelDir(sup)}/${rel}`);
      return sendJson(res, 200, { ok: true });
    }

    // 供应商附件数量汇总（列表页显示 📎 数量用，避免逐供应商发请求）
    if (p === '/api/supplier-file-counts' && method === 'GET') {
      const list = await readJson(SUPP_FILE);
      const counts = {};
      for (const s of list) {
        try { counts[s.id] = (await listSuppFiles(s)).length; } catch { counts[s.id] = 0; }
      }
      return sendJson(res, 200, counts);
    }

    // ---------- 财务（收款/付款记录，按 RBAC 可见范围过滤） ----------
    if (p === '/api/finance') {
      if (method === 'GET') {
        const all = await readJson(FIN_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((o) => va.has(o.owner)) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(FIN_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(FIN_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const finm = p.match(/^\/api\/finance\/([\w-]+)$/);
    if (finm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(FIN_FILE);
      const idx = list.findIndex((o) => o.id === finm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(FIN_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: finm[1], updatedAt: Date.now() };
      await writeJson(FIN_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 多通道沟通记录（微信/WhatsApp/电话/邮件/其他，按 RBAC 可见范围过滤） ----------
    if (p === '/api/comms') {
      if (method === 'GET') {
        const all = await readJson(COMM_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((o) => va.has(o.owner)) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(COMM_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(COMM_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const comm = p.match(/^\/api\/comms\/([\w-]+)$/);
    if (comm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(COMM_FILE);
      const idx = list.findIndex((o) => o.id === comm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该记录' });
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(COMM_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: comm[1], updatedAt: Date.now() };
      await writeJson(COMM_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 快捷话术模板（团队共享资产：全员可见，仅创建者/管理员可改删） ----------
    if (p === '/api/comm-templates') {
      if (method === 'GET') {
        return sendJson(res, 200, await readJson(CTMPL_FILE));
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(CTMPL_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(CTMPL_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const ctm = p.match(/^\/api\/comm-templates\/([\w-]+)$/);
    if (ctm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(CTMPL_FILE);
      const idx = list.findIndex((o) => o.id === ctm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      // 话术全员可见，但别人写的话术不能被随手改掉/删掉（管理员除外；历史无归属的视为公共）
      const owner = list[idx].owner;
      if (!canAccessRecord(user, owner)) {
        return sendJson(res, 403, { error: '只能修改自己创建的话术' });
      }
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(CTMPL_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: ctm[1], updatedAt: Date.now() };
      await writeJson(CTMPL_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 邮件账号配置（按用户存储 SMTP 配置） ----------
    if (p === '/api/mail/accounts') {
      if (method === 'GET') {
        let data = {};
        try { data = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8')); } catch { /* 忽略 */ }
        const acc = data[user.id] || {};
        return sendJson(res, 200, { ...acc, pass: acc.pass ? '********' : '', hasPass: !!acc.pass });
      }
      if (method === 'PUT') return sendJson(res,410,{error:'邮箱配置功能已移除'});
    }
    // 发信：使用当前登录用户的 SMTP 配置
    if (p === '/api/mail/send' && method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8')); } catch { /* 忽略 */ }
      const acc = data[user.id];
      if (!acc || !acc.host || !acc.user || !acc.pass) {
        return sendJson(res, 400, { error: '请先在「邮件」页配置 SMTP 发信账号' });
      }
      const to = String(body.to || '').trim();
      if (!to) return sendJson(res, 400, { error: '收件人不能为空' });
      try {
        await sendSmtpMail({
          host: acc.host, port: acc.port, secure: !!acc.secure,
          starttls: acc.starttls !== false,
          user: acc.user, pass: acc.pass, from: acc.from || acc.user,
          to, cc: body.cc, bcc: body.bcc,
          subject: body.subject || '(无主题)',
          text: body.text || '', html: body.html || '',
        });
        return sendJson(res, 200, { ok: true, message: '邮件已发送' });
      } catch (e) {
        return sendJson(res, 502, { error: '发送失败: ' + (e && e.message ? e.message : e) });
      }
    }
    // 发信历史（每个用户独立）
    if (p === '/api/mail/sent') {
      if (method === 'GET') {
        const data = await readJson(MAIL_SENT_FILE);
        const rows = isBusinessManager(user) ? Object.entries(data || {}).flatMap(([owner, items]) => Array.isArray(items) ? items.map(item => ({ ...item, owner, ownerName: readUsers().users.find(u => u.id === owner)?.name || '' })) : []) : ((data && data[user.id]) || []);
        return sendJson(res, 200, rows.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)));
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const data = await readJson(MAIL_SENT_FILE) || {};
        if (!data[user.id]) data[user.id] = [];
        const entry = { id: 'ms_' + genId().slice(0, 8), to: body.to || '', cc: body.cc || '', subject: body.subject || '', body: (body.body || '').slice(0, 2000), sentAt: Date.now(), replyTo: body.replyTo || '' };
        data[user.id].push(entry);
        // 只保留最近 50 条
        if (data[user.id].length > 50) data[user.id] = data[user.id].slice(-50);
        await writeJson(MAIL_SENT_FILE, data);
        return sendJson(res, 201, entry);
      }
    }
    // IMAP 收信配置（存储到 mail.json，连接器共享读取）
    if (p === '/api/mail/imap') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: '仅管理员可管理公司收信配置' });
      let data = {};
      try { data = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8')); } catch {}
      if (!data.imap) data.imap = { host: '', port: '993', secure: true, user: '', pass: '', pollIntervalMs: 60000 };
      if (method === 'GET') {
        const cfg = { ...data.imap, pass: data.imap.pass ? '********' : '', hasPass: !!data.imap.pass };
        return sendJson(res, 200, cfg);
      }
      if (method === 'PUT') return sendJson(res,410,{error:'邮箱配置功能已移除'});
    }

    // Company and personal targets share one serialized read/validate/write.
    // __company__ is a dedicated bucket; administrator IDs never count as personal.
    if (p === '/api/sales') {
      const users = readUsers().users;
      const requested = url.searchParams.get('userId');
      const company = url.searchParams.get('scope') === 'company' || (!requested && user.role === 'admin');
      const targetUser = requested || user.id;
      const target = users.find(u => u.id === targetUser);
      if (!company && (!target || target.role === 'admin')) return sendJson(res,400,{error:'管理员没有个人目标'});
      if (!company && user.role !== 'admin' && targetUser !== user.id) return sendJson(res,403,{error:'只能查看和设置自己的个人目标'});
      if (method === 'PUT' && (company ? user.role !== 'admin' : user.role === 'admin' || targetUser !== user.id)) return sendJson(res,403,{error:company?'仅管理员可设置公司目标':'个人目标只能由本人设置'});
      const raw = await readJson(SALES_FILE);
      const data = !raw || Array.isArray(raw) ? {} : raw;
      // Preserve an unambiguous legacy administrator goal as the company goal.
      // No writes on GET, and no multiplication/division of historical values.
      const legacy = users.filter(u => u.role === 'admin' && Object.keys(data[u.id]?.yearMonthly || {}).length);
      const companyConfig = data.__company__ || (legacy.length === 1 ? data[legacy[0].id] : data.yearMonthly ? {yearMonthly:data.yearMonthly} : {yearMonthly:{}});
      const cents = v => Math.round((Number(v)||0)*100);
      const totals = config => {
        const result={};for(const [m,v] of Object.entries(config?.yearMonthly || {}))if(/^\d{4}-(0[1-9]|1[0-2])$/.test(m))result[m.slice(0,4)]=(result[m.slice(0,4)]||0)+cents(v);return result;
      };
      const allocated = () => {
        const result={};for(const u of users.filter(u=>u.role!=='admin'))for(const [y,v] of Object.entries(totals(data[u.id])))result[y]=(result[y]||0)+v;return result;
      };
      let config = company ? companyConfig : data[targetUser] || {yearMonthly:{}};
      if (method === 'PUT') {
        const body=await readBody(req);
        const next={...config,yearMonthly:{...config.yearMonthly}};
        let years;
        if(company){
          const y=String(body.year||''),total=Number(body.total);
          if(!/^\d{4}$/.test(y)||body.total==null||body.total===''||!Number.isFinite(total)||total<0||total>1e12)return sendJson(res,400,{error:'请填写年份及有效公司全年总目标'});
          const amount=cents(total),base=Math.floor(amount/12),extra=amount%12;
          for(let i=0;i<12;i++)next.yearMonthly[y+'-'+String(i+1).padStart(2,'0')]=(base+(i<extra?1:0))/100;
          years=[y];
        }else{
          const monthly=body.yearMonthly;
          if(!monthly||typeof monthly!=='object'||Array.isArray(monthly)||Object.keys(monthly).length>1200)return sendJson(res,400,{error:'月度目标格式错误'});
          for(const [m,v] of Object.entries(monthly)){
            if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)||typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e12)return sendJson(res,400,{error:'目标月份或金额无效'});
            next.yearMonthly[m]=cents(v)/100;
          }
          years=[...new Set(Object.keys(monthly).map(m=>m.slice(0,4)))];
        }
        const limit=totals(company?next:companyConfig),assigned=allocated(),previous=totals(config),updated=totals(next);
        for(const y of years){
          const sum=company?(assigned[y]||0):(assigned[y]||0)-(previous[y]||0)+(updated[y]||0);
          if(sum>(limit[y]||0))return sendJson(res,409,{error:`${y} 年个人目标合计不能超过公司目标；公司目标 ¥${((limit[y]||0)/100).toLocaleString('zh-CN')}，本次合计 ¥${(sum/100).toLocaleString('zh-CN')}`});
        }
        data.__company__=company?next:companyConfig;
        if(!company)data[targetUser]=next;
        await writeJson(SALES_FILE,data);config=next;
      }
      if(method==='GET'||method==='PUT'){
        const companyTotals=totals(data.__company__||companyConfig),assigned=allocated();
        const years=[...new Set([...Object.keys(companyTotals),...Object.keys(assigned)])];
        const budget=Object.fromEntries(years.map(y=>[y,{company:(companyTotals[y]||0)/100,allocated:(assigned[y]||0)/100,remaining:((companyTotals[y]||0)-(assigned[y]||0))/100}]));
        const response={...config,scope:company?'company':'personal',userId:company?null:targetUser,canEdit:company?user.role==='admin':targetUser===user.id&&user.role!=='admin',budget};
        if(company){
          // Aggregate only: company totals do not reveal other people's customers or orders.
          const monthly={};let undatedCount=0;
          for(const o of await readJson(ORDERS_FILE)){
            if(['已取消','Cancelled'].includes(o.status))continue;
            let date=String(o.orderDate||'').trim();if(!date&&o.createdAt){const d=new Date(o.createdAt);if(!isNaN(d))date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
            const d=new Date(date+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||isNaN(d)||d.toISOString().slice(0,10)!==date){undatedCount++;continue;}
            const row=monthly[date.slice(0,7)] ||= {count:0,invalidCount:0,amounts:{}};row.count++;
            const n=Number(o.amount),currency=String(o.currency||'').toUpperCase();
            if(!Number.isFinite(n)||n<=0||!currency){row.invalidCount++;continue;}
            row.amounts[currency]=(row.amounts[currency]||0)+n;
          }
          response.actual={monthly,undatedCount};
        }
        return sendJson(res,200,response);
      }
    }
    // ---------- 仪表盘聚合(新版主页,MVP 5 模块) ----------
    if (p === '/api/dashboard/summary' && method === 'GET') {
      const inqs = visibleRecords(await readJson(INQ_FILE), user);
      const comms = visibleRecords(await readJson(COMM_FILE), user);
      const today = new Date().toISOString().slice(0, 10);
      // 漏斗 4 阶段：开箱审核=新询盘+等回复 / 算价换方案=已报价 / 嫌议成待签约=谈判中 / 已确认订单=成交
      const stage1 = inqs.filter((q) => ['新询盘', '等回复'].includes(q.status || '新询盘')).length;
      const stage2 = inqs.filter((q) => q.status === '已报价').length;
      const stage3 = inqs.filter((q) => q.status === '谈判中').length;
      const stage4 = inqs.filter((q) => q.status === '成交').length;
      // KPI 4 卡片
      const canQuoteList = inqs.filter((q) => q.status === '已报价');
      const canQuote = { count: canQuoteList.length, amount: canQuoteList.reduce((s, q) => s + (Number(q.expectedAmount) || 0), 0) };
      const websitePending = inqs.filter((q) => (q.source || '') === '官网' || !q.owner).length;
      const lostAndFound = inqs.filter((q) => {
        const lf = q.lastFollowAt;
        if (!lf) return false;
        return String(lf).slice(0, 10) < today && !['成交', '输单', '无效', '暂缓'].includes(q.status || '');
      }).length;
      const mustReplyToday = inqs.filter((q) => String(q.nextFollowAt || '').slice(0, 10) === today).length;
      // 待办：今日必回 + 超期(7天未跟进且未关闭)
      const overdue = inqs.filter((q) => {
        const lf = q.lastFollowAt;
        if (!lf) return false;
        const days = (Date.now() - new Date(String(lf).slice(0, 10)).getTime()) / 86400000;
        return days > 7 && !['成交', '输单', '无效', '暂缓'].includes(q.status || '');
      }).length;
      // 智能超能体：消息/已回复/待办 (金额用原始数字,前端折算)
      const msg = comms.length;
      const replied = inqs.filter((q) => {
        const cl = q.chatLog;
        if (!cl) return false;
        if (typeof cl === 'string') return cl.length > 5;
        if (Array.isArray(cl)) return cl.length > 0;
        return false;
      }).length;
      const pending = inqs.filter((q) => !['成交', '输单', '无效', '暂缓'].includes(q.status || '')).length;
      const msgAmount = comms.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      // AI 提示（规则版）：今日预计成交=0 时给出建议
      const todayWon = inqs.filter((q) => {
        if (q.status !== '成交') return false;
        const k = q.wonAt ? new Date(Number(q.wonAt)).toISOString().slice(0, 10) : (q.receivedAt || '').slice(0, 10);
        return k === today;
      }).length;
      const aiHint = todayWon === 0
        ? '今日暂无预计成交商机，建议优先补充线索、推进报价并校准成交日期。'
        : `今日已成交 ${todayWon} 单，建议跟进尾款/物流并复盘客户画像。`;
      return sendJson(res, 200, {
        cards: { canQuote, websitePending, lostAndFound, mustReplyToday },
        funnel: { stage1, stage2, stage3, stage4 },
        todos: { today: mustReplyToday, overdue },
        aiAgent: { msg, replied, pending, msgAmount },
        aiHint,
      });
    }
    // ---------- 系统设置（询盘来源等） ----------
    if (p === '/api/settings') {
      const cur = await readJson(SETTINGS_FILE);
      const forUser = value => ({ ...value, uiPrefs: { [user.id]: (value.uiPrefs || {})[user.id] || {} } });
      if (method === 'GET') return sendJson(res, 200, forUser(cur));
      if (method === 'PUT') {
        const body = await readBody(req);
        const { uiPrefs, ...companySettings } = body;
        if (Object.keys(companySettings).length && !isBusinessManager(user)) return sendJson(res, 403, { error: '仅管理员或经理可修改公司设置' });
        if (uiPrefs && Object.keys(uiPrefs).some(id => id !== user.id)) return sendJson(res, 403, { error: '只能修改本人的界面偏好' });
        const next = { ...cur, ...companySettings };
        if (uiPrefs) next.uiPrefs = { ...(cur.uiPrefs || {}), [user.id]: uiPrefs[user.id] || {} };
        await writeJson(SETTINGS_FILE, next);
        return sendJson(res, 200, forUser(next));
      }
    }

    // ---------- 文件型 CRM 导入：保存原件 → AI 结构化 → 去重预览 → 用户确认批量写入 ----------
    const importMatch = p.match(/^\/api\/crm-imports\/([\w-]+)(?:\/(analyze|commit))?$/);
    const canAccessImport = (job) => user && job && (isBusinessManager(user) || job.owner === user.id);
    if (p === '/api/crm-imports' && method === 'GET') {
      const list = await readJson(CRM_IMPORTS_FILE);
      const rows = isBusinessManager(user) ? list : list.filter((x) => x.owner === user.id);
      return sendJson(res, 200, rows.map(({ sourceText, ...safe }) => safe));
    }
    if (p === '/api/crm-imports' && method === 'POST') {
      const body = await readBody(req);
      const name = safeImportFileName(body.filename || body.name || 'file');
      const parsed = decodeImportFile(name, body.data);
      const text = await parseImportDocument(parsed.ext, parsed.buf);
      if (!text.trim()) return sendJson(res, 422, { error: '未能从文件中提取到文本；扫描件请先做 OCR，或上传可复制文字的 PDF。' });
      const id = 'imp_' + genId();
      const storedName = id + '-' + name;
      await fsp.writeFile(path.join(CRM_IMPORT_DIR, storedName), parsed.buf);
      const list = await readJson(CRM_IMPORTS_FILE);
      const job = { id, owner: user.id, ownerName: user.name, createdAt: Date.now(), updatedAt: Date.now(), status: 'parsed', originalName: name, storedName, size: parsed.buf.length, sourceText: text.slice(0, 60000), analysis: null, result: null };
      list.push(job); await writeJson(CRM_IMPORTS_FILE, list);
      return sendJson(res, 201, importJobForClient(job));
    }
    if (importMatch) {
      const [, importId, operation] = importMatch;
      const list = await readJson(CRM_IMPORTS_FILE);
      const idx = list.findIndex((x) => x.id === importId);
      const job = list[idx];
      if (!job) return sendJson(res, 404, { error: '导入任务不存在' });
      if (!canAccessImport(job)) return sendJson(res, 403, { error: '无权访问该导入任务' });
      if (!operation && method === 'GET') return sendJson(res, 200, importJobForClient(job));
      if (operation === 'analyze' && method === 'POST') {
        const cfg = await resolveAiCfg({});
        if (!cfg.baseUrl || !cfg.model) return sendJson(res, 400, { error: 'AI 接口未配置，请先在 AI 助手设置中完成配置' });
        const visible = await visibleImportClients(user);
        const prompt = '你是外贸 CRM 文件录入助手。只根据文件内容提取客户资料，不得编造。仅返回合法 JSON，禁止 Markdown。格式：{"clients":[{"company":"","country":"","website":"","address":"","contactName":"","contactEmail":"","contactPhone":"","stage":"潜在","source":"文件导入","tags":[],"notes":""}],"contacts":[{"company":"","name":"","role":"","email":"","phone":""}],"inquiries":[{"company":"","product":"","country":"","contactName":"","contactEmail":"","expectedAmount":"","currency":"USD","source":"文件导入","notes":""}],"comms":[{"company":"","channel":"邮件","content":"","date":"YYYY-MM-DD"}]}。公司名不确定时不要输出客户；其他实体必须有公司名；日期不确定留空；最多 200 条客户。\n文件名：' + job.originalName + '\n文件内容：\n' + String(job.sourceText || '').slice(0, 60000);
        try {
          const upstream = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...aiHeaders(cfg) }, body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: '你只输出合法 JSON。' }, { role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' }, reasoning_effort: 'none' }), signal: abortAfter(cfg.timeout || 120000) });
          if (!upstream.ok) return sendJson(res, 502, { error: 'AI 接口返回 ' + upstream.status + ': ' + (await upstream.text()).slice(0, 300) });
          const reply = await upstream.json();
          const raw = reply?.choices?.[0]?.message?.content || '';
          job.analysis = normalizeImportAnalysis(parseImportAiJson(raw), visible);
          job.status = 'review'; job.updatedAt = Date.now(); await writeJson(CRM_IMPORTS_FILE, list);
          return sendJson(res, 200, importJobForClient(job));
        } catch (e) { return sendJson(res, 502, { error: aiErrMsg(e, cfg) }); }
      }
      if (operation === 'commit' && method === 'POST') {
        if (!job.analysis) return sendJson(res, 409, { error: '请先完成 AI 识别' });
        const body = await readBody(req);
        const outcome = await commitImportJob(job, body.decisions || {}, user);
        job.status = 'completed'; job.result = outcome; job.updatedAt = Date.now(); await writeJson(CRM_IMPORTS_FILE, list);
        return sendJson(res, 200, { job: importJobForClient(job), result: outcome });
      }
    }
    // ---------- AI 配置 ----------
    if (p === '/api/ai/config') {
      if (method !== 'GET' && user.role !== 'admin') return sendJson(res, 403, { error: '仅管理员可修改 AI 配置' });
      if (method === 'GET') {
        const cfg = { ...AI_DEFAULT, ...(await readJson(AI_FILE)) };
        // apiKey 不明文回传，仅告知是否已设置
        return sendJson(res, 200, { ...cfg, apiKey: cfg.apiKey ? '********' : '', hasKey: !!cfg.apiKey });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const cur = { ...AI_DEFAULT, ...(await readJson(AI_FILE)) };
        const next = { ...cur, ...body };
        // 前端回传掩码时保留原 key
        if (body.apiKey === '********') next.apiKey = cur.apiKey;
        delete next.hasKey;
        await writeJson(AI_FILE, next);
        return sendJson(res, 200, { ...next, apiKey: next.apiKey ? '********' : '', hasKey: !!next.apiKey });
      }
    }

    // ---------- AI 连通性测试 ----------
    if (p === '/api/ai/test' && method === 'POST') {
      const body = await readBody(req);
      const cfg = await resolveAiCfg(user.role === 'admin' ? body : {});
      try {
        const r = await fetch(joinUrl(cfg.baseUrl, '/models'), {
          headers: aiHeaders(cfg), signal: abortAfter(10000),
        });
        const txt = await r.text();
        if (!r.ok) return sendJson(res, 200, { ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
        let models = [];
        try {
          const j = JSON.parse(txt);
          models = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
        } catch { /* 非标准返回，忽略 */ }
        return sendJson(res, 200, { ok: true, models, endpoint: cfg.baseUrl });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: aiErrMsg(e, cfg) });
      }
    }

    // ---------- AI 管家编排层（2026-08-26 P0）----------
    // 会话历史进 → 工具循环（查询在服务端执行，带 RBAC）→ {text, actions, queryResults} 出。
    // 写动作由前端渲染 ActionCard，用户确认后走下方既有 REST（权限/审计自动继承）。
    if (p === '/api/ai/agent' && method === 'POST') {
      const body = await readBody(req);
      return handleAiAgent(res, body, {
        user, sendJson,
        resolveAiCfg: body => resolveAiCfg(user.role === 'admin' ? body : {}), joinUrl, aiHeaders, abortAfter, aiErrMsg,
        readJson, buildVisibleOwners, canAccessRecord,
        files: { CLIENTS_FILE, INQ_FILE, ORDERS_FILE, QUOTATIONS_FILE, COMM_FILE, TASKS_FILE, CONTACTS_FILE },
      });
    }

    // ---------- AI 对话代理（支持流式） ----------
    if (p === '/api/ai/chat' && method === 'POST') {
      const body = await readBody(req);
      const cfg = await resolveAiCfg(user.role === 'admin' ? body : {});
      const payload = {
        model: cfg.model,
        messages: body.messages || [],
        temperature: body.temperature ?? cfg.temperature ?? 0.2,
        stream: !!body.stream,
      };
      if (body.jsonMode) {
        payload.response_format = { type: 'json_object' };
        // 2026-09-30：思考型模型（ornith / qwen3 等）在长文档抽取时会把输出预算
        // 全部耗在 reasoning 上，最终 content 为空、单次耗时数百秒，前端表现为
        // 「解析超时，请重试或减少文件内容」。结构化抽取不需要长思考，显式关闭；
        // 确有需要时可由调用方传 reasoningEffort 覆盖。
        payload.reasoning_effort = body.reasoningEffort || 'none';
      }

      try {
        const upstream = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiHeaders(cfg) },
          body: JSON.stringify(payload),
          signal: abortAfter(cfg.timeout || 120000),
        });

        if (!upstream.ok) {
          const txt = await upstream.text();
          return sendJson(res, 502, { error: `AI 接口返回 ${upstream.status}: ${txt.slice(0, 400)}` });
        }

        // 流式：SSE 直通
        if (payload.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          for await (const chunk of upstream.body) res.write(chunk);
          return res.end();
        }

        // 非流式：直接透传 JSON
        const j = await upstream.json();
        return sendJson(res, 200, j);
      } catch (e) {
        return sendJson(res, 502, { error: aiErrMsg(e, cfg) });
      }
    }

    // ---------- 任务 / 日历（按 RBAC 可见范围过滤；owner=创建人） ----------
    if (p === '/api/tasks') {
      if (method === 'GET') {
        const all = await readJson(TASKS_FILE);
        const va = buildVisibleOwners(user);
        return sendJson(res, 200, va ? all.filter((o) => va.has(o.owner)) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(TASKS_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        list.push(item);
        await writeJson(TASKS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const tm = p.match(/^\/api\/tasks\/([\w-]+)$/);
    if (tm && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(TASKS_FILE);
      const idx = list.findIndex((o) => o.id === tm[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该任务' });
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(TASKS_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: tm[1], updatedAt: Date.now() };
      await writeJson(TASKS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // 联系人 CRUD（多联系人 / 多角色）
    if (p === '/api/contacts') {
      if (method === 'GET') {
        const all = await readJson(CONTACTS_FILE);
        const va = buildVisibleOwners(user);
        let rows = va ? all.filter((o) => va.has(o.owner)) : all;
        const clientId = url.searchParams.get('clientId');
        if (clientId) rows = rows.filter((o) => o.clientId === clientId);
        return sendJson(res, 200, rows);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(CONTACTS_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, ...withOwner(body, user) };
        // 设为主联系人时，取消同客户其他主联系人
        if (item.isPrimary) await unmarkPrimary(list, item.clientId, null, user);
        list.push(item);
        await writeJson(CONTACTS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const ctmRe = p.match(/^\/api\/contacts\/([\w-]+)$/);
    if (ctmRe && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(CONTACTS_FILE);
      const idx = list.findIndex((o) => o.id === ctmRe[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该联系人' });
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(CONTACTS_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      const updated = { ...list[idx], ...body, id: ctmRe[1], updatedAt: Date.now() };
      if (updated.isPrimary) await unmarkPrimary(list, updated.clientId, ctmRe[1], user);
      list[idx] = updated;
      await writeJson(CONTACTS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // 聊天记录（整段导入 → 行级标注客户/我 → AI 接待建议）
    if (p === '/api/chats') {
      if (method === 'GET') {
        const all = await readJson(CHATS_FILE);
        const va = buildVisibleOwners(user);
        let rows = va ? all.filter((o) => va.has(o.owner)) : all;
        const clientName = url.searchParams.get('clientName');
        if (clientName) rows = rows.filter((o) => o.clientName === clientName);
        rows = rows.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, rows);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(CHATS_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, lines: [], ...withOwner(body, user) };
        list.push(item);
        await writeJson(CHATS_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    const chRe = p.match(/^\/api\/chats\/([\w-]+)$/);
    if (chRe && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(CHATS_FILE);
      const idx = list.findIndex((o) => o.id === chRe[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该聊天记录' });
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(CHATS_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      list[idx] = { ...list[idx], ...body, id: chRe[1], updatedAt: Date.now() };
      await writeJson(CHATS_FILE, list);
      return sendJson(res, 200, list[idx]);
    }

    // ---------- 跟进提醒中心：派生扫描 + 已读标记 ----------
    if (p === '/api/reminders/scan' && method === 'GET') {
      const now = Date.now();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();
      const DAY = 86400000;
      const st = await readJson(SETTINGS_FILE);
      const rd = (st && st.reminderDays) || {};
      const followDays = rd.follow ?? 3;
      const quoteDays = rd.quote ?? 3;
      const financeDays = rd.finance ?? 7;

      const va = buildVisibleOwners(user);
      const vis = (owner) => (va ? va.has(owner) : true);

      const notis = await readJson(NOTIFICATIONS_FILE);
      const myReads = (notis && notis[user.id]) || {};
      const dismissed = (key) => !!(myReads[key] && myReads[key].read);

      const items = [];
      const pushItem = (key, rule, level, refType, text, date) => {
        if (dismissed(key)) return;
        items.push({ key, rule, level, refType, text, date });
      };

      // R1 今日/逾期任务
      const tasks = await readJson(TASKS_FILE);
      for (const t of (Array.isArray(tasks) ? tasks : [])) {
        if (!vis(t.owner)) continue;
        if (t.status === '已完成' || t.status === '已取消' || !t.dueDate) continue;
        const dm = Date.parse(t.dueDate);
        if (isNaN(dm)) continue;
        const diff = Math.floor((dm - todayMs) / DAY);
        if (diff < 0) pushItem('task|task|' + t.id, 'R1', 'high', 'task', '任务逾期：' + (t.title || ''), t.dueDate);
        else if (diff === 0) pushItem('task|task|' + t.id, 'R1', 'medium', 'task', '今日任务：' + (t.title || ''), t.dueDate);
      }

      // R2 询盘超期未跟进
      const inq = await readJson(INQ_FILE);
      const CLOSED = new Set(['成交', '已成交', '输单', '无效', '暂缓', '终止', '作废', '丢单']);
      for (const q of (Array.isArray(inq) ? inq : [])) {
        if (!vis(q.owner)) continue;
        if (CLOSED.has((q.status || '').trim())) continue;
        const last = q.lastFollowAt || q.receivedAt || '';
        if (!last) continue;
        const la = Date.parse(last);
        if (isNaN(la)) continue;
        if ((todayMs - la) / DAY >= followDays) {
          pushItem('inq|inquiry|' + q.id, 'R2', 'high', 'inquiry', `超期未跟进：${q.clientName || ''}`, last);
        }
      }

      // R3 报价未回复 / 即将过期
      const qs = await readJson(QUOTATIONS_FILE);
      const DONE = new Set(['草稿', '已转订单', '已成交', '成交', '已确认', '已拒绝', '已过期', '作废', '无效', '丢失', '取消']);
      for (const qq of (Array.isArray(qs) ? qs : [])) {
        if (!vis(qq.owner)) continue;
        const stat = (qq.status || '').trim();
        if (DONE.has(stat) || !stat) continue; // 草稿/已关闭跳过；其余视为待回复
        const sentMs = qq.sentAt ? (Number(qq.sentAt) || Date.parse(qq.sentAt) || 0) : (qq.createdAt || 0);
        const overdueQ = sentMs && (todayMs - sentMs) / DAY >= quoteDays;
        let expiring = false;
        if (qq.validUntil) { const v = Date.parse(qq.validUntil); if (!isNaN(v) && v > todayMs && v - todayMs <= 3 * DAY) expiring = true; }
        if (!overdueQ && !expiring) continue;
        const who = qq.clientName || qq.projectName || qq.quoteNo || '';
        pushItem('quo|quotation|' + qq.id, 'R3', overdueQ ? 'high' : 'medium', 'quotation',
          (overdueQ ? '报价未回复：' : '报价即将过期：') + who, qq.validUntil || '');
      }

      // R5 回款到期 / 逾期
      const fin = await readJson(FIN_FILE);
      for (const f of (Array.isArray(fin) ? fin : [])) {
        if (!vis(f.owner)) continue;
        if (f.status && /收|paid|done|结|done/i.test(String(f.status))) continue;
        const due = f.dueDate || f.planDate || f.date;
        if (!due) continue;
        const dm = Date.parse(due);
        if (isNaN(dm)) continue;
        const diff = (dm - todayMs) / DAY;
        if (diff > financeDays) continue;
        const who = f.clientName || f.party || f.partner || f.name || '';
        pushItem('fin|finance|' + f.id, 'R5', diff < 0 ? 'high' : 'medium', 'finance',
          (diff < 0 ? '回款逾期：' : '回款到期：') + who, due);
      }

      return sendJson(res, 200, { items, unread: items.length, generatedAt: now });
    }

    // ---------- 提醒已读/忽略 ----------
    if (p === '/api/notifications/dismiss' && (method === 'POST' || method === 'PUT')) {
      const body = await readBody(req);
      const key = String(body.key || '').trim();
      if (!key) return sendJson(res, 400, { error: '缺少提醒 key' });
      const notis = (await readJson(NOTIFICATIONS_FILE)) || {};
      if (!notis[user.id]) notis[user.id] = {};
      notis[user.id][key] = { read: true, at: Date.now() };
      await writeJson(NOTIFICATIONS_FILE, notis);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- 资料/知识库 CRUD ----------
    if (p === '/api/knowledge') {
      if (method === 'GET') {
        const all = await readJson(KNOWLEDGE_FILE);
        const va = buildVisibleOwners(user);
        let rows = va ? all.filter((o) => va.has(o.owner)) : all;
        if (!isBusinessManager(user)) rows = rows.filter((r) => r.status === '已发布' || r.owner === user.id);
        const cat = url.searchParams.get('category');
        const stat = url.searchParams.get('status');
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        if (cat) rows = rows.filter((r) => r.category === cat);
        if (stat) rows = rows.filter((r) => r.status === stat);
        if (q) rows = rows.filter((r) => (r.title || '').toLowerCase().includes(q) || (r.content || '').toLowerCase().includes(q));
        rows = rows.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, rows);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const list = await readJson(KNOWLEDGE_FILE);
        const now = Date.now();
        const item = { id: genId(), createdAt: now, updatedAt: now, version: 1, versions: [], status: body.status || '草稿', category: body.category || '其他', ...withOwner(body, user) };
        if (item.status === '已发布') item.publishedAt = now;
        list.push(item);
        await writeJson(KNOWLEDGE_FILE, list);
        return sendJson(res, 201, item);
      }
    }
    // 审核流转
    const kr = p.match(/^\/api\/knowledge\/([\w-]+)\/review$/);
    if (kr && method === 'POST') {
      const list = await readJson(KNOWLEDGE_FILE);
      const idx = list.findIndex((k) => k.id === kr[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该资料' });
      const body = await readBody(req);
      const action = String(body.action || '');
      const cur = list[idx];
      if (action === 'publish') { if (!isBusinessManager(user)) return sendJson(res, 403, { error: '仅管理员或经理可发布' }); cur.status = '已发布'; cur.publishedAt = Date.now(); }
      else if (action === 'archive') cur.status = '已归档';
      else if (action === 'draft') cur.status = '草稿';
      else return sendJson(res, 400, { error: '未知操作' });
      cur.updatedAt = Date.now();
      list[idx] = cur;
      await writeJson(KNOWLEDGE_FILE, list);
      return sendJson(res, 200, cur);
    }
    // 版本快照：把当前内容压入 versions[]，再写入新版本内容
    const kv = p.match(/^\/api\/knowledge\/([\w-]+)\/version$/);
    if (kv && method === 'POST') {
      const list = await readJson(KNOWLEDGE_FILE);
      const idx = list.findIndex((k) => k.id === kv[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该资料' });
      const cur = list[idx]; const body = await readBody(req);
      (cur.versions = cur.versions || []).push({ version: cur.version || 1, title: cur.title, content: cur.content, attachmentUrl: cur.attachmentUrl, tags: cur.tags || [], by: user.name, at: Date.now(), note: body.note || '' });
      cur.version = (cur.version || 1) + 1;
      if (body.title != null) cur.title = body.title;
      if (body.content != null) cur.content = body.content;
      if (body.attachmentUrl != null) cur.attachmentUrl = body.attachmentUrl;
      if (body.tags != null) cur.tags = body.tags;
      if (body.status != null) cur.status = body.status;
      if (body.category != null) cur.category = body.category;
      if (cur.status === '已发布' && !cur.publishedAt) cur.publishedAt = Date.now();
      cur.updatedAt = Date.now();
      list[idx] = cur;
      await writeJson(KNOWLEDGE_FILE, list);
      return sendJson(res, 200, cur);
    }
    // 资料 id CRUD
    const km = p.match(/^\/api\/knowledge\/([\w-]+)$/);
    if (km && (method === 'PUT' || method === 'DELETE')) {
      const list = await readJson(KNOWLEDGE_FILE);
      const idx = list.findIndex((k) => k.id === km[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });
      if (!canAccessRecord(user, list[idx].owner)) return sendJson(res, 403, { error: '无权限操作该资料' });
      if (method === 'DELETE') { list.splice(idx, 1); await writeJson(KNOWLEDGE_FILE, list); return sendJson(res, 200, { ok: true }); }
      const body = await readBody(req);
      const updated = { ...list[idx], ...body, id: km[1], updatedAt: Date.now() };
      if (updated.status === '已发布' && list[idx].status !== '已发布') updated.publishedAt = Date.now();
      list[idx] = updated;
      await writeJson(KNOWLEDGE_FILE, list);
      return sendJson(res, 200, updated);
    }

    // 静态资源
    return serveStatic(req, res);
  } catch (e) {
    console.error(`[api] ${method} ${p} 失败:`, e.message);
    sendJson(res, e.status || 500, { error: e.message });
  }
}

releaseNotice = await createReleaseNotice(__dirname);
await ensureStore();
await migrateContacts();
await dailySnapshot();
server.listen(PORT, () => {
  console.log(`外贸CRM系统已启动: http://localhost:${PORT}`);
  console.log(`数据目录: ${DATA_DIR}`);
});

// 优雅退出：先把内存里的审计队列刷盘，再退出（避免 SIGTERM 丢失最后几条日志）
let _shutting = false;
async function gracefulShutdown(sig) {
  if (_shutting) return;
  _shutting = true;
  console.log(`收到 ${sig}，正在刷新审计日志后退出...`);
  try { await flushAudit(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

