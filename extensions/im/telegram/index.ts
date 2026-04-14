/**
 * Telegram IM Extension
 * ======================
 * A minimal ChannelPlugin implementation for Telegram via Bot API long-polling.
 */

import type {
  ChannelMessage,
  ChannelInboundAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelMember,
} from "../../../types/index.ts";
import { ok, err } from "../../../types/index.ts";
import type { Result } from "../../../types/index.ts";

// =============================================================================
// Types
// =============================================================================

type MessageHandler = (msg: ChannelMessage) => void;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: "private" | "group" | "supergroup" | "channel";
      title?: string;
    };
    date: number;
    text?: string;
    reply_to_message?: { message_id: number };
  };
}

// =============================================================================
// Telegram Adapter
// =============================================================================

class TelegramAdapter implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private handlers: MessageHandler[] = [];
  private botToken: string | null = null;
  private botUsername: string | null = null;
  private polling = false;
  private abortController: AbortController | null = null;
  private offset = 0;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  startPolling(botToken: string): void {
    if (this.polling) return;
    this.botToken = botToken;
    this.polling = true;
    this.abortController = new AbortController();
    void this.initBotInfo().then(() => {
      if (this.polling) {
        void this.pollLoop();
      }
    });
  }

  stopPolling(): void {
    this.polling = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
    this.botToken = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle helpers
  // ---------------------------------------------------------------------------

  private async initBotInfo(): Promise<void> {
    if (!this.botToken) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`, {
        signal: this.abortController?.signal,
      });
      const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
      if (data.ok && data.result?.username) {
        this.botUsername = data.result.username.toLowerCase();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("[Telegram] Failed to get bot info:", e);
      }
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.polling && this.botToken) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.offset}&limit=100&timeout=30`,
          { signal: this.abortController?.signal }
        );
        if (!this.polling) break;

        const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
        if (data.ok && data.result) {
          for (const update of data.result) {
            this.offset = update.update_id + 1;
            this.processUpdate(update);
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
        console.error("[Telegram] Polling error:", e);
        await this.sleep(5000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.polling) {
        resolve();
        return;
      }
      this.pollTimeoutId = setTimeout(() => {
        this.pollTimeoutId = null;
        resolve();
      }, ms);
    });
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

  private processUpdate(update: TelegramUpdate): void {
    const msg = update.message;
    if (!msg || typeof msg.text !== "string") return;

    const text = msg.text;
    const chat = msg.chat;
    const from = msg.from;

    let mentionsBot = false;
    if (text.startsWith("/")) {
      mentionsBot = true;
    } else if (this.botUsername && text.toLowerCase().includes(`@${this.botUsername}`)) {
      mentionsBot = true;
    }

    const channelMsg: ChannelMessage = {
      id: String(msg.message_id),
      channelId: String(chat.id),
      threadId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      senderId: from ? String(from.id) : "unknown",
      senderName: from?.first_name || from?.username || "Unknown",
      text,
      timestamp: msg.date * 1000,
      mentionsBot,
      isGroup: chat.type === "group" || chat.type === "supergroup" || chat.type === "channel",
    };

    for (const h of this.handlers) {
      try {
        h(channelMsg);
      } catch (e) {
        console.error("[Telegram] Handler error:", e);
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
  ): Promise<Result<unknown>> {
    if (!this.botToken) {
      return err({ code: "NOT_STARTED", message: "Polling not started" });
    }

    const body: Record<string, unknown> = {
      chat_id: channelId,
      text,
    };
    if (opts?.threadId) {
      body.reply_to_message_id = opts.threadId;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        return err({ code: "SEND_FAILED", message: data.description || "sendMessage failed" });
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
}

// =============================================================================
// Plugin Export
// =============================================================================

const telegramAdapter = new TelegramAdapter();

export const telegramPlugin: ChannelPlugin & {
  startPolling(botToken: string): void;
  stopPolling(): void;
} = {
  id: "telegram",
  meta: {
    selectionLabel: "Telegram",
    blurb: "IM integration for Telegram via Bot API long-polling.",
    aliases: ["tg", "telegram-bot"],
  },
  inbound: telegramAdapter,
  outbound: telegramAdapter,
  startPolling: (botToken: string) => telegramAdapter.startPolling(botToken),
  stopPolling: () => telegramAdapter.stopPolling(),
  async getMembers(_channelId: string) {
    return ok([{ id: "unknown", name: "Member list unavailable" }] as ChannelMember[]);
  },
  async getChannelInfo(channelId: string) {
    return ok({ name: `Chat ${channelId}`, memberCount: 0 });
  },
};
