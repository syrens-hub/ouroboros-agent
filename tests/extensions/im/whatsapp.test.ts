import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { whatsappPlugin } from "../../../extensions/im/whatsapp/index.ts";

describe("WhatsApp Extension", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    whatsappPlugin.stop();
  });

  it("is inactive when WHATSAPP_EXPERIMENTAL is not set", () => {
    delete process.env.WHATSAPP_EXPERIMENTAL;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    whatsappPlugin.start();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Experimental mode not enabled"));
    logSpy.mockRestore();
  });

  it("logs warning when whatsapp-web.js is not installed", () => {
    process.env.WHATSAPP_EXPERIMENTAL = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    whatsappPlugin.start();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("whatsapp-web.js is not installed"));
    warnSpy.mockRestore();
  });

  it("sendText returns error when not enabled", async () => {
    delete process.env.WHATSAPP_EXPERIMENTAL;
    const result = await whatsappPlugin.outbound.sendText("123@c.us", "hello");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_ENABLED");
    }
  });
});
