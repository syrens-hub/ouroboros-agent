/**
 * WhatsApp IM Extension
 * ======================
 * An experimental ChannelPlugin implementation for WhatsApp via whatsapp-web.js.
 */

import type {
  ChannelMessage,
  ChannelInboundAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelMember,
} from "../../../types/index.ts";
import { ok, err, type Result } from "../../../types/index.ts";

type MessageHandler = (msg: ChannelMessage) => void;

let ClientClass: unknown | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wwjs = require("whatsapp-web.js");
  ClientClass = wwjs.Client;
} catch {
  ClientClass = null;
}

class WhatsAppBot implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private handlers: MessageHandler[] = [];
  private client: unknown | null = null;
  private started = false;
  private ready = false;

  start(): void {
    if (this.started) return;
    if (process.env.WHATSAPP_EXPERIMENTAL !== "1") {
      console.log("[WhatsApp] Experimental mode not enabled. Set WHATSAPP_EXPERIMENTAL=1 to activate.");
      return;
    }
    if (!ClientClass) {
      console.warn("[WhatsApp] whatsapp-web.js is not installed. Install it to use the WhatsApp plugin.");
      return;
    }
    this.client = new (ClientClass as new () => unknown)();
    this.setupListeners();
    this.started = true;
  }

  stop(): void {
    this.started = false;
    this.ready = false;
    if (this.client && typeof (this.client as { destroy?: () => void }).destroy === "function") {
      (this.client as { destroy: () => void }).destroy();
    }
    this.client = null;
  }

  private setupListeners(): void {
    if (!this.client) return;
    const client = this.client as {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      initialize?: () => Promise<void>;
    };
    if (typeof client.on === "function") {
      client.on("ready", () => {
        this.ready = true;
        console.log("[WhatsApp] Client is ready");
      });
      client.on("message_create", (data: unknown) => {
        this.handleIncoming(data);
      });
      client.on("disconnected", () => {
        this.ready = false;
        console.log("[WhatsApp] Client disconnected");
      });
    }
    if (typeof client.initialize === "function") {
      void client.initialize();
    }
  }

  private handleIncoming(data: unknown): void {
    const msg = data as {
      id?: { _serialized?: string };
      from?: string;
      body?: string;
      timestamp?: number;
      fromMe?: boolean;
      hasMedia?: boolean;
      deviceType?: string;
    } | null;
    if (!msg || msg.fromMe) return;

    const channelMsg: ChannelMessage = {
      id: msg.id?._serialized || `whatsapp_${Date.now()}`,
      channelId: msg.from || "unknown",
      threadId: undefined,
      senderId: msg.from || "unknown",
      senderName: msg.from || "unknown",
      text: msg.body || "",
      timestamp: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
      mentionsBot: (msg.body || "").includes("@bot") || (msg.body || "").includes("/ouroboros"),
      isGroup: msg.from?.endsWith("@g.us") || false,
    };

    for (const h of this.handlers) {
      try {
        h(channelMsg);
      } catch (e) {
        console.error("[WhatsApp] Handler error:", e);
      }
    }
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

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async sendText(
    channelId: string,
    text: string,
    opts?: { threadId?: string; mentionUsers?: string[] }
  ): Promise<Result<unknown>> {
    if (process.env.WHATSAPP_EXPERIMENTAL !== "1") {
      return err({ code: "NOT_ENABLED", message: "WhatsApp experimental mode not enabled" });
    }
    if (!this.client || !this.ready) {
      console.log(`[WhatsApp → ${channelId}] (simulated)\n${text}\n`);
      return ok(undefined);
    }
    try {
      const client = this.client as {
        sendMessage?: (to: string, content: string, options?: { quotedMessageId?: string }) => Promise<unknown>;
      };
      if (typeof client.sendMessage === "function") {
        await client.sendMessage(channelId, text, { quotedMessageId: opts?.threadId });
      }
      return ok(undefined);
    } catch (e) {
      return err({ code: "SEND_FAILED", message: String(e) });
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

const whatsAppBot = new WhatsAppBot();

export const whatsappPlugin: ChannelPlugin & { start(): void; stop(): void } = {
  id: "whatsapp",
  meta: {
    selectionLabel: "WhatsApp (Experimental)",
    blurb: "WhatsApp integration via whatsapp-web.js (experimental).",
    aliases: ["wa", "whatsapp-bot"],
  },
  inbound: whatsAppBot,
  outbound: whatsAppBot,
  start: () => whatsAppBot.start(),
  stop: () => whatsAppBot.stop(),
  getMembers: (channelId) => whatsAppBot.getMembers(channelId),
  getChannelInfo: (channelId) => whatsAppBot.getChannelInfo(channelId),
};
