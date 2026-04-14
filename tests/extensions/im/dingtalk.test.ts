import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { dingtalkPlugin } from "../../../extensions/im/dingtalk/index.ts";

describe("DingTalk Extension", () => {
  beforeEach(() => {
    dingtalkPlugin.start();
  });

  afterEach(async () => {
    dingtalkPlugin.stop();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("starts and stops without error", () => {
    expect(() => dingtalkPlugin.start()).not.toThrow();
    expect(() => dingtalkPlugin.stop()).not.toThrow();
  });

  it("handles incoming webhook and emits message", async () => {
    const handler = vi.fn();
    dingtalkPlugin.inbound.onMessage(handler);

    const payload = {
      conversationType: "2",
      text: { content: "hello dingtalk" },
      senderStaffId: "S123",
      senderNick: "Alice",
      conversationTitle: "test-group",
    };

    const response = await sendWebhook("http://localhost:3100/dingtalk/webhook", payload);
    expect(response.statusCode).toBe(200);

    // Wait a tick for the event to be emitted
    await new Promise((r) => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello dingtalk",
        senderId: "S123",
        senderName: "Alice",
        channelId: "test-group",
        isGroup: true,
      })
    );
  });

  it("returns 404 for unknown paths", async () => {
    const response = await sendWebhook("http://localhost:3100/unknown", { text: "hello" });
    expect(response.statusCode).toBe(404);
  });

  it("sendText simulates when credentials are missing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await dingtalkPlugin.outbound.sendText("token123", "hello");
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
