/**
 * Slack IM Extension
 * ===================
 * A ChannelPlugin implementation for Slack via @slack/web-api.
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

// Runtime type for the mocked/optional WebClient
interface WebClientLike {
  chat: {
    postMessage: (args: { channel: string; text: string; thread_ts?: string }) => Promise<unknown>;
  };
  conversations: {
    members: (args: { channel: string }) => Promise<{ ok: boolean; members?: string[]; error?: string }>;
    info: (args: { channel: string }) => Promise<{ ok: boolean; channel?: { name?: string; num_members?: number }; error?: string }>;
  };
}

class SlackBot implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private handlers: MessageHandler[] = [];
  private client: WebClientLike | null = null;
  private started = false;
  private botToken: string | null = null;

  start(): void {
    if (this.started) return;
    this.botToken = process.env.SLACK_BOT_TOKEN || null;
    if (!this.botToken) {
      console.warn("[Slack] Missing SLACK_BOT_TOKEN. Plugin will simulate events only.");
    }
    this.started = true;
  }

  stop(): void {
    this.started = false;
    this.client = null;
    this.botToken = null;
  }

  setClient(client: WebClientLike): void {
    this.client = client;
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
        console.error("[Slack] Handler error:", e);
      }
    }
  }

  simulateMessage(text: string, channelId = "C0000000000", senderId = "U0000000000", senderName = "Test User"): void {
    this.emitMessage({
      id: `slack_msg_${Date.now()}`,
      channelId,
      threadId: undefined,
      senderId,
      senderName,
      text,
      timestamp: Date.now(),
      mentionsBot: text.includes("@bot") || text.includes("/ouroboros"),
      isGroup: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async sendText(
    channelId: string,
    text: string,
    opts?: { threadId?: string; mentionUsers?: string[] }
  ): Promise<Result<unknown>> {
    if (!this.started) {
      return err({ code: "NOT_STARTED", message: "Slack adapter not started" });
    }
    if (!this.botToken || !this.client) {
      console.log(`[Slack → ${channelId}] (simulated)\n${text}\n`);
      return ok(undefined);
    }
    try {
      await this.client.chat.postMessage({
        channel: channelId,
        text,
        thread_ts: opts?.threadId,
      });
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async getMembers(channelId: string): Promise<Result<ChannelMember[]>> {
    if (!this.client) {
      return ok([{ id: "bot", name: "Ouroboros Bot" }] as ChannelMember[]);
    }
    const res = await this.client.conversations.members({ channel: channelId });
    if (!res.ok) {
      return err({ code: "SLACK_API_ERROR", message: res.error || "Unknown error" });
    }
    const members = (res.members || []).map((id) => ({ id, name: id }));
    return ok(members);
  }

  async getChannelInfo(channelId: string): Promise<Result<{ name: string; memberCount: number }>> {
    if (!this.client) {
      return ok({ name: channelId, memberCount: 1 });
    }
    const res = await this.client.conversations.info({ channel: channelId });
    if (!res.ok) {
      return err({ code: "SLACK_API_ERROR", message: res.error || "Unknown error" });
    }
    return ok({
      name: res.channel?.name || channelId,
      memberCount: res.channel?.num_members || 0,
    });
  }
}

const slackBot = new SlackBot();

export const slackPlugin: ChannelPlugin & { start(): void; stop(): void; setClient(client: WebClientLike): void; simulateMessage(text: string, channelId?: string, senderId?: string, senderName?: string): void } = {
  id: "slack",
  meta: {
    selectionLabel: "Slack",
    blurb: "Slack workspace integration via Web API.",
    aliases: ["slack-bot"],
  },
  inbound: slackBot,
  outbound: slackBot,
  start: () => slackBot.start(),
  stop: () => slackBot.stop(),
  setClient: (client) => slackBot.setClient(client),
  simulateMessage: (text, channelId, senderId, senderName) => slackBot.simulateMessage(text, channelId, senderId, senderName),
  getMembers: (channelId) => slackBot.getMembers(channelId),
  getChannelInfo: (channelId) => slackBot.getChannelInfo(channelId),
};
