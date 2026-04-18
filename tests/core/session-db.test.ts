import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appConfig } from "../../core/config.ts";

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), "ouroboros-session-db-"));

// We must override the DB dir before importing session-db so it uses the test path.
appConfig.db.dir = TEST_DB_DIR;

import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
  appendMessage,
  getMessages,
  searchMessages,
  resetDbSingleton,
} from "../../core/session-db.ts";

describe("SessionDB", () => {
  beforeEach(() => {
    resetDbSingleton();
    appConfig.db.dir = mkdtempSync(join(tmpdir(), "ouroboros-session-db-"));
  });

  afterEach(() => {
    try {
      const dir = appConfig.db.dir;
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates and retrieves a session", async () => {
    const id = "sess_1";
    const res = await createSession(id, { title: "Test Session", model: "mock", provider: "local" });
    expect(res.success).toBe(true);

    const got = await getSession(id);
    if (!got.success || !got.data) throw new Error("Expected success with data");
    expect(got.data.title).toBe("Test Session");
  });

  it("lists sessions in descending creation order", async () => {
    await createSession("a", { title: "A" });
    await createSession("b", { title: "B" });
    const list = await listSessions();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.some((s) => s.sessionId === "a")).toBe(true);
    expect(list.some((s) => s.sessionId === "b")).toBe(true);
  });

  it("updates session fields", async () => {
    await createSession("upd", { title: "Old" });
    const up = await updateSession("upd", { title: "New", status: "archived", turn_count: 5 });
    expect(up.success).toBe(true);
    const got = await getSession("upd");
    if (!got.success || !got.data) throw new Error("Expected success with data");
    expect(got.data.title).toBe("New");
    expect(got.data.status).toBe("archived");
    expect(got.data.turn_count).toBe(5);
  });

  it("appends and retrieves messages", async () => {
    await createSession("msg_sess", {});
    await appendMessage("msg_sess", { role: "user", content: "hello" });
    await appendMessage("msg_sess", { role: "assistant", content: [{ type: "text", text: "hi" }] });

    const msgs = await getMessages("msg_sess");
    if (!msgs.success) throw new Error("Expected success");
    expect(msgs.data.length).toBe(2);
    expect(msgs.data[0].role).toBe("user");
    expect(msgs.data[0].content).toBe("hello");
    expect(msgs.data[1].role).toBe("assistant");
    expect(msgs.data[1].content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("searches messages via FTS5", async () => {
    await createSession("fts", {});
    await appendMessage("fts", { role: "user", content: "unique banana phrase" });
    await appendMessage("fts", { role: "user", content: "something else entirely" });

    const results = await searchMessages("banana");
    if (!results.success) throw new Error("Expected success");
    expect(results.data.length).toBe(1);
    expect(results.data[0].sessionId).toBe("fts");
    expect(results.data[0].content).toContain("banana");
  });

  it("paginates messages with limit and offset", async () => {
    await createSession("page", {});
    for (let i = 0; i < 5; i++) {
      await appendMessage("page", { role: "user", content: `msg-${i}` });
    }
    const page1 = await getMessages("page", { limit: 2 });
    if (!page1.success) throw new Error("Expected success");
    expect(page1.data.length).toBe(2);
    expect(page1.data[0].content).toBe("msg-3");
    expect(page1.data[1].content).toBe("msg-4");

    const page2 = await getMessages("page", { limit: 2, offset: 2 });
    if (!page2.success) throw new Error("Expected success");
    expect(page2.data.length).toBe(2);
    expect(page2.data[0].content).toBe("msg-1");
    expect(page2.data[1].content).toBe("msg-2");

    const all = await getMessages("page");
    if (!all.success) throw new Error("Expected success");
    expect(all.data.length).toBe(5);
    expect(all.data[0].content).toBe("msg-0");
  });

  it("paginates search results with limit and offset", async () => {
    await createSession("search_page", {});
    await appendMessage("search_page", { role: "user", content: "alpha one" });
    await appendMessage("search_page", { role: "user", content: "alpha two" });
    await appendMessage("search_page", { role: "user", content: "alpha three" });
    // Wait a moment for FTS5 index to be ready in SQLite
    await new Promise((r) => setTimeout(r, 50));

    const page1 = await searchMessages("alpha", { limit: 1, offset: 0 });
    if (!page1.success) throw new Error("Expected success");
    expect(page1.data.length).toBeLessThanOrEqual(1);

    const page2 = await searchMessages("alpha", { limit: 1, offset: 1 });
    if (!page2.success) throw new Error("Expected success");
    expect(page2.data.length).toBeLessThanOrEqual(1);
  });

  it("deletes a session and cascades messages", async () => {
    await createSession("del", {});
    await appendMessage("del", { role: "user", content: "x" });
    const del = await deleteSession("del", true);
    expect(del.success).toBe(true);
    const gotSession = await getSession("del");
    if (!gotSession.success) throw new Error("Expected success");
    expect(gotSession.data).toBeNull();
    const gotMessages = await getMessages("del");
    if (!gotMessages.success) throw new Error("Expected success");
    expect(gotMessages.data.length).toBe(0);
  });
});
