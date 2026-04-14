import { getDb } from "../db-manager.ts";
import { timedQuery } from "../telemetry.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

export async function getMemoryRecalls24h(): Promise<Result<number>> {
  try {
    const db = getDb();
    return await timedQuery("memoryRecalls:getMemoryRecalls24h", async () => {
      const row = (await db
        .prepare("SELECT COUNT(*) as count FROM memory_recalls WHERE timestamp > ?")
        .get(Date.now() - 24 * 60 * 60 * 1000)) as { count: number } | undefined;
      return ok(Number(row?.count ?? 0));
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getMemoryRecallStats(
  days = 7
): Promise<
  Result<{
    totalRecalls: number;
    avgTopScore: number;
    uniqueQueries: number;
    topSessions: { sessionId: string; count: number }[];
  }>
> {
  try {
    const db = getDb();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    return await timedQuery("memoryRecalls:getMemoryRecallStats", async () => {
      const totalRow = (await db
        .prepare("SELECT COUNT(*) as count FROM memory_recalls WHERE timestamp > ?")
        .get(since)) as { count: number } | undefined;
      const scoreRow = (await db
        .prepare("SELECT AVG(top_score) as avg FROM memory_recalls WHERE timestamp > ?")
        .get(since)) as { avg: number | null } | undefined;
      const uniqueRow = (await db
        .prepare("SELECT COUNT(DISTINCT query) as count FROM memory_recalls WHERE timestamp > ?")
        .get(since)) as { count: number } | undefined;
      const topSessions = (await db
        .prepare(
          `SELECT session_id, COUNT(*) as count FROM memory_recalls WHERE timestamp > ? GROUP BY session_id ORDER BY count DESC LIMIT 10`
        )
        .all(since)) as { session_id: string; count: number }[];

      return ok({
        totalRecalls: Number(totalRow?.count ?? 0),
        avgTopScore: Number(scoreRow?.avg ?? 0),
        uniqueQueries: Number(uniqueRow?.count ?? 0),
        topSessions: topSessions.map((r) => ({ sessionId: r.session_id, count: Number(r.count) })),
      });
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}
