import { getDb } from "../db-manager.ts";
import { appConfig } from "../config.ts";
import { timedQuery } from "../../skills/telemetry/index.ts";
import { safeFailOpenAsync } from "../safe-utils.ts";
import type { BaseMessage, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";
import { clearSessionState } from "../session-state.ts";

export async function createSession(
  id: string,
  opts: {
    parentSessionId?: string;
    title?: string;
    model?: string;
    provider?: string;
  } = {}
): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("session:createSession", async () => {
      await db
        .prepare(
          `INSERT INTO sessions (id, parent_session_id, title, model, provider)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, opts.parentSessionId || null, opts.title || null, opts.model || null, opts.provider || null);
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getSession(id: string, includeDeleted = false): Promise<Result<Record<string, unknown> | null>> {
  try {
    const db = getDb();
    return await timedQuery("session:getSession", async () => {
      const sql = includeDeleted
        ? "SELECT * FROM sessions WHERE id = ?"
        : "SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL";
      const row = (await db.prepare(sql).get(id)) as Record<string, unknown> | undefined;
      return ok(row || null);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function listSessions(
  includeDeleted = false
): Promise<Array<{ sessionId: string; title?: string; status?: string; createdAt?: number }>> {
  return safeFailOpenAsync(async () => {
    const db = getDb();
    return await timedQuery("session:listSessions", async () => {
      const sql = includeDeleted
        ? "SELECT id, title, status, created_at FROM sessions ORDER BY created_at DESC"
        : "SELECT id, title, status, created_at FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC";
      const rows = (await db.prepare(sql).all()) as {
        id: string;
        title: string | null;
        status: string | null;
        created_at: number | null;
      }[];
      return rows.map((r) => ({
        sessionId: r.id,
        title: r.title || undefined,
        status: r.status || undefined,
        createdAt: r.created_at || undefined,
      }));
    });
  }, "listSessions DB error", []);
}

const SESSION_COLUMNS = new Set([
  "parent_session_id",
  "title",
  "model",
  "provider",
  "status",
  "message_count",
  "tool_call_count",
  "turn_count",
  "estimated_cost_usd",
]);

export async function updateSession(id: string, fields: Record<string, unknown>): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("session:updateSession", async () => {
      const keys = Object.keys(fields);
      if (keys.length === 0) return ok(undefined);
      for (const k of keys) {
        if (!SESSION_COLUMNS.has(k)) {
          return err({ code: "INVALID_FIELD", message: `Column '${k}' is not allowed in session updates.` });
        }
      }
      const setClause = keys.map((k) => `${k} = ?`).join(", ");
      const stmt = db.prepare(`UPDATE sessions SET ${setClause}, updated_at = ? WHERE id = ?`);
      await stmt.run(...keys.map((k) => fields[k]), Date.now(), id);
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function deleteSession(id: string, hard = false): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("session:deleteSession", async () => {
      if (hard) {
        await db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
      } else {
        await db.prepare("UPDATE sessions SET deleted_at = ?, status = 'deleted' WHERE id = ? AND deleted_at IS NULL").run(Date.now(), id);
      }
      clearSessionState(id);
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function pruneDeletedSessions(olderThanMs: number): Promise<Result<number>> {
  try {
    const db = getDb();
    return await timedQuery("session:pruneDeletedSessions", async () => {
      const threshold = Date.now() - olderThanMs;
      const result = await db.prepare("DELETE FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(threshold);
      return ok(Number(result.changes ?? 0));
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getStaleSessions(cutoffMs: number): Promise<Result<{ sessionId: string; updatedAt: number }[]>> {
  try {
    const db = getDb();
    return await timedQuery("session:getStaleSessions", async () => {
      const rows = (await db.prepare("SELECT id, updated_at FROM sessions WHERE updated_at < ?").all(cutoffMs)) as {
        id: string;
        updated_at: number;
      }[];
      return ok(rows.map((r) => ({ sessionId: r.id, updatedAt: r.updated_at })));
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function splitSession(
  oldSessionId: string,
  newSessionId: string,
  summaryMessages: BaseMessage[]
): Promise<Result<void>> {
  try {
    const db = getDb();
    const oldSession = await getSession(oldSessionId);
    if (!oldSession.success || !oldSession.data) {
      return err({ code: "SESSION_NOT_FOUND", message: `Session ${oldSessionId} not found` });
    }

    const data = oldSession.data;
    const title = (data.title as string) || "Session";
    const nextTitle = title.match(/#(\d+)$/) ? title.replace(/#(\d+)$/, (_, n) => `#${parseInt(n) + 1}`) : `${title} #2`;
    const model = data.model as string | undefined;
    const provider = data.provider as string | undefined;

    const insertSession = db.prepare(
      `INSERT INTO sessions (id, parent_session_id, title, model, provider, status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (session_id, role, content, name, tool_calls)
       VALUES (?, ?, ?, ?, ?)`
    );
    const updateOld = db.prepare(`UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?`);

    const isPostgres = appConfig.db.usePostgres;
    if (isPostgres) {
      const atomic = db.transaction(async () => {
        await insertSession.run(newSessionId, oldSessionId, nextTitle, model || null, provider || null);
        for (const msg of summaryMessages) {
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          await insertMessage.run(newSessionId, msg.role, content, msg.name || null, null);
        }
        await updateOld.run("compressed", Date.now(), oldSessionId);
      });
      await timedQuery("session:splitSession", async () => {
        await atomic();
      });
    } else {
      const atomic = db.transaction(() => {
        insertSession.run(newSessionId, oldSessionId, nextTitle, model || null, provider || null);
        for (const msg of summaryMessages) {
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          insertMessage.run(newSessionId, msg.role, content, msg.name || null, null);
        }
        updateOld.run("compressed", Date.now(), oldSessionId);
      });
      timedQuery("session:splitSession", async () => {
        atomic();
      });
    }
    return ok(undefined);
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}
