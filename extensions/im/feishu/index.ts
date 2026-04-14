/**
 * Feishu (Lark) IM Extension
 * ===========================
 * A real ChannelPlugin implementation for Feishu/Lark enterprise IM.
 *
 * Environment Variables:
 *   FEISHU_APP_ID         - Feishu app ID
 *   FEISHU_APP_SECRET     - Feishu app secret
 *   FEISHU_VERIFICATION_TOKEN - Optional event verification token
 *   FEISHU_WEBHOOK_PORT   - HTTP port for event subscription (default 3000)
 *   FEISHU_WEBHOOK_PATH   - HTTP path for events (default /feishu/webhook)
 *
 * Usage:
 *   import { feishuPlugin } from "./extensions/im/feishu/index.ts";
 *   feishuPlugin.start();  // starts webhook server
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type {
  ChannelMessage,
  ChannelInboundAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelMember,
} from "../../../types/index.ts";
import { appConfig } from "../../../core/config.ts";
import { checkRateLimit } from "../../../core/rate-limiter.ts";
import { createHash, createDecipheriv, createHmac } from "crypto";
import { readFileSync, existsSync } from "fs";
import { basename, extname } from "path";

function sha256Hex(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function decryptFeishuBody(encryptKey: string, encryptedBase64: string): Record<string, unknown> {
  const key = Buffer.from(sha256Hex(encryptKey), "hex");
  const encrypted = Buffer.from(encryptedBase64, "base64");
  const iv = encrypted.slice(0, 16);
  const ciphertext = encrypted.slice(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  // Remove PKCS7 padding manually
  const padLen = decrypted[decrypted.length - 1];
  const unpadded = decrypted.slice(0, decrypted.length - padLen);
  return JSON.parse(unpadded.toString("utf-8"));
}

export function isFreshTimestamp(ts: string | number, windowMinutes = 1): boolean {
  const t = typeof ts === "string" ? parseInt(ts, 10) : ts;
  if (isNaN(t)) return false;
  return Math.abs(Date.now() / 1000 - t) < windowMinutes * 60;
}

export function verifyFeishuSignature(body: string, signature: string, timestamp: string, nonce: string, encryptKey: string): boolean {
  const signStr = `${timestamp}\n${nonce}\n${body}\n`;
  const expected = createHmac("sha256", encryptKey).update(signStr).digest("base64");
  return signature === expected;
}

// =============================================================================
// Configuration
// =============================================================================

export const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

function getConfig() {
  return {
    appId: appConfig.feishu.appId,
    appSecret: appConfig.feishu.appSecret,
    verificationToken: appConfig.feishu.verificationToken,
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || "",
    port: appConfig.feishu.webhookPort,
    path: appConfig.feishu.webhookPath,
  };
}

// =============================================================================
// Token Cache
// =============================================================================

interface TokenCache {
  token: string;
  expireAt: number;
}

let tokenCache: TokenCache | null = null;

export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expireAt - 60_000) {
    return tokenCache.token;
  }
  const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = (await res.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Feishu auth failed: ${data.msg || JSON.stringify(data)}`);
  }
  tokenCache = {
    token: data.tenant_access_token,
    expireAt: Date.now() + (data.expire || 7200) * 1000,
  };
  return tokenCache.token;
}

// =============================================================================
// HTTP Helpers
// =============================================================================

const FEISHU_MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let received = 0;
  return new Promise((resolve, reject) => {
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > FEISHU_MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function respond(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// =============================================================================
// Feishu Bot Adapter
// =============================================================================

interface FeishuWebhookPayload {
  uuid?: string;
  token?: string;
  ts?: string;
  type?: string;
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    token?: string;
    create_time?: string;
  };
  event?: {
    message?: {
      message_id: string;
      chat_id: string;
      chat_type: "p2p" | "group";
      content: string; // JSON string, e.g. {"text":"hello"}
      message_type?: string;
      create_time?: string;
    };
    sender?: {
      sender_id?: {
        open_id?: string;
        union_id?: string;
        user_id?: string;
      };
      sender_type?: string;
    };
  };
  challenge?: string;
}

type MessageHandler = (msg: ChannelMessage) => void;

class FeishuBot implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private handlers: MessageHandler[] = [];
  private server: ReturnType<typeof createServer> | null = null;
  private started = false;

  private async checkSenderRateLimit(senderId: string): Promise<boolean> {
    const result = await checkRateLimit(`feishu:${senderId}`, 30, 60_000);
    return result.allowed;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    const cfg = getConfig();
    if (!cfg.appId || !cfg.appSecret) {
      console.warn(
        "[Feishu] Missing FEISHU_APP_ID or FEISHU_APP_SECRET. " +
          "Plugin will simulate events only."
      );
    }

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(cfg.port, () => {
      console.log(`[Feishu] Webhook server listening on http://0.0.0.0:${cfg.port}${cfg.path}`);
    });
    this.started = true;
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.started = false;
  }

  isRunning(): boolean {
    return this.started;
  }

  // ---------------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------------

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private emitMessage(msg: ChannelMessage) {
    for (const h of this.handlers) {
      try {
        h(msg);
      } catch (e) {
        console.error("[Feishu] Handler error:", e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async sendText(
    channelId: string,
    text: string,
    opts?: { threadId?: string; mentionUsers?: string[] }
  ): Promise<{ success: true; data: undefined }> {
    const cfg = getConfig();
    if (!cfg.appId || !cfg.appSecret) {
      console.log(`[Feishu → ${channelId}] (simulated)\n${text}\n`);
      return { success: true, data: undefined };
    }

    const token = await getTenantAccessToken(cfg.appId, cfg.appSecret);
    const content = JSON.stringify({ text });

    let url: string;
    if (opts?.threadId) {
      // Reply to specific message
      url = `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(opts.threadId)}/reply`;
    } else {
      // Send to chat
      url = `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`;
    }

    const body = opts?.threadId
      ? { content, msg_type: "text" }
      : { receive_id: channelId, content, msg_type: "text" };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as { code: number; msg: string };
    if (data.code !== 0) {
      console.error(`[Feishu] Send failed: ${data.msg || JSON.stringify(data)}`);
    } else {
      console.log(`[Feishu → ${channelId}] message sent.`);
    }
    return { success: true, data: undefined };
  }

  async sendMedia(
    channelId: string,
    mediaUrl: string,
    opts?: { threadId?: string }
  ): Promise<{ success: true; data: undefined }> {
    const cfg = getConfig();
    if (!cfg.appId || !cfg.appSecret) {
      console.log(`[Feishu → ${channelId}] (simulated media)\n${mediaUrl}\n`);
      return { success: true, data: undefined };
    }

    const token = await getTenantAccessToken(cfg.appId, cfg.appSecret);

    // Fetch or read media bytes
    let fileBuffer: Buffer;
    let fileName = basename(mediaUrl) || "attachment";
    if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
      const res = await fetch(mediaUrl);
      if (!res.ok) {
        console.error(`[Feishu] Failed to fetch media: ${mediaUrl}`);
        return { success: true, data: undefined };
      }
      const arrayBuffer = await res.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      const cd = res.headers.get("content-disposition");
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/);
        if (match) fileName = match[1];
      }
    } else if (existsSync(mediaUrl)) {
      fileBuffer = readFileSync(mediaUrl);
    } else {
      console.error(`[Feishu] Media not found: ${mediaUrl}`);
      return { success: true, data: undefined };
    }

    const ext = extname(fileName).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(ext);

    // Upload to Feishu
    const uploadUrl = isImage
      ? `${FEISHU_API_BASE}/im/v1/images`
      : `${FEISHU_API_BASE}/im/v1/files`;

    const form = new FormData();
    if (isImage) {
      form.append("image_type", "message");
      form.append("image", new Blob([new Uint8Array(fileBuffer)]), fileName);
    } else {
      form.append("file_type", "stream");
      form.append("file_name", fileName);
      form.append("file", new Blob([new Uint8Array(fileBuffer)]), fileName);
    }

    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form as unknown as BodyInit,
    });

    const uploadData = (await uploadRes.json()) as {
      code: number;
      msg: string;
      data?: { image_key?: string; file_key?: string };
    };
    if (uploadData.code !== 0 || !uploadData.data) {
      console.error(`[Feishu] Media upload failed: ${uploadData.msg || JSON.stringify(uploadData)}`);
      return { success: true, data: undefined };
    }

    const key = isImage ? uploadData.data.image_key : uploadData.data.file_key;
    const msgType = isImage ? "image" : "file";
    const content = isImage ? JSON.stringify({ image_key: key }) : JSON.stringify({ file_key: key });

    const sendUrl = opts?.threadId
      ? `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(opts.threadId)}/reply`
      : `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`;

    const body = opts?.threadId
      ? { content, msg_type: msgType }
      : { receive_id: channelId, content, msg_type: msgType };

    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });

    const sendData = (await sendRes.json()) as { code: number; msg: string };
    if (sendData.code !== 0) {
      console.error(`[Feishu] Media message send failed: ${sendData.msg || JSON.stringify(sendData)}`);
    } else {
      console.log(`[Feishu → ${channelId}] ${msgType} sent.`);
    }
    return { success: true, data: undefined };
  }

  async sendRichText(
    channelId: string,
    blocks: NonNullable<ChannelMessage["richText"]>,
    opts?: { threadId?: string }
  ): Promise<{ success: true; data: undefined }> {
    const cfg = getConfig();
    if (!cfg.appId || !cfg.appSecret) {
      console.log(`[Feishu → ${channelId}] (simulated card)\n${blocks.map((b) => b.value).join("\n")}\n`);
      return { success: true, data: undefined };
    }

    const token = await getTenantAccessToken(cfg.appId, cfg.appSecret);
    const markdown = blocks.map((b) => (b.type === "image" ? `![image](${b.value})` : b.value)).join("\n\n");

    const card = {
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "Ouroboros 回复" }, template: "indigo" },
      body: {
        elements: [
          { tag: "markdown", content: markdown.slice(0, 8000) },
        ],
      },
    };

    const url = opts?.threadId
      ? `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(opts.threadId)}/reply`
      : `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`;

    const body = opts?.threadId
      ? { content: JSON.stringify(card), msg_type: "interactive" }
      : { receive_id: channelId, content: JSON.stringify(card), msg_type: "interactive" };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as { code: number; msg: string };
    if (data.code !== 0) {
      console.error(`[Feishu] Card send failed: ${data.msg || JSON.stringify(data)}`);
    } else {
      console.log(`[Feishu → ${channelId}] card sent.`);
    }
    return { success: true, data: undefined };
  }

  async sendReadReceipt(_channelId: string, _messageId: string): Promise<{ success: true; data: undefined }> {
    // Feishu read receipt API requires special permissions; left as no-op for now
    return { success: true, data: undefined };
  }

  // ---------------------------------------------------------------------------
  // Webhook Handler
  // ---------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const cfg = getConfig();
    if (req.url !== cfg.path || req.method !== "POST") {
      respond(res, 404, { error: "not found" });
      return;
    }

    const body = await readBody(req);

    // Signature verification (HMAC-SHA256)
    const signature = req.headers["x-lark-signature"] as string | undefined;
    const timestampHeader = req.headers["x-lark-request-timestamp"] as string | undefined;
    const nonce = req.headers["x-lark-request-nonce"] as string | undefined;
    if (cfg.encryptKey && signature && timestampHeader && nonce) {
      if (!verifyFeishuSignature(body, signature, timestampHeader, nonce, cfg.encryptKey)) {
        respond(res, 403, { error: "signature verification failed" });
        return;
      }
    }

    let payload: FeishuWebhookPayload;
    try {
      if (cfg.encryptKey) {
        // Decrypt AES-256-CBC body when encrypt key is configured
        const decrypted = decryptFeishuBody(cfg.encryptKey, body);
        payload = decrypted as FeishuWebhookPayload;
      } else {
        payload = JSON.parse(body);
      }
    } catch {
      respond(res, 400, { error: "invalid payload" });
      return;
    }

    // Timestamp freshness check (replay protection)
    const timestamp = payload.header?.create_time || payload.ts;
    if (timestamp && !isFreshTimestamp(timestamp)) {
      respond(res, 403, { error: "timestamp expired" });
      return;
    }

    // Plain-text token verification (simplest mode)
    const eventToken = payload.token || payload.header?.token;
    if (cfg.verificationToken && eventToken !== cfg.verificationToken) {
      respond(res, 403, { error: "verification token mismatch" });
      return;
    }

    // URL verification challenge
    if (payload.type === "url_verification" && payload.challenge) {
      respond(res, 200, { challenge: payload.challenge });
      return;
    }

    // Event ack (schema 2.0)
    respond(res, 200, { code: 0, msg: "ok" });

    // Process IM message events asynchronously
    const eventType = payload.header?.event_type;
    if (eventType === "im.message.receive_v1") {
      void this.processMessageEvent(payload);
    }
  }

  private async processMessageEvent(payload: FeishuWebhookPayload) {
    const msg = payload.event?.message;
    const sender = payload.event?.sender;
    if (!msg) return;

    const senderId = sender?.sender_id?.open_id || "unknown";
    if (!(await this.checkSenderRateLimit(senderId))) {
      console.warn(`[Feishu] Rate limit exceeded for sender ${senderId}`);
      return;
    }

    let text = "";
    let imageUrlOrKey = "";
    let fileKey = "";
    try {
      const parsed = JSON.parse(msg.content) as { text?: string; image_key?: string; file_key?: string; image_url?: string };
      text = parsed.text || "";
      imageUrlOrKey = parsed.image_url || parsed.image_key || "";
      fileKey = parsed.file_key || "";
    } catch {
      text = msg.content;
    }

    const channelMsg: ChannelMessage = {
      id: msg.message_id,
      channelId: msg.chat_id,
      threadId: msg.message_id,
      senderId: sender?.sender_id?.open_id || "unknown",
      senderName: sender?.sender_type || "unknown",
      text,
      timestamp: msg.create_time ? parseInt(msg.create_time, 10) : Date.now(),
      mentionsBot: text.includes("@_user_1") || text.includes("/ouroboros"),
      isGroup: msg.chat_type === "group",
    };

    // Attempt to parse rich text (post/image/file content types)
    if (msg.message_type === "post") {
      channelMsg.richText = [{ type: "text", value: text }];
    } else if (msg.message_type === "image" && imageUrlOrKey) {
      channelMsg.richText = [{ type: "image", value: imageUrlOrKey }];
    } else if (msg.message_type === "file" && fileKey) {
      channelMsg.richText = [{ type: "file", value: fileKey }];
    }

    this.emitMessage(channelMsg);
  }
}

// =============================================================================
// Plugin Export
// =============================================================================

const feishuBot = new FeishuBot();

export function simulateFeishuMessage(
  text: string,
  chatId = "demo_chat_1",
  senderId = "demo_user_1"
): void {
  feishuBot["emitMessage"]({
    id: `demo_msg_${Date.now()}`,
    channelId: chatId,
    threadId: `demo_msg_${Date.now()}`,
    senderId,
    senderName: "Demo User",
    text,
    timestamp: Date.now(),
    mentionsBot: text.includes("@_user_1") || text.includes("/ouroboros"),
    isGroup: false,
  });
}

export const feishuPlugin: ChannelPlugin & { start(): void; stop(): void; isRunning(): boolean } = {
  id: "feishu",
  meta: {
    selectionLabel: "Feishu (飞书)",
    blurb: "Enterprise IM integration for Feishu/Lark via webhook events and Open API.",
    aliases: ["lark", "feishu-bot"],
  },
  inbound: feishuBot,
  outbound: feishuBot,
  start: () => feishuBot.start(),
  stop: () => feishuBot.stop(),
  isRunning: () => feishuBot.isRunning(),
  async getMembers(_channelId: string) {
    return { success: true, data: [{ id: "bot", name: "Ouroboros Bot" }] as ChannelMember[] };
  },
  async getChannelInfo(channelId: string) {
    return { success: true, data: { name: channelId, memberCount: 1 } };
  },
};
