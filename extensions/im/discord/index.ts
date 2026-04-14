/**
 * Discord IM Extension
 * =====================
 * A ChannelPlugin implementation for Discord via Gateway and REST API.
 */

import WebSocket from "ws";
import type {
  ChannelMessage,
  ChannelInboundAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelMember,
} from "../../../types/index.ts";
import { ok, err, type Result } from "../../../types/index.ts";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

// Minimal intents: GUILDS + GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT
const DEFAULT_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);

type MessageHandler = (msg: ChannelMessage) => void;

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  };
  mentions: { id: string; username: string; bot?: boolean }[];
  message_reference?: { message_id?: string } | null;
  thread?: { id: string } | null;
}

class DiscordAdapter implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private handlers: MessageHandler[] = [];
  private ws: WebSocket | null = null;
  private botToken: string | null = null;
  private botUserId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private started = false;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(botToken: string): void {
    if (this.started) return;
    this.botToken = botToken;
    this.connect();
    this.started = true;
  }

  stop(): void {
    this.started = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.botToken = null;
    this.botUserId = null;
    this.lastSequence = null;
  }

  private connect(): void {
    if (!this.botToken) return;
    this.ws = new WebSocket(DISCORD_GATEWAY_URL);

    this.ws.on("open", () => {
      // Wait for Hello (op 10) before IDENTIFY
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      const payload = JSON.parse(data.toString()) as {
        op: number;
        d?: unknown;
        s?: number | null;
        t?: string | null;
      };

      if (payload.s !== undefined && payload.s !== null) {
        this.lastSequence = payload.s;
      }

      switch (payload.op) {
        case 10: {
          // Hello
          const hello = payload.d as { heartbeat_interval: number };
          this.startHeartbeat(hello.heartbeat_interval);
          this.identify();
          break;
        }
        case 11: {
          // Heartbeat ACK
          break;
        }
        case 0: {
          // Dispatch
          if (payload.t === "READY") {
            const ready = payload.d as { user: { id: string } };
            this.botUserId = ready.user.id;
          } else if (payload.t === "MESSAGE_CREATE") {
            this.handleMessageCreate(payload.d as DiscordMessage);
          }
          break;
        }
        case 1: {
          // Heartbeat request
          this.sendHeartbeat();
          break;
        }
        case 9: {
          // Invalid session
          console.error("[Discord] Invalid session");
          this.ws?.close();
          break;
        }
      }
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      console.log(`[Discord] Gateway closed: ${code} ${reason.toString()}`);
      this.cleanupConnection();
      // Simple reconnect if still started
      if (this.started) {
        setTimeout(() => this.connect(), 5000);
      }
    });

    this.ws.on("error", (error: Error) => {
      console.error("[Discord] Gateway error:", error);
    });
  }

  private cleanupConnection(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.ws = null;
  }

  private identify(): void {
    if (!this.ws || !this.botToken) return;
    this.ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: this.botToken,
          intents: DEFAULT_INTENTS,
          properties: {
            os: "linux",
            browser: "ouroboros-agent",
            device: "ouroboros-agent",
          },
        },
      })
    );
  }

  private startHeartbeat(intervalMs: number): void {
    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ op: 1, d: this.lastSequence }));
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
        console.error("[Discord] Handler error:", e);
      }
    }
  }

  private handleMessageCreate(d: DiscordMessage): void {
    // Ignore own messages
    if (d.author.id === this.botUserId) return;

    const text = d.content.trim();
    const mentionsBot =
      text.startsWith("/") ||
      d.mentions.some((m) => m.id === this.botUserId);

    const channelMsg: ChannelMessage = {
      id: d.id,
      channelId: d.channel_id,
      threadId: d.message_reference?.message_id ?? undefined,
      senderId: d.author.id,
      senderName: d.author.global_name ?? d.author.username,
      text,
      timestamp: new Date(d.timestamp).getTime(),
      mentionsBot,
      isGroup: !!d.guild_id,
    };

    this.emitMessage(channelMsg);
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async sendText(
    channelId: string,
    text: string,
    opts?: { threadId?: string; mentionUsers?: string[] }
  ): Promise<Result<unknown>> {
    if (!this.botToken) {
      return err({ code: "NOT_STARTED", message: "Discord adapter not started" });
    }

    let content = text;
    if (opts?.mentionUsers?.length) {
      const mentions = opts.mentionUsers.map((id) => `<@${id}>`).join(" ");
      content = `${mentions} ${content}`;
    }

    const body: Record<string, unknown> = { content };
    if (opts?.threadId) {
      body.message_reference = {
        message_id: opts.threadId,
        channel_id: channelId,
      };
    }

    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      return err({ code: `DISCORD_API_${res.status}`, message: errorText });
    }

    const data = await res.json().catch(() => undefined);
    return ok(data);
  }

  async sendRichText(
    channelId: string,
    blocks: NonNullable<ChannelMessage["richText"]>,
    opts?: { threadId?: string }
  ): Promise<Result<unknown>> {
    // Fallback to plain text by concatenating blocks
    const text = blocks
      .map((b) => b.text ?? b.value ?? "")
      .filter(Boolean)
      .join("\n");
    return this.sendText(channelId, text, opts);
  }

  async sendReadReceipt(_channelId: string, _messageId: string): Promise<Result<unknown>> {
    // No-op: Discord has no explicit read receipt API for bots
    return ok(undefined);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async getMembers(channelId: string): Promise<Result<ChannelMember[]>> {
    if (!this.botToken) {
      return err({ code: "NOT_STARTED", message: "Discord adapter not started" });
    }

    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}`, {
      headers: { Authorization: `Bot ${this.botToken}` },
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      return err({ code: `DISCORD_API_${res.status}`, message: errorText });
    }

    const data = (await res.json()) as {
      recipients?: { id: string; username: string; global_name?: string | null }[];
    };

    const members: ChannelMember[] =
      data.recipients?.map((r) => ({
        id: r.id,
        name: r.global_name ?? r.username,
      })) ?? [];

    return ok(members);
  }

  async getChannelInfo(channelId: string): Promise<Result<{ name: string; memberCount: number }>> {
    if (!this.botToken) {
      return err({ code: "NOT_STARTED", message: "Discord adapter not started" });
    }

    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}`, {
      headers: { Authorization: `Bot ${this.botToken}` },
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      return err({ code: `DISCORD_API_${res.status}`, message: errorText });
    }

    const data = (await res.json()) as {
      name?: string;
      recipients?: unknown[];
    };

    return ok({
      name: data.name ?? channelId,
      memberCount: data.recipients?.length ?? 0,
    });
  }
}

// =============================================================================
// Plugin Export
// =============================================================================

const discordAdapter = new DiscordAdapter();

export const discordPlugin: ChannelPlugin & { start(botToken: string): void; stop(): void } = {
  id: "discord",
  meta: {
    selectionLabel: "Discord",
    blurb: "Discord bot integration via Gateway and REST API.",
    aliases: ["discord-bot"],
  },
  inbound: discordAdapter,
  outbound: discordAdapter,
  start: (botToken: string) => discordAdapter.start(botToken),
  stop: () => discordAdapter.stop(),
  getMembers: (channelId: string) => discordAdapter.getMembers(channelId),
  getChannelInfo: (channelId: string) => discordAdapter.getChannelInfo(channelId),
};
