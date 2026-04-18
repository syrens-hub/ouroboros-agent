/**
 * Channel Registry
 * ================
 * Maintains a registry of ChannelPlugins and binds them to sessions via SQLite.
 */

import type { ChannelPlugin } from "../types/index.ts";
import { getDb } from "./db-manager.ts";

export class ChannelRegistry {
  private plugins = new Map<string, ChannelPlugin>();
  private tableEnsured = false;

  constructor() {
    // Lazy-init: do NOT call ensureTable here to avoid SQLite lock
    // contention during parallel test imports in forked workers.
  }

  private ensureTable(): void {
    if (this.tableEnsured) return;
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_channels (
        session_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        config_json TEXT DEFAULT '{}'
      );
    `);
    this.tableEnsured = true;
  }

  register(plugin: ChannelPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): ChannelPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }

  getChannelForSession(sessionId: string): ChannelPlugin | undefined {
    this.ensureTable();
    const db = getDb();
    const stmt = db.prepare("SELECT channel_id FROM session_channels WHERE session_id = ?");
    const row = stmt.get(sessionId) as { channel_id: string } | undefined;
    if (!row) return undefined;
    return this.plugins.get(row.channel_id);
  }

  bindSession(sessionId: string, channelId: string, config?: Record<string, unknown>): void {
    this.ensureTable();
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO session_channels (session_id, channel_id, config_json)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        config_json = excluded.config_json;
    `);
    stmt.run(sessionId, channelId, JSON.stringify(config || {}));
  }
}

let _channelRegistry: ChannelRegistry | null = null;

export function getChannelRegistry(): ChannelRegistry {
  if (!_channelRegistry) {
    _channelRegistry = new ChannelRegistry();
  }
  return _channelRegistry;
}
