import { getDb } from "../db-manager.ts";
import { timedQuery } from "../telemetry.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

export async function upsertSkillRegistry(
  name: string,
  directory: string,
  frontmatter: Record<string, unknown>,
  autoLoad = false
): Promise<Result<void>> {
  try {
    const db = getDb();
    return await timedQuery("skill:upsertSkillRegistry", async () => {
      const stmt = db.prepare(
        `INSERT INTO skill_registry (name, directory, frontmatter, auto_load, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           directory = excluded.directory,
           frontmatter = excluded.frontmatter,
           auto_load = excluded.auto_load,
           updated_at = excluded.updated_at,
           usage_count = usage_count + 1`
      );
      await stmt.run(name, directory, JSON.stringify(frontmatter), autoLoad ? 1 : 0, Date.now());
      return ok(undefined);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}

export async function getSkillRegistry(): Promise<
  Result<{ name: string; directory: string; frontmatter: string; autoLoad: number; usageCount: number }[]>
> {
  try {
    const db = getDb();
    return await timedQuery("skill:getSkillRegistry", async () => {
      const rows = (await db
        .prepare(
          "SELECT name, directory, frontmatter, auto_load as autoLoad, usage_count as usageCount FROM skill_registry ORDER BY updated_at DESC"
        )
        .all()) as { name: string; directory: string; frontmatter: string; autoLoad: number; usageCount: number }[];
      return ok(rows);
    });
  } catch (e) {
    return err({ code: "DB_ERROR", message: String(e) });
  }
}
