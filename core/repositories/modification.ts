import { getDb } from "../db-manager.ts";
import { timedQuery } from "../telemetry.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

export async function logModification(
  sessionId: string | undefined,
  req: {
    type: string;
    description: string;
    rationale: string;
    estimatedRisk: string;
  },
  decision: string,
  executed: boolean,
  fingerprint?: string
): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("modification:logModification", async () => {
      await db
        .prepare(
          `INSERT INTO modifications (session_id, type, description, rationale, estimated_risk, decision, executed, fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId || null,
          req.type,
          req.description,
          req.rationale,
          req.estimatedRisk,
          decision,
          executed ? 1 : 0,
          fingerprint || null
        );
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function isModificationFingerprintRecent(fingerprint: string, withinMs = 24 * 60 * 60 * 1000): Promise<boolean> {
  try {
    const db = getDb();
    return await timedQuery("modification:isModificationFingerprintRecent", async () => {
      const row = await db
        .prepare("SELECT 1 FROM modifications WHERE fingerprint = ? AND timestamp > ? LIMIT 1")
        .get(fingerprint, Date.now() - withinMs);
      return !!row;
    });
  } catch {
    return false;
  }
}
