/**
 * 外贸人工作台 WhatsApp 接入端（Baileys 版）
 *
 * 功能：扫码登录 WhatsApp（建议小号）→ 收到新消息推送到工作台 /api/webhook/incoming
 *      → 出现在工作台「沟通」模块，通道标记为 WhatsApp。
 *
 * 发送方向：工作台没有出站消息队列，回复客户仍在手机 WhatsApp 里完成，
 *           或在「沟通」里手动补一条记录。后续可加出站轮询扩展。
 *
 * 环境变量：
 *  WORKBENCH_URL        工作台地址，默认 http://localhost:4173
 *  FTW_WEBHOOK_SECRET   与工作台容器环境变量一致的 Webhook 密钥（必填）
 *
 * Docker 里首次扫码：docker logs -f ftw-whatsapp-connector 查看二维码。
 */
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";

const WORKBENCH_URL = (process.env.WORKBENCH_URL || "http://localhost:4173").replace(/\/$/, "");
const WEBHOOK_SECRET = process.env.FTW_WEBHOOK_SECRET || "";
const AUTH_DIR = process.env.AUTH_DIR || "/data/whatsapp-session";

if (!WEBHOOK_SECRET) {
  console.error("缺少 FTW_WEBHOOK_SECRET 环境变量，无法启动");
  process.exit(1);
}

/** 入站消息推送到工作台「沟通」模块 */
async function pushIncoming({ contactName, content }) {
  try {
    const res = await fetch(`${WORKBENCH_URL}/api/webhook/incoming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({ contactName, content, channel: "whatsapp" }),
    });
    if (!res.ok) console.warn("[webhook] 推送失败:", res.status, await res.text());
    else console.log(`[in] 已入库: ${contactName}: ${content.slice(0, 30)}`);
  } catch (err) {
    console.warn("[webhook] 请求失败:", err.message);
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("[wa] 请用手机 WhatsApp（已链接的设备）扫描下方二维码：");
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === "open") console.log("[wa] 已连接 WhatsApp，开始监听消息");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("[wa] 连接断开，5 秒后重连...");
        setTimeout(start, 5000);
      } else {
        console.log("[wa] 已登出，请删除会话目录后重启容器重新扫码");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (m.key.fromMe) continue;                       // 忽略自己发的
      if (m.key.remoteJid?.endsWith("@g.us")) continue; // 忽略群聊
      const contactName = m.pushName || m.key.remoteJid.split("@")[0];
      const content =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        "";
      if (!content.trim()) continue;
      await pushIncoming({ contactName, content });
    }
  });
}

start().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
