import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAuthValid } from "../../../../web/routes/lib/auth.ts";
import { EventEmitter } from "events";
import type { IncomingMessage } from "http";
import { appConfig } from "../../../../core/config.ts";

describe("auth", () => {
  const originalToken = appConfig.web.apiToken;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    appConfig.web.apiToken = "test-secret-token";
    delete (process.env as any).NODE_ENV;
  });

  afterEach(() => {
    appConfig.web.apiToken = originalToken;
    process.env.NODE_ENV = originalEnv;
  });

  function mockReq(auth?: string): IncomingMessage {
    const req = new EventEmitter() as IncomingMessage;
    req.headers = auth ? { authorization: `Bearer ${auth}` } : {};
    return req;
  }

  it("allows health endpoints without token", () => {
    expect(isAuthValid(mockReq(), "/api/health")).toBe(true);
    expect(isAuthValid(mockReq(), "/api/ready")).toBe(true);
    expect(isAuthValid(mockReq(), "/api/metrics")).toBe(true);
  });

  it("validates correct bearer token", () => {
    expect(isAuthValid(mockReq("test-secret-token"), "/api/sessions")).toBe(true);
  });

  it("rejects incorrect bearer token", () => {
    expect(isAuthValid(mockReq("wrong-token"), "/api/sessions")).toBe(false);
  });

  it("rejects missing authorization header", () => {
    expect(isAuthValid(mockReq(), "/api/sessions")).toBe(false);
  });

  it("rejects empty bearer", () => {
    const req = new EventEmitter() as IncomingMessage;
    req.headers = { authorization: "Bearer " };
    expect(isAuthValid(req, "/api/sessions")).toBe(false);
  });

  it("bypasses auth in development when token not set", () => {
    appConfig.web.apiToken = "";
    process.env.NODE_ENV = "development";
    expect(isAuthValid(mockReq(), "/api/sessions")).toBe(true);
  });

  it("blocks in production when token not set", () => {
    appConfig.web.apiToken = "";
    process.env.NODE_ENV = "production";
    expect(isAuthValid(mockReq(), "/api/sessions")).toBe(false);
  });
});
