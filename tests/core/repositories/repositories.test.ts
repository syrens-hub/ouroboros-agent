import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appConfig } from "../../../core/config.ts";
import { resetDbSingleton, getDb } from "../../../core/db-manager.ts";
import { existsSync, unlinkSync } from "fs";
import { join, basename } from "path";

const originalUsePostgres = appConfig.db.usePostgres;

vi.mock("../../../skills/telemetry/index.ts", () => ({
  timedQuery: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../../core/session-state.ts", () => ({
  clearSessionState: vi.fn(),
  resetSessionStateForTests: vi.fn(),
  getSessionState: vi.fn(() => ({
    tokenCounters: { totalInput: 0, totalOutput: 0, totalCostUSD: 0 },
    modelOverrides: {},
    caches: {},
    otel: {},
  })),
  sessionStateShutdown: vi.fn(),
}));

import { clearSessionState } from "../../../core/session-state.ts";

import {
  insertTokenUsage,
  getSessionTokenUsage,
} from "../../../core/repositories/token-usage.ts";
import {
  saveTraceEvent,
  getTraceEvents,
  saveTrajectory,
  getTrajectories,
} from "../../../core/repositories/trajectory.ts";
import {
  createSession,
  getSession,
  updateSession,
  listSessions,
  deleteSession,
} from "../../../core/repositories/session.ts";
import {
  insertMemoryLayer,
  searchMemoryLayers,
  queryMemoryLayers,
} from "../../../core/repositories/memory-layers.ts";
import {
  appendMessage,
  getMessages,
} from "../../../core/repositories/message.ts";

function getTestDbPath(): string {
  const configuredPath = appConfig.database.sqlite.path;
  const baseDir = configuredPath.startsWith("/")
    ? configuredPath.slice(0, configuredPath.lastIndexOf("/"))
    : join(process.cwd(), configuredPath.slice(0, configuredPath.lastIndexOf("/")));
  const dir = process.env.VITEST && appConfig.db.dir === ".ouroboros"
    ? join(baseDir, `vitest-${process.env.VITEST_POOL_ID || process.pid}`)
    : baseDir;
  return join(dir, basename(configuredPath));
}

function removeTestDbFile(): void {
  const dbPath = getTestDbPath();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

describe("core/repositories", () => {
  beforeEach(() => {
    appConfig.db.usePostgres = false;
    resetDbSingleton();
    removeTestDbFile();
  });

  afterEach(() => {
    appConfig.db.usePostgres = originalUsePostgres;
    resetDbSingleton();
  });

  // ==========================================================================
  // token-usage
  // ==========================================================================
  describe("token-usage", () => {
    it("inserts token usage and returns an id", () => {
      const result = insertTokenUsage("sess-tu-1", 150);
      expect(result.success).toBe(true);
      expect(result).toHaveProperty("id");
      expect(typeof (result as { success: true; id: number }).id).toBe("number");
      expect((result as { success: true; id: number }).id).toBeGreaterThan(0);
    });

    it("retrieves total session token usage", () => {
      insertTokenUsage("sess-tu-2", 100);
      insertTokenUsage("sess-tu-2", 200);
      insertTokenUsage("sess-tu-3", 50);

      expect(getSessionTokenUsage("sess-tu-2")).toBe(300);
      expect(getSessionTokenUsage("sess-tu-3")).toBe(50);
      expect(getSessionTokenUsage("nonexistent")).toBe(0);
    });

    it("returns 0 for a session with no token usage", () => {
      expect(getSessionTokenUsage("empty-sess")).toBe(0);
    });
  });

  // ==========================================================================
  // trajectory
  // ==========================================================================
  describe("trajectory", () => {
    it("saves a trace event", async () => {
      await createSession("traj-sess-1", {});
      const event = {
        traceId: "trace-1",
        sessionId: "traj-sess-1",
        turn: 1,
        timestamp: Date.now(),
        type: "llm_call" as const,
        actor: "test",
        input: { prompt: "hello" },
        output: { response: "world" },
        latencyMs: 42,
        tokens: 10,
      };
      const result = await saveTraceEvent(event);
      expect(result.success).toBe(true);
    });

    it("retrieves trace events for a session in timestamp order", async () => {
      await createSession("traj-sess-2", {});
      const event1 = {
        traceId: "trace-a",
        sessionId: "traj-sess-2",
        turn: 1,
        timestamp: 1000,
        type: "llm_call" as const,
        actor: "agent",
      };
      const event2 = {
        traceId: "trace-b",
        sessionId: "traj-sess-2",
        turn: 2,
        timestamp: 2000,
        type: "tool_call" as const,
        actor: "tool",
        input: { name: "read" },
      };
      await saveTraceEvent(event1);
      await saveTraceEvent(event2);

      const result = await getTraceEvents("traj-sess-2");
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.length).toBe(2);
      expect(result.data[0].traceId).toBe("trace-a");
      expect(result.data[1].traceId).toBe("trace-b");
      expect(result.data[1].input).toEqual({ name: "read" });
    });

    it("filters trace events by turn", async () => {
      await createSession("traj-sess-3", {});
      await saveTraceEvent({
        traceId: "trace-1",
        sessionId: "traj-sess-3",
        turn: 5,
        timestamp: 1000,
        type: "progress" as const,
        actor: "system",
      });
      await saveTraceEvent({
        traceId: "trace-2",
        sessionId: "traj-sess-3",
        turn: 6,
        timestamp: 2000,
        type: "llm_call" as const,
        actor: "agent",
      });

      const result = await getTraceEvents("traj-sess-3", 5);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.length).toBe(1);
      expect(result.data[0].turn).toBe(5);
    });

    it("saves and retrieves trajectories", async () => {
      await createSession("traj-sess-4", {});
      const entries = [
        {
          turn: 1,
          messages: [{ role: "user" as const, content: "hi" }],
          toolCalls: [],
          outcome: "success" as const,
        },
      ];
      const saveResult = await saveTrajectory("traj-sess-4", entries, "success");
      expect(saveResult.success).toBe(true);

      const getResult = await getTrajectories("traj-sess-4");
      expect(getResult.success).toBe(true);
      if (!getResult.success) return;
      expect(getResult.data.length).toBe(1);
      expect(getResult.data[0]).toEqual(entries);
    });
  });

  // ==========================================================================
  // session
  // ==========================================================================
  describe("session", () => {
    it("creates a session", async () => {
      const result = await createSession("sess-create", {
        title: "Test",
        model: "gpt-4",
        provider: "openai",
      });
      expect(result.success).toBe(true);
    });

    it("gets a session by id", async () => {
      await createSession("sess-get", { title: "Get Me" });
      const result = await getSession("sess-get");
      expect(result.success).toBe(true);
      if (!result.success || !result.data) throw new Error("Expected data");
      expect(result.data.id).toBe("sess-get");
      expect(result.data.title).toBe("Get Me");
    });

    it("returns null for missing session", async () => {
      const result = await getSession("missing-id");
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Expected success");
      expect(result.data).toBeNull();
    });

    it("updates allowed session fields", async () => {
      await createSession("sess-upd", { title: "Original" });
      const up = await updateSession("sess-upd", {
        title: "Updated",
        status: "archived",
        turn_count: 3,
      });
      expect(up.success).toBe(true);

      const got = await getSession("sess-upd");
      if (!got.success || !got.data) throw new Error("Expected data");
      expect(got.data.title).toBe("Updated");
      expect(got.data.status).toBe("archived");
      expect(got.data.turn_count).toBe(3);
    });

    it("rejects invalid update fields", async () => {
      await createSession("sess-bad", {});
      const up = await updateSession("sess-bad", {
        title: "OK",
        invalid_column: 1,
      } as Record<string, unknown>);
      expect(up.success).toBe(false);
    });

    it("lists sessions in descending creation order", async () => {
      await createSession("sess-a", { title: "A" });
      await createSession("sess-b", { title: "B" });
      const list = await listSessions();
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.some((s) => s.sessionId === "sess-a")).toBe(true);
      expect(list.some((s) => s.sessionId === "sess-b")).toBe(true);
    });

    it("soft-deletes a session", async () => {
      await createSession("sess-del", {});
      const del = await deleteSession("sess-del");
      expect(del.success).toBe(true);
      expect(clearSessionState).toHaveBeenCalledWith("sess-del");

      const got = await getSession("sess-del");
      if (!got.success) throw new Error("Expected success");
      expect(got.data).toBeNull();

      const gotWithDeleted = await getSession("sess-del", true);
      if (!gotWithDeleted.success || !gotWithDeleted.data)
        throw new Error("Expected data");
      expect(gotWithDeleted.data.status).toBe("deleted");
    });

    it("hard-deletes a session", async () => {
      await createSession("sess-hard", {});
      const del = await deleteSession("sess-hard", true);
      expect(del.success).toBe(true);
      expect(clearSessionState).toHaveBeenCalledWith("sess-hard");

      const got = await getSession("sess-hard", true);
      if (!got.success) throw new Error("Expected success");
      expect(got.data).toBeNull();
    });
  });

  // ==========================================================================
  // memory-layers
  // ==========================================================================
  describe("memory-layers", () => {
    it("inserts a memory layer and returns an id", () => {
      const result = insertMemoryLayer({
        session_id: "mem-sess",
        layer: "episodic",
        source_path: "/path/to/file.ts",
        content: "Important memory content",
        summary: "A summary",
        score: 0.95,
      });
      expect(result.success).toBe(true);
      expect(result).toHaveProperty("id");
      expect(typeof (result as { success: true; id: number }).id).toBe("number");
    });

    it("searches memory layers by query", () => {
      insertMemoryLayer({
        session_id: "mem-sess-2",
        layer: "semantic",
        source_path: null,
        content: "The quick brown fox jumps over the lazy dog",
        summary: "Animal sentence",
        score: 0.8,
      });
      insertMemoryLayer({
        session_id: "mem-sess-2",
        layer: "semantic",
        source_path: null,
        content: "Something completely different",
        summary: "Other content",
        score: 0.9,
      });

      const result = searchMemoryLayers({
        query: "fox",
        sessionId: "mem-sess-2",
        limit: 10,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.length).toBe(1);
      expect(result.data[0].content).toContain("fox");
    });

    it("includes global memory layers in search", () => {
      insertMemoryLayer({
        session_id: null,
        layer: "global",
        source_path: null,
        content: "Global knowledge about foxes",
        summary: "Global",
        score: 0.7,
      });

      const result = searchMemoryLayers({ query: "fox", limit: 10 });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(
        result.data.some((r) => r.content === "Global knowledge about foxes")
      ).toBe(true);
    });

    it("queries memory layers with filters", () => {
      insertMemoryLayer({
        session_id: "mem-sess-3",
        layer: "episodic",
        source_path: null,
        content: "High score entry",
        summary: "High",
        score: 0.99,
      });
      insertMemoryLayer({
        session_id: "mem-sess-3",
        layer: "semantic",
        source_path: null,
        content: "Low score entry",
        summary: "Low",
        score: 0.1,
      });

      const result = queryMemoryLayers({
        sessionId: "mem-sess-3",
        layers: ["episodic"],
        minScore: 0.5,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.length).toBe(1);
      expect(result.data[0].content).toBe("High score entry");
    });
  });

  // ==========================================================================
  // message
  // ==========================================================================
  describe("message", () => {
    it("appends messages and retrieves by session", async () => {
      await createSession("msg-sess", {});
      await appendMessage("msg-sess", { role: "user", content: "Hello" });
      await appendMessage("msg-sess", {
        role: "assistant",
        content: "Hi there",
      });

      const result = await getMessages("msg-sess");
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.length).toBe(2);
      expect(result.data[0].role).toBe("user");
      expect(result.data[0].content).toBe("Hello");
      expect(result.data[1].role).toBe("assistant");
      expect(result.data[1].content).toBe("Hi there");
    });

    it("supports complex content blocks", async () => {
      await createSession("msg-complex", {});
      await appendMessage("msg-complex", {
        role: "user",
        content: [{ type: "text", text: "Image prompt" }],
      });

      const result = await getMessages("msg-complex");
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.length).toBe(1);
      expect(result.data[0].content).toEqual([
        { type: "text", text: "Image prompt" },
      ]);
    });

    it("paginates messages with limit and offset", async () => {
      await createSession("msg-page", {});
      for (let i = 0; i < 5; i++) {
        await appendMessage("msg-page", {
          role: "user",
          content: `msg-${i}`,
        });
      }

      const page1 = await getMessages("msg-page", { limit: 2 });
      expect(page1.success).toBe(true);
      if (!page1.success) return;
      expect(page1.data.length).toBe(2);
      expect(page1.data[0].content).toBe("msg-3");
      expect(page1.data[1].content).toBe("msg-4");

      const page2 = await getMessages("msg-page", { limit: 2, offset: 2 });
      expect(page2.success).toBe(true);
      if (!page2.success) return;
      expect(page2.data.length).toBe(2);
      expect(page2.data[0].content).toBe("msg-1");
      expect(page2.data[1].content).toBe("msg-2");
    });

    it("filters messages with beforeId", async () => {
      await createSession("msg-before", {});
      await appendMessage("msg-before", { role: "user", content: "first" });
      await appendMessage("msg-before", { role: "user", content: "second" });
      await appendMessage("msg-before", { role: "user", content: "third" });

      const db = getDb();
      const rows = db
        .prepare(
          "SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC"
        )
        .all("msg-before") as { id: number }[];
      const middleId = rows[1].id;

      const result = await getMessages("msg-before", { beforeId: middleId });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.length).toBe(1);
      expect(result.data[0].content).toBe("first");
    });
  });
});
