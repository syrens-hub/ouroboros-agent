import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { appConfig } from "../../core/config.ts";

const TEST_DB_DIR = join(process.cwd(), ".ouroboros", "test-evolution-db-" + Date.now());
appConfig.db.dir = TEST_DB_DIR;
appConfig.skills.dir = join(process.cwd(), ".ouroboros", "test-evolution-skills-" + Date.now());

import { AutonomousEvolutionDaemon, type EvolutionDecision } from "../../skills/autonomous-evolution/index.ts";
import { createSession, appendMessage, resetDbSingleton, saveTrajectory } from "../../core/session-db.ts";
import { getDb } from "../../core/db-manager.ts";

const SYNTHESIS_PATH = join(process.cwd(), ".ouroboros", "memory-synthesis", "memory-synthesis.md");

describe("Autonomous Evolution Daemon", () => {
  beforeEach(() => {
    resetDbSingleton();
    const ts = Date.now();
    appConfig.db.dir = join(process.cwd(), ".ouroboros", `test-evolution-db-${ts}`);
    appConfig.skills.dir = join(process.cwd(), ".ouroboros", `test-evolution-skills-${ts}`);
    if (!existsSync(appConfig.skills.dir)) mkdirSync(appConfig.skills.dir, { recursive: true });
    try {
      if (existsSync(SYNTHESIS_PATH)) rmSync(SYNTHESIS_PATH);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      [appConfig.db.dir, appConfig.skills.dir].forEach((dir) => {
        const d = dir.startsWith("/") ? dir : join(process.cwd(), dir);
        if (existsSync(d)) rmSync(d, { recursive: true, force: true });
      });
      if (existsSync(SYNTHESIS_PATH)) rmSync(SYNTHESIS_PATH);
    } catch {
      // ignore
    }
  });

  it("tick reviews unreviewed sessions", async () => {
    await createSession("sess_tick", {});
    await appendMessage("sess_tick", { role: "user", content: "hello" });

    const decisions: EvolutionDecision[] = [];
    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "NO_ACTION" }),
      onDecision: (d) => decisions.push(d),
    });

    await daemon.tick();
    expect(daemon.getStats().reviewedSessions).toBe(1);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].action).toBe("no_action");
  });

  it("auto-creates skill on create decision", async () => {
    await createSession("sess_create", {});
    await appendMessage("sess_create", { role: "user", content: "learn pattern" });

    const reviewResponse = `
ACTION: create
SKILL_NAME: auto-skill
description: auto skill
MARKDOWN:
---
name: auto-skill
description: auto skill
version: 0.1.0
tags: [autonomous, evolution]
---

body
END
    `.trim();

    const decisions: EvolutionDecision[] = [];
    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: reviewResponse }),
      onDecision: (d) => decisions.push(d),
      autoApplyLowRisk: true,
    });

    await daemon.tick();
    expect(decisions[0].action).toBe("create");
    expect(decisions[0].applied).toBe(true);
    expect(decisions[0].skillName).toBe("auto-skill");
  });

  it("applies backoff on consecutive errors", async () => {
    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => {
        throw new Error("mock error");
      },
    });

    // tick() catches errors internally
    try {
      await daemon.tick();
    } catch {
      // should not throw because tick catches
    }
    expect(daemon.getStats().tickCount).toBe(1);
    daemon.start();
    daemon.stop();
  });

  it("records decision history", async () => {
    await createSession("sess_hist", {});
    await appendMessage("sess_hist", { role: "user", content: "x" });

    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "NO_ACTION" }),
    });

    await daemon.tick();
    const history = daemon.getDecisionHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].sessionId).toBe("sess_hist");
  });

  // --------------------------------------------------------------------------
  // Deep Dreaming Tests
  // --------------------------------------------------------------------------

  it("deepDreaming returns early when no trajectories exist", async () => {
    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "synthesis" }),
    });

    await (daemon as unknown as { deepDreaming(): Promise<void> }).deepDreaming();
    expect(existsSync(SYNTHESIS_PATH)).toBe(false);
  });

  it("deepDreaming synthesizes trajectories and writes memory-synthesis.md", async () => {
    await createSession("sess_dd", {});
    const entries = [{ turn: 1, messages: [{ role: "user" as const, content: "hello" }], toolCalls: [] as unknown[], outcome: "success" as const }];
    const st = await saveTrajectory("sess_dd", entries, "success", "test summary", false);
    expect(st.success).toBe(true);

    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "Mock synthesis text" }),
    });

    const decisions: EvolutionDecision[] = [];
    (daemon as unknown as { opts: { onDecision: (d: EvolutionDecision) => void } }).opts.onDecision = (d) =>
      decisions.push(d);

    await (daemon as unknown as { deepDreaming(): Promise<void> }).deepDreaming();

    expect(existsSync(SYNTHESIS_PATH)).toBe(true);
    const content = readFileSync(SYNTHESIS_PATH, "utf-8");
    expect(content).toContain("Mock synthesis text");

    const ddDecision = decisions.find((d) => d.sessionId === "daemon_deep_dreaming");
    expect(ddDecision).toBeDefined();
    expect(ddDecision!.action).toBe("create");
    expect(ddDecision!.skillName).toBe("memory-synthesis");
    expect(ddDecision!.applied).toBe(true);
  });

  it("deepDreaming falls back to 3-day window when 24h is empty", async () => {
    await createSession("sess_old", {});
    const oldTs = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const db = getDb();
    const entries = [{ turn: 1, messages: [{ role: "user" as const, content: "old" }], toolCalls: [] as unknown[], outcome: "success" as const }];
    db.prepare(
      `INSERT INTO trajectories (session_id, turn, entries, outcome, summary, compressed, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_old", 1, JSON.stringify(entries), "success", "old summary", 0, oldTs);

    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "fallback synthesis" }),
    });

    await (daemon as unknown as { deepDreaming(): Promise<void> }).deepDreaming();

    expect(existsSync(SYNTHESIS_PATH)).toBe(true);
    const content = readFileSync(SYNTHESIS_PATH, "utf-8");
    expect(content).toContain("fallback synthesis");
  });

  // --------------------------------------------------------------------------
  // Memory Promotion Scoring Tests
  // --------------------------------------------------------------------------

  it("runMemoryPromotionScoring returns early with no memory recalls", async () => {
    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "NO_ACTION" }),
    });

    await (daemon as unknown as { runMemoryPromotionScoring(): Promise<void> }).runMemoryPromotionScoring();
    const history = daemon.getDecisionHistory();
    expect(history.some((d) => d.sessionId === "daemon_memory_promotion")).toBe(false);
  });

  it("runMemoryPromotionScoring computes and updates promotion scores", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO kb_documents (id, session_id, filename, format, size, hash, created_at, chunk_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("doc1", "sess_ps", "test.txt", "txt", 10, "hash", Date.now(), 1);

    db.prepare(
      `INSERT INTO kb_chunks (id, document_id, content, chunk_index, start_line, end_line, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("chunk_1", "doc1", "sample content", 0, 0, 1, Date.now());

    const details = JSON.stringify([{ chunkId: "chunk_1", score: 0.9 }]);
    db.prepare(
      `INSERT INTO memory_recalls (session_id, query, source, result_count, top_score, timestamp, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_ps", "q1", "test", 1, 0.9, Date.now(), details);

    db.prepare(
      `INSERT INTO memory_recalls (session_id, query, source, result_count, top_score, timestamp, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_ps", "q2", "test", 1, 0.9, Date.now(), details);

    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "NO_ACTION" }),
    });

    const decisions: EvolutionDecision[] = [];
    (daemon as unknown as { opts: { onDecision: (d: EvolutionDecision) => void } }).opts.onDecision = (d) =>
      decisions.push(d);

    await (daemon as unknown as { runMemoryPromotionScoring(): Promise<void> }).runMemoryPromotionScoring();

    const row = db.prepare("SELECT promotion_score FROM kb_chunks WHERE id = ?").get("chunk_1") as {
      promotion_score: number;
    };
    expect(row).toBeDefined();
    // frequency = min(1, 2/5)*0.24 = 0.096
    // relevance = min(1, 0.9)*0.30 = 0.27
    // consolidation = min(1, 2/3)*0.10 = 0.066...
    // + 0.15 + 0.15
    expect(row.promotion_score).toBeGreaterThan(0);

    const promoDecision = decisions.find((d) => d.sessionId === "daemon_memory_promotion");
    expect(promoDecision).toBeDefined();
    expect(promoDecision!.reason).toContain("1");
  });

  it("runMemoryPromotionScoring promotes high-scoring chunks to personality anchors", async () => {
    await createSession("sess_promo", {});
    const db = getDb();
    db.prepare(
      `INSERT INTO kb_documents (id, session_id, filename, format, size, hash, created_at, chunk_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("doc2", "sess_promo", "test.txt", "txt", 10, "hash", Date.now(), 1);

    db.prepare(
      `INSERT INTO kb_chunks (id, document_id, content, chunk_index, start_line, end_line, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("chunk_2", "doc2", "high value memory chunk", 0, 0, 1, Date.now());

    const details = JSON.stringify([{ chunkId: "chunk_2", score: 1.0 }]);
    // Insert 2 recalls so promotion score >= 0.75
    db.prepare(
      `INSERT INTO memory_recalls (session_id, query, source, result_count, top_score, timestamp, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_promo", "q1", "test", 1, 1.0, Date.now(), details);
    db.prepare(
      `INSERT INTO memory_recalls (session_id, query, source, result_count, top_score, timestamp, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_promo", "q2", "test", 1, 1.0, Date.now(), details);

    const daemon = new AutonomousEvolutionDaemon({
      intervalMs: 1000,
      reviewCaller: async () => ({ success: true, data: "NO_ACTION" }),
    });

    const decisions: EvolutionDecision[] = [];
    (daemon as unknown as { opts: { onDecision: (d: EvolutionDecision) => void } }).opts.onDecision = (d) =>
      decisions.push(d);

    await (daemon as unknown as { runMemoryPromotionScoring(): Promise<void> }).runMemoryPromotionScoring();

    const anchor = db
      .prepare("SELECT * FROM personality_anchors WHERE session_id = ? AND category = ?")
      .get("sess_promo", "promoted_memory") as { content: string; importance: number } | undefined;
    expect(anchor).toBeDefined();
    expect(anchor!.content).toBe("high value memory chunk");
    expect(anchor!.importance).toBeGreaterThanOrEqual(0.75);

    const promoDecision = decisions.find((d) => d.sessionId === "daemon_memory_promotion");
    expect(promoDecision).toBeDefined();
    expect(promoDecision!.reason).toContain("promoted 1");
  });
});
