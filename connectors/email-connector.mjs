/**
 * 外贸人工作台 邮件接入端（IMAP 收信）
 *
 * 功能：IMAP 按 UID 增量轮询收件箱 → 新邮件推送到工作台 /api/webhook/incoming
 *      → 出现在工作台「沟通」模块，通道标记为「邮件」。
 *
 * 发信方向：工作台「邮件」页已内置 SMTP 发信（server.js 原生实现），本接入端只管收。
 *
 * 环境变量：
 *  WORKBENCH_URL        工作台地址，默认 http://localhost:4173
 *  FTW_WEBHOOK_SECRET   与工作台一致的 Webhook 密钥（必填）
 *  IMAP_HOST/IMAP_PORT/IMAP_SECURE/IMAP_USER/IMAP_PASS  邮箱 IMAP 配置
 *  （QQ/163/Gmail 等需用「授权码」而非登录密码；腾讯企业邮 imap.exmail.qq.com:993）
 *
 * 状态（lastSeenUid）持久化在 /data/email-connector-state.json，重启不重复推送。
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const WORKBENCH_URL = (process.env.WORKBENCH_URL || "http://localhost:4173").replace(/\/$/, "");
const WEBHOOK_SECRET = process.env.FTW_WEBHOOK_SECRET || "";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 60_000);
const STATE_FILE = process.env.STATE_FILE || "/data/email-connector-state.json";

let lastSeenUid = 0;

if (!WEBHOOK_SECRET) {
  console.error("缺少必填环境变量 FTW_WEBHOOK_SECRET");
  process.exit(1);
}

// 从工作台配置的共享 JSON 文件读取 IMAP 配置（优先级高于环境变量）
const CONFIG_FILE = process.env.CONFIG_FILE || "/data/email-connector-config.json";
let imapConfig = {
  host: process.env.IMAP_HOST, port: Number(process.env.IMAP_PORT || 993),
  secure: process.env.IMAP_SECURE !== "false", user: process.env.IMAP_USER, pass: process.env.IMAP_PASS,
};
try {
  if (existsSync(CONFIG_FILE)) {
    const fileCfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    if (fileCfg.host && fileCfg.user) {
      imapConfig = { host: fileCfg.host, port: Number(fileCfg.port || 993), secure: fileCfg.secure !== false, user: fileCfg.user, pass: fileCfg.pass };
      console.log("IMAP config loaded from", CONFIG_FILE);
    }
  }
} catch (e) { console.log("Config file not available, using env vars:", e.message); }

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      lastSeenUid = JSON.parse(readFileSync(STATE_FILE, "utf8")).lastSeenUid || 0;
    }
  } catch { /* 状态文件损坏则重新开始 */ }
}
function saveState() {
  try { writeFileSync(STATE_FILE, JSON.stringify({ lastSeenUid }, null, 2)); } catch { /* 忽略 */ }
}

function parseFrom(from) {
  const addr = from?.value?.[0] || {};
  return {
    name: addr.name?.trim() || addr.address || "未知发件人",
    email: (addr.address || "").toLowerCase(),
  };
}

async function pushIncoming({ contactName, subject, content }) {
  try {
    const res = await fetch(`${WORKBENCH_URL}/api/webhook/incoming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        contactName,
        content: subject ? `[${subject}] ${content}` : content,
        channel: "email",
        summary: subject || "",
      }),
    });
    if (!res.ok) console.warn("[webhook] 推送失败:", res.status, await res.text());
    else console.log(`[in] 已入库: ${contactName} ${subject}`);
  } catch (err) {
    console.warn("[webhook] 请求失败:", err.message);
  }
}

async function fetchNewEmails() {
  const client = new ImapFlow({
    host: imapConfig.host,
    port: imapConfig.port,
    secure: imapConfig.secure,
    auth: { user: imapConfig.user, pass: imapConfig.pass },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      if (lastSeenUid === 0) {
        // 首次运行只记录当前位置，不把历史邮件灌进工作台
        const status = await client.status("INBOX", { uidNext: true });
        lastSeenUid = Math.max(0, (status.uidNext || 1) - 1);
        saveState();
        console.log(`[imap] 初始化完成，从 UID ${lastSeenUid} 之后开始监听`);
        return;
      }
      for await (const msg of client.fetch(`${lastSeenUid + 1}:*`, { source: true, uid: true })) {
        const parsed = await simpleParser(msg.source);
        const { name } = parseFrom(parsed.from);
        const content = (parsed.text || "").slice(0, 5000);
        if (content.trim()) {
          await pushIncoming({ contactName: name, subject: parsed.subject || "", content });
        }
        lastSeenUid = Math.max(lastSeenUid, msg.uid);
      }
      saveState();
    } finally {
      lock.release();
    }
  } catch (err) {
    console.warn("[imap] 拉取失败:", err.message);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function main() {
  loadState();
  console.log(`[email-connector] 启动，每 ${POLL_MS / 1000}s 轮询一次 ${imapConfig.host}`);
  await fetchNewEmails();
  setInterval(fetchNewEmails, POLL_MS);
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
