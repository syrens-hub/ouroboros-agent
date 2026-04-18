import type { Result } from "./core.ts";

// ============================================================================
// IM Channel Types
// ============================================================================

export interface ChannelMessage {
  id: string;
  channelId: string;
  threadId?: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: number;
  mentionsBot?: boolean;
  isGroup?: boolean;
  richText?: { type: string; text?: string; value?: string }[];
}

export interface ChannelMember {
  id: string;
  name: string;
}

export interface ChannelInboundAdapter {
  onMessage(handler: (msg: ChannelMessage) => void): () => void;
  onReadReceipt?(handler: (channelId: string, messageId: string, readerId: string) => void): () => void;
}

export interface ChannelOutboundAdapter {
  sendText(channelId: string, text: string, opts?: { threadId?: string; mentionUsers?: string[] }): Promise<Result<unknown>>;
  sendMedia?(channelId: string, mediaUrl: string, opts?: { threadId?: string }): Promise<Result<unknown>>;
  sendRichText(channelId: string, blocks: NonNullable<ChannelMessage["richText"]>, opts?: { threadId?: string }): Promise<Result<unknown>>;
  sendReadReceipt(channelId: string, messageId: string): Promise<Result<unknown>>;
}

export interface ChannelPlugin {
  id: string;
  meta: {
    selectionLabel: string;
    blurb: string;
    aliases?: string[];
  };
  inbound: ChannelInboundAdapter;
  outbound: ChannelOutboundAdapter;
  getMembers(channelId: string): Promise<Result<ChannelMember[]>>;
  getChannelInfo?(channelId: string): Promise<Result<{ name: string; memberCount: number }>>;
}
