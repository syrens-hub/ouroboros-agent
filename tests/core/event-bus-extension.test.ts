import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProductionEventBus, pruneDeadLetters } from "../../core/event-bus.ts";
import { getDb, resetDbSingleton } from "../../core/db-manager.ts";
import { initEventBusTables } from "../../core/event-bus.ts";

describe("EventBus Extensions", () => {
  beforeEach(() => {
    resetDbSingleton();
    const db = getDb();
    initEventBusTables(db);
    db.exec("DELETE FROM dead_letters;");
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe("register/unregister", () => {
    it("registers and unregisters a handler", async () => {
      const bus = new ProductionEventBus();
      const received: string[] = [];
      const handler = async () => {
        received.push("event");
      };

      bus.register("checkpoint:create", handler);
      bus.emitAsync("checkpoint:create", { sessionId: "s1" });
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toContain("event");

      bus.unregister("checkpoint:create", handler);
      received.length = 0;
      bus.emitAsync("checkpoint:create", { sessionId: "s2" });
      await new Promise((r) => setTimeout(r, 50));
      expect(received.length).toBe(0);

      bus.shutdown();
    });

    it("registerBuiltins does not throw", () => {
      const bus = new ProductionEventBus();
      expect(() => bus.registerBuiltins()).not.toThrow();
      bus.shutdown();
    });

    it("discoverHooks does not throw", () => {
      const bus = new ProductionEventBus();
      expect(() => bus.discoverHooks()).not.toThrow();
      bus.shutdown();
    });
  });

  describe("pruneDeadLetters", () => {
    it("prunes old dead letters", () => {
      const db = getDb();
      const now = Date.now();
      db.prepare(
        `INSERT INTO dead_letters (id, event_type, context, error, attempts, last_attempt_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run("dl-old", "test", "{}", "error", 1, now - 100_000, "pending");
      db.prepare(
        `INSERT INTO dead_letters (id, event_type, context, error, attempts, last_attempt_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run("dl-new", "test", "{}", "error", 1, now, "pending");

      const deleted = pruneDeadLetters(50_000);
      expect(deleted).toBe(1);

      const rows = db.prepare("SELECT * FROM dead_letters").all() as Array<Record<string, unknown>>;
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe("dl-new");
    });

    it("returns 0 when nothing to prune", () => {
      const deleted = pruneDeadLetters(50_000);
      expect(deleted).toBe(0);
    });
  });
});
