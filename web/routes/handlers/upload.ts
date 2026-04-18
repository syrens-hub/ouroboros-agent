import { PAYLOAD_TOO_LARGE } from "../constants.ts";
import { randomUUID } from "crypto";
import { existsSync, createReadStream } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join, extname } from "path";
import type { IncomingMessage, ServerResponse } from "http";
import {
  json,
  readBodyBuffer,
  parseMultipartFile,
  parseMultipartImage,
  ReqContext,
} from "../shared.ts";
import { checkRateLimit } from "../../../skills/rate-limiter/index.ts";
import { getClientIp } from "../shared.ts";
import { UPLOAD_RATE_LIMIT_WINDOW_MS, UPLOAD_RATE_LIMIT_MAX_REQUESTS } from "../constants.ts";

export async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // File Upload API
  // ================================================================
  if (path === "/api/upload" && method === "POST") {
    const clientIp = getClientIp(req);
    const rate = await checkRateLimit(`upload:${clientIp}`, UPLOAD_RATE_LIMIT_MAX_REQUESTS, UPLOAD_RATE_LIMIT_WINDOW_MS);
    if (!rate.allowed) {
      json(res, 429, { success: false, error: { message: "Upload rate limit exceeded", retryAfter: rate.retryAfter } }, ctx);
      return true;
    }
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        json(res, 400, { success: false, error: { message: "Expected multipart/form-data" } }, ctx);
        return true;
      }
      const buffer = await readBodyBuffer(req, 5 * 1024 * 1024);
      const parsed = parseMultipartImage(buffer, contentType);
      if (!parsed) {
        json(res, 400, { success: false, error: { message: "No valid image file found" } }, ctx);
        return true;
      }
      const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
      if (!allowed.includes(parsed.mimeType)) {
        json(res, 400, { success: false, error: { message: `Unsupported image type: ${parsed.mimeType}` } }, ctx);
        return true;
      }
      const sessionId = new URL(req.url || "", "http://localhost").searchParams.get("sessionId") || "global";
      const ext = parsed.filename.split(".").pop() || "png";
      const safeName = `${randomUUID()}.${ext}`;
      const uploadDir = join(process.cwd(), ".ouroboros", "uploads", sessionId);
      await mkdir(uploadDir, { recursive: true });
      const filePath = join(uploadDir, safeName);
      await writeFile(filePath, parsed.data);
      json(res, 200, {
        success: true,
        data: { url: `/api/uploads/${sessionId}/${safeName}`, name: parsed.filename },
      }, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
        json(res, 413, { success: false, error: { message: "Payload too large (max 5MB)" } }, ctx);
        return true;
      }
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  if (path === "/api/upload/file" && method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        json(res, 400, { success: false, error: { message: "Expected multipart/form-data" } }, ctx);
        return true;
      }
      const buffer = await readBodyBuffer(req, 20 * 1024 * 1024);
      const parsed = parseMultipartFile(buffer, contentType);
      if (!parsed) {
        json(res, 400, { success: false, error: { message: "No valid file found" } }, ctx);
        return true;
      }
      const allowedExts = [".pdf", ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py", ".csv", ".docx", ".xlsx", ".pptx"];
      const ext = extname(parsed.filename).toLowerCase();
      if (!allowedExts.includes(ext)) {
        json(res, 400, { success: false, error: { message: `Unsupported file type: ${ext}` } }, ctx);
        return true;
      }
      const sessionId = new URL(req.url || "", "http://localhost").searchParams.get("sessionId") || "global";
      const safeName = `${randomUUID()}-${parsed.filename}`;
      const uploadDir = join(process.cwd(), ".ouroboros", "uploads", sessionId);
      await mkdir(uploadDir, { recursive: true });
      const filePath = join(uploadDir, safeName);
      await writeFile(filePath, parsed.data);
      json(res, 200, {
        success: true,
        data: { url: `/api/uploads/${sessionId}/${safeName}`, name: parsed.filename },
      }, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
        json(res, 413, { success: false, error: { message: "Payload too large (max 20MB)" } }, ctx);
        return true;
      }
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  const uploadMatch = path.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/);
  if (uploadMatch && method === "GET") {
    const [, sessionId, filename] = uploadMatch;
    const filePath = join(process.cwd(), ".ouroboros", "uploads", sessionId, filename);
    if (!existsSync(filePath)) {
      json(res, 404, { success: false, error: { message: "File not found" } }, ctx);
      return true;
    }
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      pdf: "application/pdf",
      txt: "text/plain",
      md: "text/markdown",
      json: "application/json",
      js: "application/javascript",
      ts: "application/typescript",
      jsx: "application/javascript",
      tsx: "application/typescript",
      py: "text/x-python",
      csv: "text/csv",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const mime = mimeMap[ext || ""] || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}
