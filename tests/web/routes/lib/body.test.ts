import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseBody, readJsonBody, parseMultipartFile, parseMultipartImage } from "../../../../web/routes/lib/body.ts";
import { EventEmitter } from "events";
import type { IncomingMessage } from "http";

describe("body utilities", () => {
  it("parseBody returns error for invalid JSON", () => {
    const result = parseBody("not-json", z.object({ name: z.string() }));
    expect(result.success).toBe(false);
    expect((result as any).error).toContain("Invalid JSON");
  });

  it("parseBody returns error for schema mismatch", () => {
    const result = parseBody('{"name": 123}', z.object({ name: z.string() }));
    expect(result.success).toBe(false);
    expect((result as any).error).toContain("name");
  });

  it("parseBody returns data for valid input", () => {
    const result = parseBody('{"name": "hello"}', z.object({ name: z.string() }));
    expect(result.success).toBe(true);
    expect((result as any).data).toEqual({ name: "hello" });
  });

  it("readJsonBody returns 413 for payload too large", async () => {
    const req = new EventEmitter() as IncomingMessage;
    req.destroy = () => req;
    const promise = readJsonBody(req, z.object({ x: z.string() }));
    const huge = Buffer.alloc(3 * 1024 * 1024 + 1);
    req.emit("data", huge);
    const result = await promise;
    expect(result.success).toBe(false);
    expect((result as any).status).toBe(413);
    expect((result as any).error).toContain("Payload too large");
  });

  it("readJsonBody returns 400 for invalid JSON", async () => {
    const req = new EventEmitter() as IncomingMessage;
    const promise = readJsonBody(req, z.object({ x: z.string() }));
    req.emit("data", Buffer.from("not-json"));
    req.emit("end");
    const result = await promise;
    expect(result.success).toBe(false);
    expect((result as any).status).toBe(400);
  });

  it("parseMultipartFile returns null for missing boundary", () => {
    const result = parseMultipartFile(Buffer.from("data"), "multipart/form-data");
    expect(result).toBeNull();
  });

  it("parseMultipartImage returns null for non-image", () => {
    const boundary = "----WebKitFormBoundary";
    const body = Buffer.from(
      `------WebKitFormBoundary\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n------WebKitFormBoundary--`
    );
    const result = parseMultipartImage(body, `multipart/form-data; boundary=${boundary}`);
    expect(result).toBeNull();
  });

  it("parseMultipartFile extracts file data", () => {
    const boundary = "----WebKitFormBoundary";
    const body = Buffer.from(
      `------WebKitFormBoundary\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n------WebKitFormBoundary--`
    );
    const result = parseMultipartFile(body, `multipart/form-data; boundary=${boundary}`);
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("test.txt");
    expect(result!.data.toString()).toBe("hello");
  });
});
