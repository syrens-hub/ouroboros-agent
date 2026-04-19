/**
 * PostgreSQL Database Adapter
 * ===========================
 * Implements DbAdapter using node-pg (pg).
 *
 * Install:
 *   npm install pg
 *   npm install -D @types/pg
 */

import type { DbAdapter, DbPoolStats, DbStatement } from "./db-adapter.ts";
import type { Pool, PoolClient } from "pg";
import { recordDbQuery, recordDbTransaction } from "./db-metrics.ts";

let PgPool: typeof Pool | undefined;

try {
  const pg = await import("pg");
  PgPool = pg.Pool;
} catch {
  // pg not installed
}

export function isPgAvailable(): boolean {
  return !!PgPool;
}

function convertPlaceholders(sql: string): string {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

class PgStatement implements DbStatement {
  private readonly _sql: string;
  private readonly _query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

  constructor(
    sql: string,
    query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  ) {
    this._sql = sql;
    this._query = query;
  }

  async run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const converted = convertPlaceholders(this._sql);
    const result = await this._query(converted, params);
    const changes = (result as { rowCount?: number }).rowCount ?? 0;
    const lastInsertRowid = (result as { rows: { id?: number | bigint }[] }).rows?.[0]?.id ?? 0;
    return { changes, lastInsertRowid };
  }

  async get(...params: unknown[]): Promise<unknown | undefined> {
    const converted = convertPlaceholders(this._sql);
    const result = await this._query(converted, params);
    return result.rows[0];
  }

  async all(...params: unknown[]): Promise<unknown[]> {
    const converted = convertPlaceholders(this._sql);
    const result = await this._query(converted, params);
    return result.rows;
  }
}

export interface PgDbAdapterOptions {
  poolSize?: number;
}

export class PgDbAdapter implements DbAdapter {
  private pool: Pool;
  private txClient: PoolClient | null = null;

  constructor(connectionString: string, opts: PgDbAdapterOptions = {}) {
    if (!PgPool) {
      throw new Error("PostgreSQL driver 'pg' is not installed. Run: npm install pg");
    }
    this.pool = new PgPool({ connectionString, max: opts.poolSize ?? 20 });
  }

  private getQueryFn() {
    const base = this.txClient
      ? (sql: string, values?: unknown[]) => this.txClient!.query(sql, values)
      : (sql: string, values?: unknown[]) => this.pool.query(sql, values);
    return async (sql: string, values?: unknown[]) => {
      const start = performance.now();
      try {
        return await base(sql, values);
      } finally {
        recordDbQuery((performance.now() - start) / 1000, "postgres");
      }
    };
  }

  prepare(sql: string): DbStatement {
    return new PgStatement(sql, this.getQueryFn());
  }

  exec(sql: string): Promise<void> {
    return this.getQueryFn()(sql).then(() => undefined);
  }

  pragma<T = unknown>(_pragma: string): Promise<T> {
    return Promise.resolve("ok" as T);
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  getPoolStats(): DbPoolStats {
    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      activeConnections: this.pool.totalCount - this.pool.idleCount,
      waitingConnections: this.pool.waitingCount,
    };
  }

  transaction<T>(fn: () => T | Promise<T>): () => Promise<T> {
    return async () => {
      const client = await this.pool.connect();
      const previousTxClient = this.txClient;
      this.txClient = client;
      try {
        await client.query("BEGIN");
        recordDbTransaction("postgres");
        const result = await fn();
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {
          // ignore rollback errors
        });
        throw e;
      } finally {
        this.txClient = previousTxClient;
        client.release();
      }
    };
  }
}
