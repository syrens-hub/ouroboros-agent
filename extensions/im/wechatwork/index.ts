/**
 * WeChat Work IM Extension
 * =========================
 * A ChannelPlugin implementation for WeChat Work via webhook.
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
    webhookUrl: process.env.WECHATWORK_WEBHOOK_URL || "",
    webhookToken: process.env.WECHATWORK_WEBHOOK_TOKEN || "",
    webhookPort: parseInt(process.env.WECHATWORK_WEBHOOK_PORT || "3200", 10),
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

interface WeChatWorkWebhookPayload {
  ToUserName?: string;
  FromUserName?: string;
  CreateTime?: string;
  MsgType?: string;
  Content?: string;
  MsgId?: string;
  AgentID?: string;
}

class WeChatWorkBot implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private handlers: MessageHandler[] = [];
  private server: ReturnType<typeof createServer> | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    const cfg = getConfig();
    if (!cfg.webhookUrl && !cfg.webhookToken) {
      console.warn("[WeChatWork] Missing WECHATWORK_WEBHOOK_URL or WECHATWORK_WEBHOOK_TOKEN. Plugin will simulate events only.");
    }
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(cfg.webhookPort, () => {
      console.log(`[WeChatWork] Webhook server listening on http://0.0.0.0:${cfg.webhookPort}/wechatwork/webhook`);
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
        console.error("[WeChatWork] Handler error:", e);
      }
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const cfg = getConfig();
    if (req.url !== "/wechatwork/webhook" || req.method !== "POST") {
      respond(res, 404, { error: "not found" });
      return;
    }

    const body = await readBody(req);

    // Simple token verification
    if (cfg.webhookToken) {
      const urlToken = new URL(req.url || "/", `http://localhost`).searchParams.get("token");
      if (urlToken !== cfg.webhookToken) {
        respond(res, 403, { error: "token mismatch" });
        return;
      }
    }

    let payload: WeChatWorkWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      respond(res, 400, { error: "invalid payload" });
      return;
    }

    respond(res, 200, { errcode: 0, errmsg: "ok" });

    if (payload.MsgType === "text" && payload.Content) {
      this.emitMessage({
        id: payload.MsgId || `wechatwork_${Date.now()}`,
        channelId: payload.AgentID || "wechatwork_default",
        threadId: undefined,
        senderId: payload.FromUserName || "unknown",
        senderName: payload.FromUserName || "unknown",
        text: payload.Content,
        timestamp: payload.CreateTime ? parseInt(payload.CreateTime, 10) * 1000 : Date.now(),
        mentionsBot: payload.Content.includes("@机器人") || payload.Content.includes("/ouroboros"),
        isGroup: false,
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
    if (!cfg.webhookUrl) {
      console.log(`[WeChatWork → ${channelId}] (simulated)\n${text}\n`);
      return ok(undefined);
    }
    try {
      const body: Record<string, unknown> = {
        msgtype: "text",
        text: { content: text },
      };
      if (opts?.mentionUsers?.length) {
        body.mentioned_list = opts.mentionUsers;
      }
      const response = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { errcode?: number; errmsg?: string };
      if (data.errcode && data.errcode !== 0) {
        return err({ code: "WECHATWORK_API_ERROR", message: data.errmsg || "Unknown error" });
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

const wechatWorkBot = new WeChatWorkBot();

export const wechatworkPlugin: ChannelPlugin & { start(): void; stop(): void } = {
  id: "wechatwork",
  meta: {
    selectionLabel: "WeChat Work (企业微信)",
    blurb: "WeChat Work integration via webhook callbacks.",
    aliases: ["wechat-work", "wecom"],
  },
  inbound: wechatWorkBot,
  outbound: wechatWorkBot,
  start: () => wechatWorkBot.start(),
  stop: () => wechatWorkBot.stop(),
  getMembers: (channelId) => wechatWorkBot.getMembers(channelId),
  getChannelInfo: (channelId) => wechatWorkBot.getChannelInfo(channelId),
};
