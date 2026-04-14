/**
 * DingTalk IM Extension
 * ======================
 * A ChannelPlugin implementation for DingTalk via HTTP webhook.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type {
  ChannelMessage,
  ChannelInboundAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelMember,
} from "../../../types/index.ts";
import { ok, err, type Result } from "../../../types/index.ts";

type MessageHandler = (msg: ChannelMessage) => void;

function getConfig() {
  return {
    appKey: process.env.DINGTALK_APP_KEY || "",
    appSecret: process.env.DINGTALK_APP_SECRET || "",
    port: parseInt(process.env.DINGTALK_WEBHOOK_PORT || "3100", 10),
    path: process.env.DINGTALK_WEBHOOK_PATH || "/dingtalk/webhook",
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function respond(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

interface DingTalkWebhookPayload {
  msgtype?: string;
  text?: { content?: string };
  senderStaffId?: string;
  senderNick?: string;
  conversationTitle?: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  // Incoming robot callback
  conversationType?: "1" | "2"; // 1 = single, 2 = group
  content?: { text?: string };
  sender?: {
    staffId?: string;
    nick?: string;
  };
}

class DingTalkBot implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private handlers: MessageHandler[] = [];
  private server: ReturnType<typeof createServer> | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    const cfg = getConfig();
    if (!cfg.appKey || !cfg.appSecret) {
      console.warn("[DingTalk] Missing DINGTALK_APP_KEY or DINGTALK_APP_SECRET. Plugin will simulate events only.");
    }
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(cfg.port, () => {
      console.log(`[DingTalk] Webhook server listening on http://0.0.0.0:${cfg.port}${cfg.path}`);
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
        console.error("[DingTalk] Handler error:", e);
      }
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const cfg = getConfig();
    if (req.url !== cfg.path || req.method !== "POST") {
      respond(res, 404, { error: "not found" });
      return;
    }

    const body = await readBody(req);
    let payload: DingTalkWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      respond(res, 400, { error: "invalid payload" });
      return;
    }

    respond(res, 200, { code: 0, msg: "ok" });

    const text = payload.text?.content || payload.content?.text || "";
    const senderId = payload.senderStaffId || payload.sender?.staffId || "unknown";
    const senderName = payload.senderNick || payload.sender?.nick || "unknown";

    if (text) {
      this.emitMessage({
        id: `dingtalk_${Date.now()}`,
        channelId: payload.conversationTitle || "dingtalk_default",
        threadId: undefined,
        senderId,
        senderName,
        text,
        timestamp: Date.now(),
        mentionsBot: text.includes("@机器人") || text.includes("/ouroboros"),
        isGroup: payload.conversationType === "2",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async sendText(
    channelId: string,
    text: string,
    opts?: { threadId?: string; mentionUsers?: string[] }
  ): Promise<Result<unknown>> {
    const cfg = getConfig();
    if (!cfg.appKey || !cfg.appSecret) {
      console.log(`[DingTalk → ${channelId}] (simulated)\n${text}\n`);
      return ok(undefined);
    }
    // Webhook outgoing simulation
    const body = {
      msgtype: "text",
      text: { content: text },
      at: opts?.mentionUsers?.length ? { atUserIds: opts.mentionUsers } : undefined,
    };
    try {
      const webhookUrl = `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(channelId)}`;
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { errcode?: number; errmsg?: string };
      if (data.errcode && data.errcode !== 0) {
        return err({ code: "DINGTALK_API_ERROR", message: data.errmsg || "Unknown error" });
      }
      return ok(undefined);
    } catch (e) {
      return err({ code: "NETWORK_ERROR", message: String(e) });
    }
  }

  async sendRichText(
    channelId: string,
    blocks: NonNullable<ChannelMessage["richText"]>,
    opts?: { threadId?: string }
  ): Promise<Result<unknown>> {
    const text = blocks.map((b) => b.text || b.value || "").join("\n");
    return this.sendText(channelId, text, opts);
  }

  async sendReadReceipt(_channelId: string, _messageId: string): Promise<Result<unknown>> {
    return ok(undefined);
  }

  async getMembers(_channelId: string): Promise<Result<ChannelMember[]>> {
    return ok([{ id: "bot", name: "Ouroboros Bot" }] as ChannelMember[]);
  }

  async getChannelInfo(channelId: string): Promise<Result<{ name: string; memberCount: number }>> {
    return ok({ name: channelId, memberCount: 1 });
  }
}

const dingTalkBot = new DingTalkBot();

export const dingtalkPlugin: ChannelPlugin & { start(): void; stop(): void } = {
  id: "dingtalk",
  meta: {
    selectionLabel: "DingTalk (钉钉)",
    blurb: "DingTalk integration via incoming/outgoing webhooks.",
    aliases: ["dingtalk-bot"],
  },
  inbound: dingTalkBot,
  outbound: dingTalkBot,
  start: () => dingTalkBot.start(),
  stop: () => dingTalkBot.stop(),
  getMembers: (channelId) => dingTalkBot.getMembers(channelId),
  getChannelInfo: (channelId) => dingTalkBot.getChannelInfo(channelId),
};
