/**
 * Production EventBus
 * ===================
 * Async event queue with retry, backoff, and persistent dead-letter storage.
 * Backward-compatible with HookRegistry — EventBus wraps and enhances it.
 */

import { getDb } from "./db-manager.ts";
import type { DbAdapter } from "./db-adapter.ts";
import { hookRegistry, type HookEventType, type HookContext } from "./hook-system.ts";
export type { HookEventType, HookContext };
import { logger } from "./logger.ts";

export type BackoffStrategy = "exponential" | "linear" | "fixed";

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  retriableErrors: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: "exponential",
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retriableErrors: ["TimeoutError", "ConnectionError", "EAI_AGAIN", "ETIMEDOUT"],
};

export interface DeadLetterEntry {
  id: string;
  eventType: HookEventType;
  context: string; // JSON-serialized HookContext
  error: string;
  attempts: number;
  lastAttemptAt: number;
  status: "pending" | "retrying" | "resolved";
  resolvedAt?: number;
}

export interface EventBusHealth {
  queueSize: number;
  deadLetterCount: number;
  pendingDeadLetters: number;
  running: boolean;
  handlerCount: Record<string, number>;
}

interface QueuedEvent {
  eventType: HookEventType;
  context: HookContext;
  attempts: number;
}

export function initEventBusTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dead_letters (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      context TEXT NOT NULL,
      error TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      last_attempt_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_dead_letters_status ON dead_letters(status);
    CREATE INDEX IF NOT EXISTS idx_dead_letters_type ON dead_letters(event_type);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initEventBusTables(db);
}

/** Generate a short id for dead-letter entries. */
function dlId(): string {
  return `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function serializeContext(ctx: HookContext): string {
  try {
    return JSON.stringify(ctx);
  } catch {
    return "{}";
  }
}

function calculateBackoff(attempt: number, policy: RetryPolicy): number {
  let delay: number;
  switch (policy.backoff) {
    case "exponential":
      delay = policy.baseDelayMs * 2 ** attempt;
      break;
    case "linear":
      delay = policy.baseDelayMs * (attempt + 1);
      break;
    case "fixed":
    default:
      delay = policy.baseDelayMs;
      break;
  }
  return Math.min(delay, policy.maxDelayMs);
}

function isRetriable(error: unknown, policy: RetryPolicy): boolean {
  const msg = String(error);
  return policy.retriableErrors.some((e) => msg.includes(e));
}

export class ProductionEventBus {
  private queue: QueuedEvent[] = [];
  private processing = false;
  private retryPolicy: RetryPolicy;
  private maxConcurrent: number;
  private activeCount = 0;

  constructor(opts?: { retryPolicy?: RetryPolicy; maxConcurrent?: number }) {
    this.retryPolicy = opts?.retryPolicy ?? { ...DEFAULT_RETRY_POLICY };
    this.maxConcurrent = opts?.maxConcurrent ?? 10;
  }

  /** Async emit — schedules event for background processing. */
  emitAsync(eventType: HookEventType, context: HookContext): void {
    this.queue.push({ eventType, context, attempts: 0 });
    if (!this.processing) {
      this.processing = true;
      // Defer processing to next tick to batch rapid emissions
      setImmediate(() => this._processLoop());
    }
  }

  /** Sync-compatible emit — fires immediately via HookRegistry, then queues for retry safety. */
  async emit(eventType: HookEventType, context: HookContext): Promise<void> {
    // First try sync path for backward compatibility
    await hookRegistry.emit(eventType, context);
    // Also queue for guaranteed delivery with retry
    this.emitAsync(eventType, context);
  }

  /** Fire event immediately without queueing (pass-through to HookRegistry). */
  async emitImmediate(eventType: HookEventType, context: HookContext): Promise<void> {
    await hookRegistry.emit(eventType, context);
  }

  private async _processLoop(): Promise<void> {
    while (this.queue.length > 0 && this.processing) {
      // Respect concurrency limit
      while (this.activeCount >= this.maxConcurrent) {
        await new Promise((r) => setTimeout(r, 10));
      }

      const item = this.queue.shift();
      if (!item) continue;

      this.activeCount++;
      this._dispatchWithRetry(item).finally(() => {
        this.activeCount--;
      });
    }
    this.processing = false;
  }

  private async _dispatchWithRetry(item: QueuedEvent): Promise<void> {
    const policy = this.retryPolicy;
    let lastError: unknown;

    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      try {
        const handlers = hookRegistry.getHandlers(item.eventType);
        if (handlers.length === 0) return; // Nothing to do
        for (const handler of handlers) {
          await handler(item.eventType, item.context);
        }
        return; // Success
      } catch (e) {
        lastError = e;
        if (!isRetriable(e, policy)) {
          break; // Non-retriable — move to dead letter immediately
        }
        if (attempt < policy.maxAttempts - 1) {
          const delay = calculateBackoff(attempt, policy);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    // All retries exhausted
    await this._moveToDeadLetter(item, lastError);
  }

  private async _moveToDeadLetter(item: QueuedEvent, error: unknown): Promise<void> {
    ensureInitialized();
    const db = getDb();
    const entry: DeadLetterEntry = {
      id: dlId(),
      eventType: item.eventType,
      context: serializeContext(item.context),
      error: String(error),
      attempts: item.attempts + this.retryPolicy.maxAttempts,
      lastAttemptAt: Date.now(),
      status: "pending",
    };

    db.prepare(
      `INSERT INTO dead_letters (id, event_type, context, error, attempts, last_attempt_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(entry.id, entry.eventType, entry.context, entry.error, entry.attempts, entry.lastAttemptAt, entry.status);

    logger.warn("Event moved to dead letter", { eventType: entry.eventType, error: entry.error, id: entry.id });
  }

  /** Retry a dead-letter entry by id. */
  retryDeadLetter(id: string): boolean {
    ensureInitialized();
    const db = getDb();
    const row = db.prepare(
      `SELECT id, event_type, context, error, attempts, last_attempt_at, status
       FROM dead_letters WHERE id = ?`
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) return false;

    db.prepare(`UPDATE dead_letters SET status = 'resolved', resolved_at = ? WHERE id = ?`).run(Date.now(), id);

    // Re-queue the event
    try {
      const ctx = JSON.parse(String(row.context)) as HookContext;
      this.emitAsync(String(row.event_type) as HookEventType, ctx);
      return true;
    } catch {
      return false;
    }
  }

  /** Mark a dead-letter as resolved without retry. */
  resolveDeadLetter(id: string): boolean {
    ensureInitialized();
    const db = getDb();
    const result = db.prepare(
      `UPDATE dead_letters SET status = 'resolved', resolved_at = ? WHERE id = ?`
    ).run(Date.now(), id);
    return (result as { changes: number }).changes > 0;
  }

  /** Query dead letters. */
  getDeadLetters(status?: "pending" | "retrying" | "resolved"): DeadLetterEntry[] {
    ensureInitialized();
    const db = getDb();
    const sql = status
      ? `SELECT id, event_type, context, error, attempts, last_attempt_at, status, resolved_at
         FROM dead_letters WHERE status = ? ORDER BY last_attempt_at DESC`
      : `SELECT id, event_type, context, error, attempts, last_attempt_at, status, resolved_at
         FROM dead_letters ORDER BY last_attempt_at DESC`;

    const rows = db.prepare(sql).all(status ? [status] : []) as unknown[];
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        eventType: String(r.event_type) as HookEventType,
        context: String(r.context),
        error: String(r.error),
        attempts: Number(r.attempts),
        lastAttemptAt: Number(r.last_attempt_at),
        status: String(r.status) as DeadLetterEntry["status"],
        resolvedAt: r.resolved_at ? Number(r.resolved_at) : undefined,
      };
    });
  }

  /** Health check snapshot. */
  healthCheck(): EventBusHealth {
    ensureInitialized();
    const db = getDb();
    const total = db.prepare(`SELECT COUNT(*) as c FROM dead_letters`).get() as { c: number };
    const pending = db.prepare(`SELECT COUNT(*) as c FROM dead_letters WHERE status = 'pending'`).get() as { c: number };

    return {
      queueSize: this.queue.length,
      deadLetterCount: total?.c ?? 0,
      pendingDeadLetters: pending?.c ?? 0,
      running: this.processing,
      handlerCount: {}, // Handlers live in HookRegistry
    };
  }

  /** Drain queue and stop processing. */
  shutdown(): void {
    this.processing = false;
  }
}

/** Singleton instance for app-wide use. */
export const eventBus = new ProductionEventBus();
