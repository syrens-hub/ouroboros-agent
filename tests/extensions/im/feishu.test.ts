import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { createHash, createHmac, createCipheriv, randomBytes } from "crypto";
import type { IncomingMessage } from "http";
import {
  verifyFeishuSignature,
  decryptFeishuBody,
  isFreshTimestamp,
  readBody,
  feishuPlugin,
} from "../../../extensions/im/feishu/index.ts";

describe("Feishu Extension", () => {
  describe("verifyFeishuSignature", () => {
    it("returns true for a valid signature", () => {
      const body = '{"text":"hello"}';
      const timestamp = "1234567890";
      const nonce = "abc123";
      const encryptKey = "my-secret-key";
      const expected = createHmac("sha256", encryptKey)
        .update(`${timestamp}\n${nonce}\n${body}\n`)
        .digest("base64");
      expect(verifyFeishuSignature(body, expected, timestamp, nonce, encryptKey)).toBe(true);
    });

    it("returns false for an invalid signature", () => {
      expect(verifyFeishuSignature("body", "bad-sig", "ts", "nonce", "key")).toBe(false);
    });
  });

  describe("decryptFeishuBody", () => {
    it("decrypts AES-256-CBC payload correctly", () => {
      const encryptKey = "test-key-16bytes";
      const payload = { challenge: "hello-world" };
      const key = Buffer.from(createHash("sha256").update(encryptKey).digest("hex"), "hex");
      const iv = randomBytes(16);
      const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
      const padLen = 16 - (plaintext.length % 16);
      const padded = Buffer.concat([plaintext, Buffer.alloc(padLen, padLen)]);
      const cipher = createCipheriv("aes-256-cbc", key, iv);
      const encrypted = Buffer.concat([iv, cipher.update(padded), cipher.final()]);
      const encryptedBase64 = encrypted.toString("base64");

      expect(decryptFeishuBody(encryptKey, encryptedBase64)).toEqual(payload);
    });

    it("throws on invalid base64", () => {
      expect(() => decryptFeishuBody("key", "not-valid-base64!!!")).toThrow();
    });
  });

  describe("isFreshTimestamp", () => {
    it("accepts timestamps within the window", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      expect(isFreshTimestamp(nowSec, 5)).toBe(true);
    });

    it("rejects timestamps outside the window", () => {
      const oldSec = Math.floor(Date.now() / 1000) - 120;
      expect(isFreshTimestamp(oldSec, 1)).toBe(false);
    });

    it("rejects invalid strings", () => {
      expect(isFreshTimestamp("not-a-number", 5)).toBe(false);
    });
  });

  describe("readBody", () => {
    it("reads a normal request body", async () => {
      const req = new EventEmitter() as IncomingMessage;
      const promise = readBody(req);
      req.emit("data", Buffer.from('{"hello":"world"}'));
      req.emit("end");
      const body = await promise;
      expect(body).toBe('{"hello":"world"}');
    });

    it("rejects when body exceeds max size", async () => {
      const req = new EventEmitter() as IncomingMessage;
      req.destroy = vi.fn() as unknown as typeof req.destroy;
      const promise = readBody(req);
      const huge = Buffer.alloc(2 * 1024 * 1024 + 1);
      req.emit("data", huge);
      await expect(promise).rejects.toThrow("Request body too large");
      expect(req.destroy).toHaveBeenCalled();
    });

    it("rejects on request error", async () => {
      const req = new EventEmitter() as IncomingMessage;
      const promise = readBody(req);
      req.emit("error", new Error("conn reset"));
      await expect(promise).rejects.toThrow("conn reset");
    });
  });

  describe("feishuPlugin lifecycle", () => {
    it("starts and stops without error", () => {
      expect(() => feishuPlugin.start()).not.toThrow();
      expect(() => feishuPlugin.stop()).not.toThrow();
    });

    it("onMessage registers and unregisters handlers", () => {
      const handler = vi.fn();
      const unregister = feishuPlugin.inbound.onMessage(handler);
      (feishuPlugin.inbound as unknown as Record<string, (msg: unknown) => void>)["emitMessage"]({
        id: "1",
        channelId: "c1",
        threadId: "t1",
        senderId: "u1",
        senderName: "User",
        text: "hi",
        timestamp: Date.now(),
        mentionsBot: false,
        isGroup: false,
      });
      expect(handler).toHaveBeenCalledTimes(1);
      unregister();
      (feishuPlugin.inbound as unknown as Record<string, (msg: unknown) => void>)["emitMessage"]({
        id: "2",
        channelId: "c1",
        threadId: "t1",
        senderId: "u1",
        senderName: "User",
        text: "hi again",
        timestamp: Date.now(),
        mentionsBot: false,
        isGroup: false,
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
