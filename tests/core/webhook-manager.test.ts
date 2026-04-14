import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebhookManager } from "../../core/webhook-manager.ts";
import { createHmac } from "crypto";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("WebhookManager", () => {
  let manager: WebhookManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `webhook-manager-${Date.now()}.db`);
    manager = new WebhookManager(dbPath);
  });

  afterEach(() => {
    manager.close();
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  });

  it("registers and lists webhooks", () => {
    const webhook = {
      id: "wh_1",
      path: "/webhooks/github",
      secret: "supersecret",
      eventType: "push",
      targetSessionId: "sess_1",
      enabled: true,
    };

    const id = manager.register(webhook);
    expect(id).toBe("wh_1");

    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("wh_1");
    expect(list[0].path).toBe("/webhooks/github");
    expect(list[0].eventType).toBe("push");
    expect(list[0].targetSessionId).toBe("sess_1");
    expect(list[0].enabled).toBe(true);
  });

  it("unregisters a webhook", () => {
    manager.register({
      id: "wh_2",
      path: "/webhooks/gitlab",
      secret: "secret",
      eventType: "merge_request",
      enabled: true,
    });

    manager.unregister("wh_2");
    expect(manager.list().length).toBe(0);
    expect(manager.getHandler("/webhooks/gitlab")).toBeUndefined();
  });

  it("retrieves a handler by path", () => {
    manager.register({
      id: "wh_3",
      path: "/webhooks/custom",
      secret: "shh",
      eventType: "deploy",
      enabled: false,
    });

    const handler = manager.getHandler("/webhooks/custom");
    expect(handler).toBeDefined();
    expect(handler!.id).toBe("wh_3");
    expect(handler!.enabled).toBe(false);
  });

  it("verifySignature returns true for a valid HMAC-SHA256 signature", () => {
    const payload = JSON.stringify({ event: "push" });
    const secret = "my-secret";
    const signature = createHmac("sha256", secret).update(payload).digest("hex");

    expect(manager.verifySignature(payload, secret, signature)).toBe(true);
  });

  it("verifySignature returns false for an invalid signature", () => {
    const payload = JSON.stringify({ event: "push" });
    expect(manager.verifySignature(payload, "secret", "bad-signature")).toBe(false);
  });
});
