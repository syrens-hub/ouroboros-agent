/**
 * CORS Utilities
 * ==============
 */

import type { IncomingMessage, ServerResponse } from "http";
import { appConfig } from "../../../core/config.ts";

export const ALLOWED_ORIGINS = appConfig.web.allowedOrigins;

export function getOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin || "";
  return origin;
}

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length === 0) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function getAllowOriginValue(origin: string): string {
  if (!origin) return "";
  if (!isAllowedOrigin(origin)) return "";
  return origin;
}

export function setCorsHeaders(res: ServerResponse, origin: string) {
  const allowOrigin = getAllowOriginValue(origin);
  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "X-Request-ID");
}
