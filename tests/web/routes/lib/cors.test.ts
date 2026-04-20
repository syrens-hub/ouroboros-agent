import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";

vi.mock("../../../../core/config.ts", () => ({
  appConfig: {
    web: {
      allowedOrigins: ["https://allowed.com"],
    },
  },
}));

import { getOrigin, isAllowedOrigin, setCorsHeaders } from "../../../../web/routes/lib/cors.ts";

describe("cors utilities", () => {
  it("getOrigin returns header value", () => {
    const req = new EventEmitter() as IncomingMessage;
    req.headers = { origin: "https://example.com" };
    expect(getOrigin(req)).toBe("https://example.com");
  });

  it("getOrigin returns empty string when missing", () => {
    const req = new EventEmitter() as IncomingMessage;
    req.headers = {};
    expect(getOrigin(req)).toBe("");
  });

  it("isAllowedOrigin rejects empty string", () => {
    expect(isAllowedOrigin("")).toBe(false);
  });

  it("isAllowedOrigin returns true for allowed origin", () => {
    expect(isAllowedOrigin("https://allowed.com")).toBe(true);
  });

  it("isAllowedOrigin returns false for disallowed origin", () => {
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
  });

  it("setCorsHeaders sets headers for allowed origin", () => {
    const res = new EventEmitter() as ServerResponse;
    const headers: Record<string, string> = {};
    res.setHeader = (k: string, v: string) => { headers[k] = v; return res; };
    setCorsHeaders(res, "https://allowed.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://allowed.com");
    expect(headers["Vary"]).toBe("Origin");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("false");
  });

  it("setCorsHeaders skips origin header when not allowed", () => {
    const res = new EventEmitter() as ServerResponse;
    const headers: Record<string, string> = {};
    res.setHeader = (k: string, v: string) => { headers[k] = v; return res; };
    setCorsHeaders(res, "https://evil.com");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Vary"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Credentials"]).toBe("false");
  });
});
