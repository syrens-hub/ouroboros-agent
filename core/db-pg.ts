/**
 * PostgreSQL Database Adapter
 * ===========================
 * Implements DbAdapter using node-pg (pg).
 *
 * Install:
 *   npm install pg
 *   npm install -D @types/pg
 */

import type { DbAdapter, DbStatement } from "./db-adapter.ts";
import type { Pool, PoolClient } from "pg";

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
  constructor(
    private readonly sql: string,
    private readonly query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  ) {}

  async run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const converted = convertPlaceholders(this.sql);
    const result = await this.query(converted, params);
    const changes = (result as { rowCount?: number }).rowCount ?? 0;
    const lastInsertRowid = (result as { rows: { id?: number | bigint }[] }).rows?.[0]?.id ?? 0;
    return { changes, lastInsertRowid };
  }

  async get(...params: unknown[]): Promise<unknown | undefined> {
    const converted = convertPlaceholders(this.sql);
    const result = await this.query(converted, params);
    return result.rows[0];
  }

  async all(...params: unknown[]): Promise<unknown[]> {
    const converted = convertPlaceholders(this.sql);
    const result = await this.query(converted, params);
    return result.rows;
  }
}

export class PgDbAdapter implements DbAdapter {
  private pool: Pool;
  private txClient: PoolClient | null = null;

  constructor(connectionString: string) {
    if (!PgPool) {
      throw new Error("PostgreSQL driver 'pg' is not installed. Run: npm install pg");
    }
    this.pool = new PgPool({ connectionString, max: 20 });
  }

  private getQueryFn() {
    return this.txClient
      ? (sql: string, values?: unknown[]) => this.txClient!.query(sql, values)
      : (sql: string, values?: unknown[]) => this.pool.query(sql, values);
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

  transaction<T>(fn: () => T | Promise<T>): () => Promise<T> {
    return async () => {
      const client = await this.pool.connect();
      const previousTxClient = this.txClient;
      this.txClient = client;
      try {
        await client.query("BEGIN");
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
