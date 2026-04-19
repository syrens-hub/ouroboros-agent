/**
 * Database Adapter Interface
 * ==========================
 * Abstracts SQLite (better-sqlite3) and PostgreSQL (pg).
 *
 * Methods may return Promises when backed by PostgreSQL.
 * Callers should await all statement and adapter operations.
 */

export interface DbPoolStats {
  totalConnections: number;
  idleConnections: number;
  activeConnections: number;
  waitingConnections: number;
}

export interface DbAdapter {
  prepare(sql: string): DbStatement;
  exec(sql: string): void | Promise<void>;
  pragma<T = unknown>(pragma: string): T | Promise<T>;
  close(): void | Promise<void>;
  transaction<T>(fn: () => T | Promise<T>): () => T | Promise<T>;
  getPoolStats?(): DbPoolStats | null;
}

export interface DbStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } | Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  get(...params: unknown[]): unknown | undefined | Promise<unknown | undefined>;
  all(...params: unknown[]): unknown[] | Promise<unknown[]>;
}
