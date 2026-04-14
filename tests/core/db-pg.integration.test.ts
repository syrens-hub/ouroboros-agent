import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isPgAvailable, PgDbAdapter } from "../../core/db-pg.ts";
import { initSchema } from "../../core/db-manager.ts";
import { appConfig } from "../../core/config.ts";

const shouldRun = process.env.TEST_POSTGRES === "1" && isPgAvailable() && process.env.DATABASE_URL;

describe.skipIf(!shouldRun)("PostgreSQL Adapter Integration", () => {
  let db: PgDbAdapter;
  const originalUsePostgres = appConfig.db.usePostgres;

  beforeAll(async () => {
    appConfig.db.usePostgres = true;
    db = new PgDbAdapter(process.env.DATABASE_URL!);
    await db.exec(
      `DROP TABLE IF EXISTS messages, sessions, trajectories, skill_registry, modifications, migrations CASCADE`
    );
    await initSchema(db);
  });

  afterAll(async () => {
    await db.exec(
      `DROP TABLE IF EXISTS messages, sessions, trajectories, skill_registry, modifications, migrations CASCADE`
    );
    await db.close();
    appConfig.db.usePostgres = originalUsePostgres;
  });

  it("creates and reads a session", async () => {
    await db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run("pg_test_1", "Test Session");
    const row = await db.prepare("SELECT * FROM sessions WHERE id = ?").get("pg_test_1");
    expect(row).toBeDefined();
    expect((row as { title: string }).title).toBe("Test Session");
  });

  it("inserts and retrieves messages", async () => {
    await db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run("pg_test_1", "user", "hello world");
    const rows = (await db.prepare("SELECT * FROM messages WHERE session_id = ?").all("pg_test_1")) as { content: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].content).toBe("hello world");
  });

  it("uses full-text search via tsvector", async () => {
    const rows = (await db
      .prepare(
        "SELECT session_id, content FROM messages WHERE search_vector @@ plainto_tsquery('simple', ?) LIMIT ?"
      )
      .all("hello", 10)) as { session_id: string; content: string }[];
    expect(rows.length).toBeGreaterThan(0);
  });

  it("upserts skill registry", async () => {
    await db
      .prepare(
        `INSERT INTO skill_registry (name, directory, frontmatter, auto_load)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET directory = excluded.directory`
      )
      .run("test-skill", "/tmp/test-skill", "{}", 0);
    const row = await db.prepare("SELECT * FROM skill_registry WHERE name = ?").get("test-skill");
    expect(row).toBeDefined();
    expect((row as { directory: string }).directory).toBe("/tmp/test-skill");
  });

  it("logs modifications", async () => {
    await db
      .prepare(
        `INSERT INTO modifications (session_id, type, description, rationale, estimated_risk, decision, executed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("pg_test_1", "test", "desc", "rationale", "low", "approved", 1);
    const rows = (await db.prepare("SELECT * FROM modifications WHERE type = ?").all("test")) as { decision: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].decision).toBe("approved");
  });

  describe("transaction atomicity", () => {
    it("commits all changes on success", async () => {
      await db.prepare("DELETE FROM sessions WHERE id LIKE 'tx_test_%'").run();
      const tx = db.transaction(async () => {
        await db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run("tx_test_a", "A");
        await db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run("tx_test_b", "B");
      });
      await tx();
      const a = await db.prepare("SELECT * FROM sessions WHERE id = ?").get("tx_test_a");
      const b = await db.prepare("SELECT * FROM sessions WHERE id = ?").get("tx_test_b");
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });

    it("rolls back all changes on failure", async () => {
      await db.prepare("DELETE FROM sessions WHERE id LIKE 'tx_test_%'").run();
      const tx = db.transaction(async () => {
        await db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run("tx_test_c", "C");
        throw new Error("intentional failure");
      });
      await expect(tx()).rejects.toThrow("intentional failure");
      const c = await db.prepare("SELECT * FROM sessions WHERE id = ?").get("tx_test_c");
      expect(c).toBeUndefined();
    });

    it("nested prepare inside transaction uses the same client", async () => {
      await db.prepare("DELETE FROM sessions WHERE id = ?").run("tx_test_d");
      const tx = db.transaction(async () => {
        await db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run("tx_test_d", "D");
        // Verify that we can read the uncommitted row within the same transaction
        const row = await db.prepare("SELECT * FROM sessions WHERE id = ?").get("tx_test_d");
        if (!row) {
          throw new Error("Row not visible inside transaction — client was not propagated");
        }
      });
      await tx();
      const d = await db.prepare("SELECT * FROM sessions WHERE id = ?").get("tx_test_d");
      expect(d).toBeDefined();
    });
  });
});
