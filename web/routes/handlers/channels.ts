import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { feishuPlugin } from "../../../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../../../extensions/im/mock-chat/index.ts";
import { telegramPlugin } from "../../../extensions/im/telegram/index.ts";
import { discordPlugin } from "../../../extensions/im/discord/index.ts";
import { slackPlugin } from "../../../extensions/im/slack/index.ts";
import { dingtalkPlugin } from "../../../extensions/im/dingtalk/index.ts";
import { wechatworkPlugin } from "../../../extensions/im/wechatwork/index.ts";
import { json, readJsonBody, ReqContext, channelRegistry 
} from "../shared.ts";

export async function handleChannels(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Channels API
  // ================================================================
  if (path === "/api/channels" && method === "GET") {
    const channels = [
      { id: "feishu", ...feishuPlugin.meta, running: feishuPlugin.isRunning() },
      { id: "slack", ...slackPlugin.meta, running: false },
      { id: "dingtalk", ...dingtalkPlugin.meta, running: false },
      { id: "wechatwork", ...wechatworkPlugin.meta, running: false },
      { id: "telegram", ...telegramPlugin.meta, running: false },
      { id: "discord", ...discordPlugin.meta, running: false },
      { id: "mock-chat", ...mockChatPlugin.meta, running: true },
    ];
    json(res, 200, { success: true, data: channels }, ctx);
    return true;
  }

  // ================================================================
  // Channel Registry API
  // ================================================================
  if (path === "/api/channels/bind" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ sessionId: z.string(), channelId: z.string(), config: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      channelRegistry.bindSession(parsed.data.sessionId, parsed.data.channelId, parsed.data.config);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  const channelSessionMatch = path.match(/^\/api\/channels\/session\/([^/]+)$/);
  if (channelSessionMatch && method === "GET") {
    const sessionId = channelSessionMatch[1];
    const plugin = channelRegistry.getChannelForSession(sessionId);
    if (!plugin) {
      json(res, 404, { success: false, error: { message: "No channel bound" } }, ctx);
      return true;
    }
    json(res, 200, { success: true, data: { channelId: plugin.id, meta: plugin.meta } }, ctx);
    return true;
  }

  return false;
}
