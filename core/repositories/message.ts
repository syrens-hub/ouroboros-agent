import { getDb } from "../db-manager.ts";
import { appConfig } from "../config.ts";
import { timedQuery } from "../telemetry.ts";
import type { BaseMessage, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

export async function appendMessage(
  sessionId: string,
  msg: BaseMessage,
  opts: { toolCalls?: unknown[] } = {}
): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("message:appendMessage", async () => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      await db
        .prepare(
          `INSERT INTO messages (session_id, role, content, name, tool_calls)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(sessionId, msg.role, content, msg.name || null, opts.toolCalls ? JSON.stringify(opts.toolCalls) : null);
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getMessages(
  sessionId: string,
  opts: { limit?: number; offset?: number; beforeId?: number } = {}
): Promise<Result<BaseMessage[]>> {
  try {
    const db = getDb();
    return await timedQuery("message:getMessages", async () => {
      let sql = "SELECT id, role, content, name FROM messages WHERE session_id = ?";
      const params: (string | number)[] = [sessionId];
      if (opts.beforeId !== undefined) {
        sql += " AND id < ?";
        params.push(opts.beforeId);
      }
      sql += " ORDER BY id DESC";
      if (opts.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(opts.limit);
      }
      if (opts.offset !== undefined) {
        sql += " OFFSET ?";
        params.push(opts.offset);
      }
      const rows = (await db.prepare(sql).all(...params)) as { id: number; role: string; content: string; name?: string }[];
      // Return in chronological order
      rows.reverse();

      const messages: BaseMessage[] = rows.map((r) => {
        let content: BaseMessage["content"] = r.content;
        try {
          const parsed = JSON.parse(r.content);
          if (Array.isArray(parsed) || typeof parsed === "object") content = parsed as BaseMessage["content"];
        } catch {
          // keep as string
        }
        return {
          role: r.role as BaseMessage["role"],
          content,
          name: r.name,
        };
      });
      return ok(messages);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function searchMessages(
  query: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<Result<{ sessionId: string; content: string }[]>> {
  try {
    const db = getDb();
    return await timedQuery("message:searchMessages", async () => {
      const isPostgres = appConfig.db.usePostgres;
      const limit = opts.limit ?? 10;
      const offset = opts.offset ?? 0;
      const sql = isPostgres
        ? `SELECT session_id, content
           FROM messages
           WHERE search_vector @@ plainto_tsquery('simple', ?)
           LIMIT ? OFFSET ?`
        : `SELECT m.session_id, m.content
           FROM messages_fts fts
           JOIN messages m ON m.id = fts.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ? OFFSET ?`;
      const rows = (await db.prepare(sql).all(query, limit, offset)) as { session_id: string; content: string }[];
      return ok(rows.map((r) => ({ sessionId: r.session_id, content: r.content })));
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function deleteSessionMessages(sessionId: string): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("message:deleteSessionMessages", async () => {
      await db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}
