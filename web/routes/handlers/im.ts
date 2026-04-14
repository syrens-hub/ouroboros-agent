import type { IncomingMessage, ServerResponse } from "http";
import { feishuPlugin } from "../../../extensions/im/feishu/index.ts";
import { dingtalkPlugin } from "../../../extensions/im/dingtalk/index.ts";
import { slackPlugin } from "../../../extensions/im/slack/index.ts";
import { wechatworkPlugin } from "../../../extensions/im/wechatwork/index.ts";
import { json, ReqContext } from "../shared.ts";

export async function handleIM(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // IM Status
  if (path === "/api/im/status" && method === "GET") {
    json(res, 200, {
      success: true,
      data: {
        feishu: {
          available: true,
          running: feishuPlugin.isRunning(),
          webhookUrl: `http://localhost:${process.env.FEISHU_WEBHOOK_PORT || 3000}${process.env.FEISHU_WEBHOOK_PATH || "/feishu/webhook"}`,
        },
        slack: {
          available: !!process.env.SLACK_BOT_TOKEN,
          running: false,
        },
        dingtalk: {
          available: !!process.env.DINGTALK_APP_KEY,
          running: false,
          webhookUrl: `http://localhost:${process.env.DINGTALK_WEBHOOK_PORT || 3100}${process.env.DINGTALK_WEBHOOK_PATH || "/dingtalk/webhook"}`,
        },
        wechatwork: {
          available: !!process.env.WECHATWORK_WEBHOOK_URL,
          running: false,
          webhookUrl: `http://localhost:${process.env.WECHATWORK_WEBHOOK_PORT || 3200}${process.env.WECHATWORK_WEBHOOK_PATH || "/wechatwork/webhook"}`,
        },
        mockChat: {
          available: true,
        },
      },
    }, ctx);
    return true;
  }

  // Feishu control
  if (path === "/api/im/feishu/start" && method === "POST") {
    try {
      feishuPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  if (path === "/api/im/feishu/stop" && method === "POST") {
    try {
      feishuPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // DingTalk control
  if (path === "/api/im/dingtalk/start" && method === "POST") {
    try {
      dingtalkPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/im/dingtalk/stop" && method === "POST") {
    try {
      dingtalkPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // WeChat Work control
  if (path === "/api/im/wechatwork/start" && method === "POST") {
    try {
      wechatworkPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/im/wechatwork/stop" && method === "POST") {
    try {
      wechatworkPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // Slack control
  if (path === "/api/im/slack/start" && method === "POST") {
    try {
      slackPlugin.start();
      json(res, 200, { success: true, data: { running: true } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/im/slack/stop" && method === "POST") {
    try {
      slackPlugin.stop();
      json(res, 200, { success: true, data: { running: false } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
