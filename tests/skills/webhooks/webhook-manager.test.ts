import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { WebhookManager } from "../../../skills/webhooks/index.ts";

describe("WebhookManager", () => {
  let manager: WebhookManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ouroboros-webhook-"));
    manager = new WebhookManager(join(tmpDir, "webhooks.db"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers and lists a webhook", () => {
    const id = manager.register({
      id: "test-1",
      path: "/hook/test",
      secret: "shhh",
      eventType: "push",
      enabled: true,
    });
    expect(id).toBe("test-1");

    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].path).toBe("/hook/test");
    expect(list[0].secret).toBe(""); // secrets are not returned
  });

  it("unregisters a webhook", () => {
    manager.register({ id: "test-2", path: "/hook/a", secret: "s", eventType: "x", enabled: true });
    manager.unregister("test-2");
    expect(manager.list().length).toBe(0);
  });

  it("getHandler returns undefined for unknown path", () => {
    expect(manager.getHandler("/no-such-path")).toBeUndefined();
  });

  it("verifySignature returns true for valid signature", () => {
    const payload = '{"event":"push"}';
    const secret = "my-secret";
    const sig = createHmac("sha256", secret).update(payload).digest("hex");

    expect(manager.verifySignature(payload, secret, sig)).toBe(true);
  });

  it("verifySignature returns false for invalid signature", () => {
    expect(manager.verifySignature('{"x":1}', "secret", "bad-sig")).toBe(false);
  });

  it("verifySignature returns false for mismatched length", () => {
    expect(manager.verifySignature('{"x":1}', "secret", "short")).toBe(false);
  });
});
