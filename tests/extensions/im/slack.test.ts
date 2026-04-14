import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { slackPlugin } from "../../../extensions/im/slack/index.ts";

describe("Slack Extension", () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    slackPlugin.start();
  });

  afterEach(() => {
    slackPlugin.stop();
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("starts and stops without error", () => {
    expect(() => slackPlugin.start()).not.toThrow();
    expect(() => slackPlugin.stop()).not.toThrow();
  });

  it("sendText calls WebClient when configured", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    slackPlugin.setClient({
      chat: { postMessage },
      conversations: {
        members: vi.fn(),
        info: vi.fn(),
      },
    });

    const result = await slackPlugin.outbound.sendText("C123", "hello world", { threadId: "T456" });
    expect(postMessage).toHaveBeenCalledWith({ channel: "C123", text: "hello world", thread_ts: "T456" });
    expect(result.success).toBe(true);
  });

  it("onMessage registers and emits events", () => {
    const handler = vi.fn();
    const unregister = slackPlugin.inbound.onMessage(handler);
    slackPlugin.simulateMessage("hi there", "C789", "U111");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "C789",
        senderId: "U111",
        text: "hi there",
      })
    );
    unregister();
    slackPlugin.simulateMessage("again", "C789", "U111");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("getMembers returns mock data when client is absent", async () => {
    const result = await slackPlugin.getMembers!("C123");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: "bot", name: "Ouroboros Bot" }]);
    }
  });

  it("getChannelInfo returns mock data when client is absent", async () => {
    const result = await slackPlugin.getChannelInfo!("C123");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "C123", memberCount: 1 });
    }
  });
});
