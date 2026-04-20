import { describe, it, expect } from "vitest";
import { detectIntrusion, recordViolation } from "../../core/intrusion-detection.ts";
import type { IncomingMessage } from "http";

function makeReq(url: string, headers: Record<string, string> = {}, remoteAddress = "127.0.0.1"): IncomingMessage {
  return { url, headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe("intrusion-detection", () => {
  it("allows normal API requests", () => {
    const req = makeReq("/api/sessions");
    expect(detectIntrusion(req).blocked).toBe(false);
  });

  it("allows upload URLs with query params", () => {
    const req = makeReq("/api/upload?sessionId=s1");
    expect(detectIntrusion(req).blocked).toBe(false);
  });

  it("blocks SQL injection in path", () => {
    const req = makeReq("/api/test?x=1' UNION SELECT * FROM users--");
    expect(detectIntrusion(req).blocked).toBe(true);
  });

  it("blocks path traversal", () => {
    const req = makeReq("/api/../../etc/passwd");
    expect(detectIntrusion(req).blocked).toBe(true);
  });

  it("blocks XSS in URL", () => {
    const req = makeReq("/api/test?<script>alert(1)</script>");
    expect(detectIntrusion(req).blocked).toBe(true);
  });

  it("blocks null byte injection", () => {
    const req = makeReq("/api/test%00");
    expect(detectIntrusion(req).blocked).toBe(true);
  });

  it("records violations", () => {
    recordViolation("1.2.3.4");
    recordViolation("1.2.3.4");
    // Should not throw
  });
});
