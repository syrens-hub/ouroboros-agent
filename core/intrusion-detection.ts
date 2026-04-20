/**
 * Intrusion Detection Layer
 * =========================
 * Lightweight WAF-style request inspection for common attack patterns.
 */

import type { IncomingMessage } from "http";
import { logger } from "./logger.ts";
import { sendAlert } from "./alerting.ts";

const BLOCKED_PATTERNS = [
  // SQL injection
  { pattern: /(\b(union|select|insert|update|delete|drop|alter|create)\b.*['";])|(['";].*\b(union|select|insert|update|delete|drop|alter|create)\b)/i, name: "sql-injection" },
  // Path traversal
  { pattern: /\.\.(\/|\\|%2f|%5c)/i, name: "path-traversal" },
  // Null byte injection
  { pattern: /%00/, name: "null-byte" },
  // XSS attempt in URL (event handlers like onclick=, onerror=)
  { pattern: /<script|javascript:|\bon\w+\s*=/i, name: "xss-url" },
];

const RATE_VIOLATION_THRESHOLD = 10;
const ipViolationWindow = new Map<string, number[]>();

export interface DetectionResult {
  blocked: boolean;
  reason?: string;
  alert?: boolean;
}

export function detectIntrusion(req: IncomingMessage): DetectionResult {
  const clientIp = (req.headers["x-forwarded-for"] as string || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const path = req.url || "";

  // Pattern matching
  for (const { pattern, name } of BLOCKED_PATTERNS) {
    if (pattern.test(path)) {
      logger.warn("Intrusion pattern detected", { clientIp, pattern: name, path: path.slice(0, 200) });
      return { blocked: true, reason: `${name} pattern detected`, alert: true };
    }
  }

  // Rate violation tracking (simple in-memory)
  const now = Date.now();
  const windowMs = 60_000;
  const violations = ipViolationWindow.get(clientIp) || [];
  const recent = violations.filter((t) => now - t < windowMs);
  if (recent.length >= RATE_VIOLATION_THRESHOLD) {
    logger.warn("Rate violation threshold exceeded", { clientIp, count: recent.length });
    return { blocked: true, reason: "Rate violation threshold exceeded", alert: true };
  }

  return { blocked: false };
}

export function recordViolation(clientIp: string): void {
  const now = Date.now();
  const violations = ipViolationWindow.get(clientIp) || [];
  violations.push(now);
  ipViolationWindow.set(clientIp, violations);
  // Clean old entries periodically
  if (violations.length > RATE_VIOLATION_THRESHOLD * 2) {
    ipViolationWindow.set(clientIp, violations.filter((t) => now - t < 60_000));
  }
  // Alert on threshold breach
  const recent = violations.filter((t) => now - t < 60_000);
  if (recent.length === RATE_VIOLATION_THRESHOLD) {
    sendAlert({
      level: "warning",
      title: "入侵检测告警：高频异常请求",
      message: `IP ${clientIp} 在 1 分钟内触发 ${recent.length} 次异常请求，已临时封禁`,
      meta: { clientIp, count: recent.length },
    }).catch(() => {});
  }
}
