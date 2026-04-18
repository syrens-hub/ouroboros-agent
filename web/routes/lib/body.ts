/**
 * Body Parsing Utilities
 * ======================
 */

import type { IncomingMessage } from "http";
import { z } from "zod";
import { PAYLOAD_TOO_LARGE } from "../constants.ts";
import { safeJsonParse } from "../../../core/safe-utils.ts";

export const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

export function readBody(req: IncomingMessage, maxBytes = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error(PAYLOAD_TOO_LARGE));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function readBodyBuffer(req: IncomingMessage, maxBytes = MAX_BODY_SIZE): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error(PAYLOAD_TOO_LARGE));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function parseMultipartFile(
  buffer: Buffer,
  contentType: string,
  requireImage = false
): { filename: string; mimeType: string; data: Buffer } | null {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1].trim();
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let idx = buffer.indexOf(boundaryBuffer);
  while (idx !== -1) {
    const partStart = idx + boundaryBuffer.length;
    const nextIdx = buffer.indexOf(boundaryBuffer, partStart);
    const part = buffer.slice(partStart, nextIdx !== -1 ? nextIdx : undefined);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      idx = nextIdx;
      continue;
    }
    const headers = part.slice(0, headerEnd).toString("utf-8");
    const cdMatch = headers.match(/Content-Disposition:[^\r\n]+filename="([^"]+)"/i);
    const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    if (cdMatch) {
      const mimeType = ctMatch ? ctMatch[1].trim() : "application/octet-stream";
      if (!requireImage || mimeType.startsWith("image/")) {
        const dataStart = headerEnd + 4;
        let dataEnd = part.length;
        if (part.slice(dataEnd - 2).toString() === "\r\n") dataEnd -= 2;
        return { filename: cdMatch[1], mimeType, data: part.slice(dataStart, dataEnd) };
      }
    }
    idx = nextIdx;
  }
  return null;
}

export function parseMultipartImage(buffer: Buffer, contentType: string): { filename: string; mimeType: string; data: Buffer } | null {
  return parseMultipartFile(buffer, contentType, true);
}

export const ConfirmBodySchema = z.object({ allowed: z.boolean() });
export const InstallSkillBodySchema = z.object({ source: z.string().min(1) });
export const RestoreBackupBodySchema = z.object({ filename: z.string().min(1) });

export function parseBody<T>(body: string, schema: z.ZodSchema<T>): { success: true; data: T } | { success: false; error: string } {
  const parsed = safeJsonParse(body, "request body");
  if (parsed === undefined) {
    return { success: false, error: "Invalid JSON body" };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") };
  }
  return { success: true, data: result.data };
}

export async function readJsonBody<T>(
  req: IncomingMessage,
  schema: z.ZodSchema<T>,
): Promise<{ success: true; data: T } | { success: false; error: string; status: 400 | 413 }> {
  let body: string;
  try {
    body = await readBody(req);
  } catch (e) {
    if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
      return { success: false, error: "Payload too large", status: 413 };
    }
    throw e;
  }
  const parsed = parseBody(body, schema);
  if (!parsed.success) {
    return { success: false, error: parsed.error, status: 400 };
  }
  return { success: true, data: parsed.data };
}
