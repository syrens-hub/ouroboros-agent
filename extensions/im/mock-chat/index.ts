/**
 * Ouroboros Mock Chat IM Extension
 * =================================
 * A minimal ChannelPlugin implementation demonstrating the OpenClaw-style
 * nervous system integration. This simulates an IM channel without requiring
 * real API credentials.
 */

import { EventEmitter } from "events";
import type {
  ChannelMessage,
  ChannelInboundAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelMember,
} from "../../../types/index.ts";

// =============================================================================
// Mock Chat Adapter
// =============================================================================

class MockChatAdapter extends EventEmitter implements ChannelInboundAdapter, ChannelOutboundAdapter {
  private messageId = 0;

  // Inbound: simulate receiving a message from the IM platform
  injectMessage(text: string, senderId = "user_1", senderName = "Mock User"): void {
    this.messageId++;
    const msg: ChannelMessage = {
      id: `mock_msg_${this.messageId}`,
      channelId: "mock_channel_default",
      threadId: "mock_thread_default",
      senderId,
      senderName,
      text,
      timestamp: Date.now(),
      mentionsBot: text.includes("@ouroboros") || text.includes("/"),
      isGroup: false,
    };
    this.emit("message", msg);
  }

  onMessage(handler: (msg: ChannelMessage) => void): () => void {
    this.on("message", handler);
    return () => {
      this.off("message", handler);
    };
  }

  async sendText(
    channelId: string,
    text: string,
    opts?: { threadId?: string; mentionUsers?: string[] }
  ): Promise<{ success: true; data: undefined }> {
    const prefix = `[MockChat → ${channelId}]`;
    const thread = opts?.threadId ? ` (thread: ${opts.threadId})` : "";
    const mentions = opts?.mentionUsers?.length ? ` [mentions: ${opts.mentionUsers.join(", ")}]` : "";
    console.log(`${prefix}${thread}${mentions}\n${text}\n`);
    return { success: true, data: undefined };
  }

  async sendMedia(): Promise<{ success: true; data: undefined }> {
    console.log("[MockChat] Media sending not implemented in mock adapter.");
    return { success: true, data: undefined };
  }

  async sendRichText(
    channelId: string,
    blocks: NonNullable<ChannelMessage["richText"]>,
    opts?: { threadId?: string }
  ): Promise<{ success: true; data: undefined }> {
    console.log(`[MockChat → ${channelId}] Rich text with ${blocks.length} blocks${opts?.threadId ? ` (thread: ${opts.threadId})` : ""}`);
    return { success: true, data: undefined };
  }

  async sendReadReceipt(channelId: string, messageId: string): Promise<{ success: true; data: undefined }> {
    console.log(`[MockChat → ${channelId}] Read receipt for ${messageId}`);
    return { success: true, data: undefined };
  }

  onReadReceipt(handler: (channelId: string, messageId: string, readerId: string) => void): () => void {
    this.on("read_receipt", handler);
    return () => {
      this.off("read_receipt", handler);
    };
  }
}

// =============================================================================
// Plugin Factory
// =============================================================================

const mockAdapter = new MockChatAdapter();

export const mockChatPlugin: ChannelPlugin = {
  id: "mock-chat",
  meta: {
    selectionLabel: "Mock Chat (模拟聊天)",
    blurb: "A local mock IM channel for testing the Ouroboros nervous system.",
    aliases: ["mock", "test-chat"],
  },
  inbound: mockAdapter,
  outbound: mockAdapter,
  async getMembers(_channelId: string) {
    return { success: true, data: [{ id: "user_1", name: "Mock User" }] as ChannelMember[] };
  },
  async getChannelInfo(channelId: string) {
    return { success: true, data: { name: channelId, memberCount: 2 } };
  },
};

// Expose injector for demos/scripts
export function injectMockMessage(text: string, senderId?: string, senderName?: string): void {
  mockAdapter.injectMessage(text, senderId, senderName);
}

export { mockAdapter };
