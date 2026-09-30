// db/migrate.js — 一次性把现有 JSON/JSONL 数据导入 MySQL
// 用法：node db/migrate.js   （需先设置 FTW_STORAGE=mysql 且 MariaDB 可连）
// 幂等：每个集合先清空再写入，重复执行结果一致。原 JSON 文件不受影响，可保留作冷备份。
import fs from 'node:fs';
import path from 'node:path';
import * as dal from './dal.js';
import { ARRAYS, KV } from './dal.js';

const DATA_DIR = dal.DATA_DIR;

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function readJsonFile(base) {
  const fp = path.join(DATA_DIR, base + '.json');
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, 'utf8');
  try { return JSON.parse(raw); } catch { return null; }
}

function readAuditJsonl() {
  const fp = path.join(DATA_DIR, 'audit.json');
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, 'utf8');
  return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => safeParse(l)).filter(Boolean);
}

async function main() {
  const m = await dal.initDAL();
  if (m !== 'mysql') {
    console.error('MySQL 未启用（当前模式：' + m + '）。请确认已设置 FTW_STORAGE=mysql 且 MariaDB 可连接。');
    process.exit(1);
  }
  console.log('开始导入…');

  // 数组 / 通用集合
  for (const base of Object.keys(ARRAYS)) {
    const data = readJsonFile(base);
    if (data == null) { console.log('跳过（无文件）:', base); continue; }
    await dal.writeCollection(base, data);
    console.log('✓', base, '->', Array.isArray(data) ? data.length + ' 条' : '对象');
  }
  // 单例 kv
  for (const base of KV) {
    const data = readJsonFile(base);
    if (data == null) { console.log('跳过（无文件）:', base); continue; }
    await dal.writeCollection(base, data);
    console.log('✓', base, '-> 单例');
  }
  // users / sales（原对象形状）
  const users = readJsonFile('users');
  if (users) { await dal.writeCollection('users', users); console.log('✓ users ->', (users.users || []).length, '人'); }
  const sales = readJsonFile('sales');
  if (sales) { await dal.writeCollection('sales', sales); console.log('✓ sales -> 导入'); }

  // audit（JSONL）
  const audit = readAuditJsonl();
  if (audit.length) {
    await dal.insertAudit(audit);
    console.log('✓ audit ->', audit.length, '条');
  }

  console.log('\n导入完成。原 JSON 文件已保留为冷备份，无需删除。');
  process.exit(0);
}

main().catch((e) => { console.error('导入失败:', e); process.exit(1); });
