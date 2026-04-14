import { getDb } from "../db-manager.ts";
import { timedQuery } from "../telemetry.ts";
import type { TrajectoryEntry, Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

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
      return ok(rows.map((r) => JSON.parse(r.entries)));
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}
