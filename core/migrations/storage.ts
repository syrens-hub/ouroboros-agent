/**
 * Umzug Storage backed by DbAdapter.
 * Reuses the existing `migrations` table for backward compatibility.
 */

import type { UmzugStorage } from "umzug";
import type { DbAdapter } from "../db-adapter.ts";

export class DbMigrationStorage implements UmzugStorage<{ db: DbAdapter; isPostgres: boolean }> {
  constructor(private readonly db: DbAdapter, private readonly isPostgres: boolean) {}

  private async ensureTable(): Promise<void> {
    const createSql = this.isPostgres
      ? `CREATE TABLE IF NOT EXISTS umzug_migrations (
           name TEXT PRIMARY KEY,
           applied_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint
         )`
      : `CREATE TABLE IF NOT EXISTS umzug_migrations (
           name TEXT PRIMARY KEY,
           applied_at INTEGER DEFAULT (unixepoch()*1000)
         )`;
    await this.db.exec(createSql);
  }

  async logMigration({ name }: { name: string }): Promise<void> {
    await this.ensureTable();
    if (this.isPostgres) {
      await this.db
        .prepare("INSERT INTO umzug_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING")
        .run(name);
    } else {
      this.db.prepare("INSERT OR IGNORE INTO umzug_migrations (name) VALUES (?)").run(name);
    }
  }

  async unlogMigration({ name }: { name: string }): Promise<void> {
    await this.ensureTable();
    if (this.isPostgres) {
      await this.db.prepare("DELETE FROM umzug_migrations WHERE name = $1").run(name);
    } else {
      this.db.prepare("DELETE FROM umzug_migrations WHERE name = ?").run(name);
    }
  }

  async executed(): Promise<string[]> {
    await this.ensureTable();
    if (this.isPostgres) {
      const rows = (await this.db.prepare("SELECT name FROM umzug_migrations ORDER BY name").all()) as {
        name: string;
      }[];
      return rows.map((r) => r.name);
    } else {
      const rows = this.db.prepare("SELECT name FROM umzug_migrations ORDER BY name").all() as {
        name: string;
      }[];
      return rows.map((r) => r.name);
    }
  }
}

/**
 * Synchronous storage for SQLite initialization within getDb().
 * SQLite db operations are sync, so we can avoid async/await churn.
 */
export class SyncDbMigrationStorage {
  constructor(private readonly db: DbAdapter) {}

  private ensureTable(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS umzug_migrations (
         name TEXT PRIMARY KEY,
         applied_at INTEGER DEFAULT (unixepoch()*1000)
       )`
    );
  }

  logMigration({ name }: { name: string }): void {
    this.ensureTable();
    this.db.prepare("INSERT OR IGNORE INTO umzug_migrations (name) VALUES (?)").run(name);
  }

  unlogMigration({ name }: { name: string }): void {
    this.ensureTable();
    this.db.prepare("DELETE FROM umzug_migrations WHERE name = ?").run(name);
  }

  executed(): string[] {
    this.ensureTable();
    const rows = this.db.prepare("SELECT name FROM umzug_migrations ORDER BY name").all() as {
      name: string;
    }[];
    return rows.map((r) => r.name);
  }
}
