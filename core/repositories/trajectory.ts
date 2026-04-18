import { getDb } from "../db-manager.ts";
import { timedQuery } from "../../skills/telemetry/index.ts";
import type { TrajectoryEntry, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";
import { safeJsonParse } from "../safe-utils.ts";

export async function saveTrajectory(
  sessionId: string,
  entries: TrajectoryEntry[],
  outcome: string,
  summary?: string,
  compressed = false
): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("trajectory:saveTrajectory", async () => {
      await db
        .prepare(
          `INSERT INTO trajectories (session_id, turn, entries, outcome, summary, compressed)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(sessionId, entries.length, JSON.stringify(entries), outcome, summary || null, compressed ? 1 : 0);
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getTrajectories(sessionId: string): Promise<Result<TrajectoryEntry[][]>> {
  try {
    const db = getDb();
    return await timedQuery("trajectory:getTrajectories", async () => {
      const rows = (await db
        .prepare("SELECT entries FROM trajectories WHERE session_id = ? ORDER BY id ASC")
        .all(sessionId)) as { entries: string }[];
      return ok(rows.map((r) => safeJsonParse<TrajectoryEntry[]>(r.entries, "trajectory entries") ?? []));
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

// =============================================================================
// Trace Events — fine-grained llm_call / tool_call audit
// =============================================================================

export interface TraceEvent {
  traceId: string;
  sessionId: string;
  turn: number;
  timestamp: number;
  type: "llm_call" | "tool_call" | "tool_result" | "progress";
  actor: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
  tokens?: number;
}

function truncate(str: string, max = 4096): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "\n...[truncated]";
}

export async function saveTraceEvent(event: TraceEvent): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("trajectory:saveTraceEvent", async () => {
      await db
        .prepare(
          `INSERT INTO trace_events (trace_id, session_id, turn, timestamp, type, actor, input, output, latency_ms, tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.traceId,
          event.sessionId,
          event.turn,
          event.timestamp,
          event.type,
          event.actor,
          event.input != null ? truncate(JSON.stringify(event.input)) : null,
          event.output != null ? truncate(JSON.stringify(event.output)) : null,
          event.latencyMs ?? null,
          event.tokens ?? null
        );
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getTraceEvents(sessionId: string, turn?: number): Promise<Result<TraceEvent[]>> {
  try {
    const db = getDb();
    return await timedQuery("trajectory:getTraceEvents", async () => {
      const sql = turn !== undefined
        ? "SELECT * FROM trace_events WHERE session_id = ? AND turn = ? ORDER BY timestamp ASC"
        : "SELECT * FROM trace_events WHERE session_id = ? ORDER BY timestamp ASC";
      const params = turn !== undefined ? [sessionId, turn] : [sessionId];
      const rows = (await db.prepare(sql).all(...params)) as Array<{
        trace_id: string;
        session_id: string;
        turn: number;
        timestamp: number;
        type: TraceEvent["type"];
        actor: string;
        input: string | null;
        output: string | null;
        latency_ms: number | null;
        tokens: number | null;
      }>;
      return ok(
        rows.map((r) => ({
          traceId: r.trace_id,
          sessionId: r.session_id,
          turn: r.turn,
          timestamp: r.timestamp,
          type: r.type,
          actor: r.actor,
          input: r.input ? safeJsonParse(r.input, "trace input") : undefined,
          output: r.output ? safeJsonParse(r.output, "trace output") : undefined,
          latencyMs: r.latency_ms ?? undefined,
          tokens: r.tokens ?? undefined,
        }))
      );
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}
