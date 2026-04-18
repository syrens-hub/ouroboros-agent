/**
 * Webhook Manager
 * ===============
 * Persistent webhook registrations with HMAC signature verification.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { appConfig } from "../../core/config.ts";
import { safeFailClosed } from "../../core/safe-utils.ts";

function getDefaultDbPath(filename: string): string {
  const dir = appConfig.db.dir.startsWith("/")
    ? appConfig.db.dir
    : join(process.cwd(), appConfig.db.dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, filename);
}

export interface WebhookRegistration {
  id: string;
  path: string;
  secret: string;
  eventType: string;
  targetSessionId?: string;
  enabled: boolean;
}

export class WebhookManager {
  private db: InstanceType<typeof Database>;

  constructor(dbPath?: string) {
    const path = dbPath ?? getDefaultDbPath("webhooks.db");
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        secret_hmac TEXT NOT NULL,
        event_type TEXT NOT NULL,
        target_session_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhooks_path ON webhooks(path);
    `);
  }

  register(webhook: WebhookRegistration): string {
    const secretHmac = createHash("sha256").update(webhook.secret).digest("hex");
    this.db
      .prepare(
        `INSERT INTO webhooks (id, path, secret_hmac, event_type, target_session_id, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        webhook.id,
        webhook.path,
        secretHmac,
        webhook.eventType,
        webhook.targetSessionId ?? null,
        webhook.enabled ? 1 : 0,
        Date.now()
      );
    return webhook.id;
  }

  unregister(id: string): void {
    this.db.prepare(`DELETE FROM webhooks WHERE id = ?`).run(id);
  }

  list(): WebhookRegistration[] {
    const rows = this.db
      .prepare(
        `SELECT id, path, secret_hmac, event_type, target_session_id, enabled, created_at FROM webhooks ORDER BY created_at DESC`
      )
      .all() as Array<{
      id: string;
      path: string;
      secret_hmac: string;
      event_type: string;
      target_session_id: string | null;
      enabled: number;
      created_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      secret: "",
      eventType: r.event_type,
      targetSessionId: r.target_session_id ?? undefined,
      enabled: Boolean(r.enabled),
    }));
  }

  verifySignature(payload: string, secret: string, signature: string): boolean {
    const computed = createHmac("sha256", secret).update(payload).digest("hex");
    if (computed.length !== signature.length) return false;
    return safeFailClosed(
      () => timingSafeEqual(Buffer.from(computed), Buffer.from(signature)),
      "Webhook signature comparison failed",
      false
    );
  }

  getHandler(path: string): WebhookRegistration | undefined {
    const row = this.db
      .prepare(
        `SELECT id, path, secret_hmac, event_type, target_session_id, enabled, created_at FROM webhooks WHERE path = ?`
      )
      .get(path) as
      | {
          id: string;
          path: string;
          secret_hmac: string;
          event_type: string;
          target_session_id: string | null;
          enabled: number;
          created_at: number;
        }
      | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      path: row.path,
      secret: "",
      eventType: row.event_type,
      targetSessionId: row.target_session_id ?? undefined,
      enabled: Boolean(row.enabled),
    };
  }

  close(): void {
    this.db.close();
  }
}
