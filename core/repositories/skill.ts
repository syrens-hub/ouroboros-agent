import { getDb } from "../db-manager.ts";
import { timedQuery } from "../../skills/telemetry/index.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

export async function upsertSkillRegistry(
  name: string,
  directory: string,
  frontmatter: Record<string, unknown>,
  autoLoad = false,
  securityScan?: string,
  trustLevel?: string
): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("skill:upsertSkillRegistry", async () => {
      const stmt = db.prepare(
        `INSERT INTO skill_registry (name, directory, frontmatter, auto_load, updated_at, security_scan, trust_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           directory = excluded.directory,
           frontmatter = excluded.frontmatter,
           auto_load = excluded.auto_load,
           updated_at = excluded.updated_at,
           security_scan = COALESCE(excluded.security_scan, security_scan),
           trust_level = COALESCE(excluded.trust_level, trust_level),
           usage_count = usage_count + 1`
      );
      await stmt.run(
        name,
        directory,
        JSON.stringify(frontmatter),
        autoLoad ? 1 : 0,
        Date.now(),
        securityScan ?? null,
        trustLevel ?? null
      );
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getSkillRegistry(): Promise<
  Result<{ name: string; directory: string; frontmatter: string; autoLoad: number; usageCount: number; securityScan?: string; trustLevel?: string }[]>
> {
  try {
    const db = getDb();
    return await timedQuery("skill:getSkillRegistry", async () => {
      const rows = (await db
        .prepare(
          "SELECT name, directory, frontmatter, auto_load as autoLoad, usage_count as usageCount, security_scan as securityScan, trust_level as trustLevel FROM skill_registry ORDER BY updated_at DESC"
        )
        .all()) as { name: string; directory: string; frontmatter: string; autoLoad: number; usageCount: number; securityScan?: string; trustLevel?: string }[];
      return ok(rows);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}
