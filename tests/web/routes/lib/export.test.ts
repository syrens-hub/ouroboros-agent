import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { dirname } from "path";
import Database from "better-sqlite3";
import { DB_PATH, OUT_DIR, exportTrajectories } from "../../../../web/routes/lib/export.ts";

describe("export trajectories", () => {
  beforeEach(() => {
    const dbDir = dirname(DB_PATH);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    const db = new Database(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS trajectories (
      session_id TEXT PRIMARY KEY,
      entries TEXT NOT NULL,
      outcome TEXT,
      compressed INTEGER DEFAULT 0
    );`);
    db.close();
  });

  afterEach(() => {
    if (existsSync(DB_PATH)) {
      try {
        const dbDir = dirname(DB_PATH);
        rmSync(dbDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    if (existsSync(OUT_DIR)) {
      rmSync(OUT_DIR, { recursive: true, force: true });
    }
  });

  it("throws when database not found", async () => {
    // temporarily move db away
    const dbDir = dirname(DB_PATH);
    const backup = dbDir + "-backup";
    if (existsSync(dbDir)) {
      rmSync(backup, { recursive: true, force: true });
      // Can't rename across devices reliably; just remove db file
      rmSync(DB_PATH, { force: true });
    }
    await expect(exportTrajectories()).rejects.toThrow("Database not found");
  });

  it("exports trajectories to JSONL", async () => {
    const db = new Database(DB_PATH);
    db.prepare(
      "INSERT INTO trajectories (session_id, entries, outcome, compressed) VALUES (?, ?, ?, ?)"
    ).run(
      "sess-1",
      JSON.stringify([
        {
          messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi!" },
          ],
          outcome: "success",
        },
      ]),
      "success",
      0
    );
    db.close();

    const result = await exportTrajectories();
    expect(result.count).toBe(1);
    expect(existsSync(result.path)).toBe(true);

    const lines = readFileSync(result.path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const conv = JSON.parse(lines[0]);
    expect(conv.metadata.session_id).toBe("sess-1");
    expect(conv.metadata.outcome).toBe("success");
    expect(conv.metadata.turn_count).toBe(1);
    expect(conv.conversations.length).toBe(3);
    expect(conv.conversations[0].from).toBe("system");
    expect(conv.conversations[1].from).toBe("human");
    expect(conv.conversations[2].from).toBe("gpt");
  });

  it("handles compressed flag and empty entries gracefully", async () => {
    const db = new Database(DB_PATH);
    db.prepare(
      "INSERT INTO trajectories (session_id, entries, outcome, compressed) VALUES (?, ?, ?, ?)"
    ).run(
      "sess-empty",
      JSON.stringify([]),
      "unknown",
      1
    );
    db.close();

    const result = await exportTrajectories();
    expect(result.count).toBe(1);
    const lines = readFileSync(result.path, "utf-8").trim().split("\n");
    const conv = JSON.parse(lines[0]);
    expect(conv.metadata.compressed).toBe(true);
    expect(conv.metadata.turn_count).toBe(0);
    expect(conv.metadata.outcome).toBe("unknown");
  });
});
