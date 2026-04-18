/**
 * Security Framework
 * ==================
 * Path validation, security audit logging, and tool rate limiting.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { appConfig } from "./config.ts";

function getDefaultDbPath(filename: string): string {
  const dir = appConfig.db.dir.startsWith("/")
    ? appConfig.db.dir
    : join(process.cwd(), appConfig.db.dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, filename);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  const regexStr = "^" + escapeRegExp(pattern).replace(/\\\*/g, ".*") + "$";
  return new RegExp(regexStr);
}

export class PathValidator {
  private patterns: RegExp[];

  constructor(denyPatterns: string[]) {
    this.patterns = denyPatterns.map(globToRegex);
  }

  validate(path: string): boolean {
    for (const pattern of this.patterns) {
      if (pattern.test(path)) return false;
    }
    return true;
  }
}

export class SecurityAuditor {
  private db: InstanceType<typeof Database>;

  constructor(dbPath?: string) {
    const path = dbPath ?? getDefaultDbPath("security.db");
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        decision TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_security_audit_session ON security_audit_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_security_audit_timestamp ON security_audit_log(timestamp DESC);
    `);
  }

  logDecision(
    sessionId: string,
    toolName: string,
    input: unknown,
    decision: string,
    reason: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO security_audit_log (session_id, tool_name, input_json, decision, timestamp, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sessionId, toolName, JSON.stringify(input), decision, Date.now(), reason);
  }

  getRecentAudits(
    sessionId?: string,
    limit = 50
  ): Array<{
    id: number;
    session_id: string;
    tool_name: string;
    input_json: string;
    decision: string;
    timestamp: number;
    reason: string | null;
  }> {
    if (sessionId) {
      return this.db
        .prepare(
          `SELECT * FROM security_audit_log WHERE session_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(sessionId, limit) as Array<{
        id: number;
        session_id: string;
        tool_name: string;
        input_json: string;
        decision: string;
        timestamp: number;
        reason: string | null;
      }>;
    }
    return this.db
      .prepare(`SELECT * FROM security_audit_log ORDER BY timestamp DESC, id DESC LIMIT ?`)
      .all(limit) as Array<{
      id: number;
      session_id: string;
      tool_name: string;
      input_json: string;
      decision: string;
      timestamp: number;
      reason: string | null;
    }>;
  }

  close(): void {
    this.db.close();
  }
}

export class ToolRateLimiter {
  private windows = new Map<string, number[]>();

  checkToolRateLimit(
    sessionId: string,
    toolName: string,
    maxCalls: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; retryAfter: number } {
    const key = `${sessionId}:${toolName}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    let timestamps = this.windows.get(key) ?? [];
    timestamps = timestamps.filter((t) => t > cutoff);
    // Memory leak fix: delete the Map entry when the window is empty so keys
    // accumulate indefinitely only when the slot is actively in use.
    if (timestamps.length === 0) {
      this.windows.delete(key);
    } else {
      this.windows.set(key, timestamps);
    }

    if (timestamps.length >= maxCalls) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter: Math.max(0, retryAfter) };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return {
      allowed: true,
      remaining: Math.max(0, maxCalls - timestamps.length),
      retryAfter: 0,
    };
  }
}

export function createSecurityFramework(
  opts: { denyPatterns?: string[]; dbPath?: string } = {}
) {
  return {
    pathValidator: new PathValidator(opts.denyPatterns ?? []),
    securityAuditor: new SecurityAuditor(opts.dbPath),
    toolRateLimiter: new ToolRateLimiter(),
  };
}
