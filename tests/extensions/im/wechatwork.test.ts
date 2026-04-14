import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { wechatworkPlugin } from "../../../extensions/im/wechatwork/index.ts";

describe("WeChatWork Extension", () => {
  beforeEach(() => {
    wechatworkPlugin.start();
  });

  afterEach(async () => {
    wechatworkPlugin.stop();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("starts and stops without error", () => {
    expect(() => wechatworkPlugin.start()).not.toThrow();
    expect(() => wechatworkPlugin.stop()).not.toThrow();
  });

  it("handles incoming webhook and emits message", async () => {
    const handler = vi.fn();
    wechatworkPlugin.inbound.onMessage(handler);

    const payload = {
      MsgType: "text",
      Content: "hello wechatwork",
      FromUserName: "user_123",
      MsgId: "msg_456",
      AgentID: "agent_1",
      CreateTime: String(Math.floor(Date.now() / 1000)),
    };

    const response = await sendWebhook("http://localhost:3200/wechatwork/webhook", payload);
    expect(response.statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello wechatwork",
        senderId: "user_123",
        channelId: "agent_1",
        id: "msg_456",
      })
    );
  });

  it("returns 404 for unknown paths", async () => {
    const response = await sendWebhook("http://localhost:3200/unknown", { MsgType: "text", Content: "hi" });
    expect(response.statusCode).toBe(404);
  });

  it("sendText simulates when webhook URL is missing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await wechatworkPlugin.outbound.sendText("agent_1", "hello");
    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("(simulated)"));
    consoleSpy.mockRestore();
  });
});

function sendWebhook(url: string, payload: object): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode || 0, body }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
