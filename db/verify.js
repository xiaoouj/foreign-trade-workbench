// db/verify.js — 验证 MySQL 升级是否真正生效（直接连库查表，不依赖日志）
// 用法：在 外贸人工作台 目录下执行  node db/verify.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

// 解析 .env（覆盖式：仅当 process.env 未设置时）
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

// 强制 mysql 模式；从宿主侧连(容器已映射 3306 到宿主)；容器间联调用 db
process.env.FTW_STORAGE = 'mysql';
process.env.FTW_DB_HOST = process.env.FTW_DB_HOST || '127.0.0.1';
process.env.FTW_DB_PORT = process.env.FTW_DB_PORT || '3306';

console.log('连接参数:', {
  host: process.env.FTW_DB_HOST,
  port: process.env.FTW_DB_PORT,
  user: process.env.FTW_DB_USER,
  db: process.env.FTW_DB_NAME,
  pwdSet: !!process.env.FTW_DB_PASSWORD,
});

const dal = await import('./dal.js');
const mode = await dal.initDAL();
console.log('\n◆ 存储模式:', mode);

if (mode !== 'mysql') {
  console.log('\n⚠️ 未启用 MySQL（已降级为 JSON 文件模式）。升级未成功，常见原因：');
  console.log('   1) MariaDB 容器未运行 / 未重新部署 compose');
  console.log('   2) .env 里 FTW_DB_PASSWORD 未填写或与管理员密码不一致');
  console.log('   3) 3306 端口未映射到宿主（脚本从宿主侧连接）');
  process.exit(0);
}

console.log('\n✅ MySQL 存储已启用。开始核查表与数据：\n');

// 账号（最关键的验收点：能登录 = 用户已导入）
const users = await dal.readCollection('users', { users: [] });
const uList = (users.users || []);
console.log(`◆ users(账号表): ${uList.length} 个 ->`, uList.map((u) => u.username).join(', ') || '(空!)');

// 业务数组集合
const arrays = ['clients', 'orders', 'inquiries', 'chats', 'comms', 'exceptions', 'quotations', 'contacts', 'products', 'tasks', 'suppliers', 'shipments', 'finance', 'knowledge', 'hs-code', 'emails', 'comm-templates'];
for (const base of arrays) {
  try {
    const arr = await dal.readCollection(base, []);
    const n = Array.isArray(arr) ? arr.length : (arr && arr.length !== undefined ? arr.length : 0);
    console.log(`  - ${base.padEnd(14)}: ${n} 条`);
  } catch (e) { console.log(`  - ${base.padEnd(14)}: 读取异常 ${e.message}`); }
}

// 单例 / 对象集合
const kv = ['settings', 'ai-config', 'mail', 'mail-sent', 'notifications', 'sales'];
for (const k of kv) {
  try {
    const o = await dal.readCollection(k, null);
    let desc = '空';
    if (o != null) desc = Array.isArray(o) ? `${o.length} 项` : `${Object.keys(o).length} keys`;
    console.log(`  - ${k.padEnd(14)}: ${desc}`);
  } catch (e) { console.log(`  - ${k.padEnd(14)}: 读取异常 ${e.message}`); }
}

// 审计
try {
  const audit = await dal.selectAudit();
  console.log(`  - audit(审计表)    : ${audit.length} 条`);
} catch (e) { console.log(`  - audit            : 读取异常 ${e.message}`); }

// 抽查一条订单结构（证明规范化字段已落地）
try {
  const orders = await dal.readCollection('orders', []);
  if (Array.isArray(orders) && orders.length) {
    const allKeys = new Set();
    orders.slice(0, 50).forEach((o) => Object.keys(o).forEach((kk) => allKeys.add(kk)));
    console.log('\n◆ orders 字段样本:', [...allKeys].slice(0, 20).join(', '));
  }
} catch { /* ignore */ }

console.log('\n========================================');
console.log(mode === 'mysql' && uList.length > 0
  ? '✅ 验证通过：MySQL 已启用且业务数据已导入，升级成功。'
  : '⚠️ MySQL 已启用但业务数据为空，请运行 node db/migrate.js 导入 JSON 冷备。');
console.log('========================================');
