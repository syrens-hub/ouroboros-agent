import { describe, it, expect, vi } from "vitest";
import { sendAlert, resetAlertChannels } from "../../core/alerting.ts";

describe("alerting", () => {
  it("logs locally when no webhook is configured", async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    await sendAlert({ level: "warning", title: "Test", message: "Hello" });
  });

  it("sends generic webhook payload", async () => {
    resetAlertChannels();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchSpy as unknown as typeof fetch;
    process.env.ALERT_WEBHOOK_URL = "http://localhost:9999/alert";
    process.env.ALERT_WEBHOOK_TYPE = "generic";

    await sendAlert({ level: "critical", title: "Disk full", message: "No space left", meta: { disk: 99 } });

    expect(fetchSpy).toHaveBeenCalled();
    const call = fetchSpy.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body);
    expect(body.title).toBe("Disk full");
    expect(body.level).toBe("critical");

    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.ALERT_WEBHOOK_TYPE;
  });

  it("sends dingtalk markdown payload", async () => {
    resetAlertChannels();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchSpy as unknown as typeof fetch;
    process.env.ALERT_WEBHOOK_URL = "http://localhost:9999/ding";
    process.env.ALERT_WEBHOOK_TYPE = "dingtalk";

    await sendAlert({ level: "warning", title: "T", message: "M" });

    const call = fetchSpy.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body);
    expect(body.msgtype).toBe("markdown");

    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.ALERT_WEBHOOK_TYPE;
  });

  it("sends slack payload", async () => {
    resetAlertChannels();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchSpy as unknown as typeof fetch;
    process.env.ALERT_WEBHOOK_URL = "http://localhost:9999/slack";
    process.env.ALERT_WEBHOOK_TYPE = "slack";

    await sendAlert({ level: "info", title: "T", message: "M" });

    const call = fetchSpy.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain("T");

    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.ALERT_WEBHOOK_TYPE;
  });

  it("survives webhook failure", async () => {
    resetAlertChannels();
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network"));
    global.fetch = fetchSpy as unknown as typeof fetch;
    process.env.ALERT_WEBHOOK_URL = "http://localhost:9999/fail";

    await sendAlert({ level: "warning", title: "T", message: "M" });

    delete process.env.ALERT_WEBHOOK_URL;
  });
});
