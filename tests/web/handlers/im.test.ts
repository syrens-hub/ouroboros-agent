import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleIM } from "../../../web/routes/handlers/im.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();

const mockFeishuIsRunning = vi.fn();
const mockFeishuStart = vi.fn();
const mockFeishuStop = vi.fn();

const mockDingtalkStart = vi.fn();
const mockDingtalkStop = vi.fn();

const mockSlackStart = vi.fn();
const mockSlackStop = vi.fn();

const mockWechatworkStart = vi.fn();
const mockWechatworkStop = vi.fn();

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: any[]) => mockJson(...args),
  ReqContext: {},
}));

vi.mock("../../../extensions/im/feishu/index.ts", () => ({
  feishuPlugin: {
    isRunning: () => mockFeishuIsRunning(),
    start: () => mockFeishuStart(),
    stop: () => mockFeishuStop(),
  },
}));

vi.mock("../../../extensions/im/dingtalk/index.ts", () => ({
  dingtalkPlugin: {
    start: () => mockDingtalkStart(),
    stop: () => mockDingtalkStop(),
  },
}));

vi.mock("../../../extensions/im/slack/index.ts", () => ({
  slackPlugin: {
    start: () => mockSlackStart(),
    stop: () => mockSlackStop(),
  },
}));

vi.mock("../../../extensions/im/wechatwork/index.ts", () => ({
  wechatworkPlugin: {
    start: () => mockWechatworkStart(),
    stop: () => mockWechatworkStop(),
  },
}));

function createMockReq(url = "/") {
  return { url } as IncomingMessage;
}

function ctx() {
  return { requestId: "req-1", startTime: Date.now() };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEISHU_WEBHOOK_PORT;
  delete process.env.FEISHU_WEBHOOK_PATH;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.DINGTALK_APP_KEY;
  delete process.env.DINGTALK_WEBHOOK_PORT;
  delete process.env.DINGTALK_WEBHOOK_PATH;
  delete process.env.WECHATWORK_WEBHOOK_URL;
  delete process.env.WECHATWORK_WEBHOOK_PORT;
  delete process.env.WECHATWORK_WEBHOOK_PATH;
});

describe("handleIM", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleIM(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  describe("GET /api/im/status", () => {
    it("returns status with all plugins", async () => {
      mockFeishuIsRunning.mockReturnValue(true);
      process.env.SLACK_BOT_TOKEN = "xoxb-token";
      process.env.DINGTALK_APP_KEY = "app-key";
      process.env.WECHATWORK_WEBHOOK_URL = "https://qyapi.weixin.qq.com";
      process.env.FEISHU_WEBHOOK_PORT = "4000";
      process.env.FEISHU_WEBHOOK_PATH = "/feishu/custom";
      process.env.DINGTALK_WEBHOOK_PORT = "4100";
      process.env.DINGTALK_WEBHOOK_PATH = "/dingtalk/custom";
      process.env.WECHATWORK_WEBHOOK_PORT = "4200";
      process.env.WECHATWORK_WEBHOOK_PATH = "/wechatwork/custom";

      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "GET", "/api/im/status", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        {
          success: true,
          data: {
            feishu: {
              available: true,
              running: true,
              webhookUrl: "http://localhost:4000/feishu/custom",
            },
            slack: {
              available: true,
              running: false,
            },
            dingtalk: {
              available: true,
              running: false,
              webhookUrl: "http://localhost:4100/dingtalk/custom",
            },
            wechatwork: {
              available: true,
              running: false,
              webhookUrl: "http://localhost:4200/wechatwork/custom",
            },
            mockChat: {
              available: true,
            },
          },
        },
        expect.any(Object)
      );
    });

    it("returns status with defaults when env vars are absent", async () => {
      mockFeishuIsRunning.mockReturnValue(false);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "GET", "/api/im/status", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        {
          success: true,
          data: {
            feishu: {
              available: true,
              running: false,
              webhookUrl: "http://localhost:3000/feishu/webhook",
            },
            slack: {
              available: false,
              running: false,
            },
            dingtalk: {
              available: false,
              running: false,
              webhookUrl: "http://localhost:3100/dingtalk/webhook",
            },
            wechatwork: {
              available: false,
              running: false,
              webhookUrl: "http://localhost:3200/wechatwork/webhook",
            },
            mockChat: {
              available: true,
            },
          },
        },
        expect.any(Object)
      );
    });
  });

  describe("Feishu control", () => {
    it("POST /api/im/feishu/start succeeds", async () => {
      mockFeishuStart.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/feishu/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: true } },
        expect.any(Object)
      );
    });

    it("POST /api/im/feishu/start handles exception", async () => {
      mockFeishuStart.mockImplementation(() => { throw new Error("feishu start failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/feishu/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: feishu start failed" } },
        expect.any(Object)
      );
    });

    it("POST /api/im/feishu/stop succeeds", async () => {
      mockFeishuStop.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/feishu/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: false } },
        expect.any(Object)
      );
    });

    it("POST /api/im/feishu/stop handles exception", async () => {
      mockFeishuStop.mockImplementation(() => { throw new Error("feishu stop failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/feishu/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: feishu stop failed" } },
        expect.any(Object)
      );
    });
  });

  describe("DingTalk control", () => {
    it("POST /api/im/dingtalk/start succeeds", async () => {
      mockDingtalkStart.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/dingtalk/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: true } },
        expect.any(Object)
      );
    });

    it("POST /api/im/dingtalk/start handles exception", async () => {
      mockDingtalkStart.mockImplementation(() => { throw new Error("dingtalk start failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/dingtalk/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: dingtalk start failed" } },
        expect.any(Object)
      );
    });

    it("POST /api/im/dingtalk/stop succeeds", async () => {
      mockDingtalkStop.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/dingtalk/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: false } },
        expect.any(Object)
      );
    });

    it("POST /api/im/dingtalk/stop handles exception", async () => {
      mockDingtalkStop.mockImplementation(() => { throw new Error("dingtalk stop failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/dingtalk/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: dingtalk stop failed" } },
        expect.any(Object)
      );
    });
  });

  describe("Slack control", () => {
    it("POST /api/im/slack/start succeeds", async () => {
      mockSlackStart.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/slack/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: true } },
        expect.any(Object)
      );
    });

    it("POST /api/im/slack/start handles exception", async () => {
      mockSlackStart.mockImplementation(() => { throw new Error("slack start failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/slack/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: slack start failed" } },
        expect.any(Object)
      );
    });

    it("POST /api/im/slack/stop succeeds", async () => {
      mockSlackStop.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/slack/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: false } },
        expect.any(Object)
      );
    });

    it("POST /api/im/slack/stop handles exception", async () => {
      mockSlackStop.mockImplementation(() => { throw new Error("slack stop failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/slack/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: slack stop failed" } },
        expect.any(Object)
      );
    });
  });

  describe("WeChat Work control", () => {
    it("POST /api/im/wechatwork/start succeeds", async () => {
      mockWechatworkStart.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/wechatwork/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: true } },
        expect.any(Object)
      );
    });

    it("POST /api/im/wechatwork/start handles exception", async () => {
      mockWechatworkStart.mockImplementation(() => { throw new Error("wechatwork start failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/wechatwork/start", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: wechatwork start failed" } },
        expect.any(Object)
      );
    });

    it("POST /api/im/wechatwork/stop succeeds", async () => {
      mockWechatworkStop.mockReturnValue(undefined);
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/wechatwork/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        200,
        { success: true, data: { running: false } },
        expect.any(Object)
      );
    });

    it("POST /api/im/wechatwork/stop handles exception", async () => {
      mockWechatworkStop.mockImplementation(() => { throw new Error("wechatwork stop failed"); });
      const res = createMockRes();
      const result = await handleIM(createMockReq(), res, "POST", "/api/im/wechatwork/stop", ctx());
      expect(result).toBe(true);
      expect(mockJson).toHaveBeenCalledWith(
        res,
        500,
        { success: false, error: { message: "Error: wechatwork stop failed" } },
        expect.any(Object)
      );
    });
  });
});
