/**
 * Autonomous Evolution Daemon
 * ===========================
 * The final闭环: a background process that continuously reviews sessions,
 * proposes improvements, and executes low-risk changes without human intervention.
 *
 * Design:
 *   - Tick-driven interval loop
 *   - Scans unreviewed sessions from SessionDB
 *   - Runs a cheap review LLM over each trajectory
 *   - Auto-creates skills for low-risk, high-reuse patterns
 *   - Optionally self-reviews daemon source code every N cycles
 *
 * Meta-Axiom: Every modification passes through the Rule Engine.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getDb } from "../../core/db-manager.ts";
import type { BaseMessage, Result } from "../../types/index.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import { ok, err } from "../../types/index.ts";
import { callLLM } from "../../core/llm-router.ts";
import { getMessages, listSessions, saveTrajectory, logModification, upsertSkillRegistry, getStaleSessions, deleteSessionMessages } from "../../core/session-db.ts";
import { writeSkill, createTrajectoryCompressor } from "../learning/index.ts";
import { loadSkillModule, extractToolsFromModule } from "../skill-factory/index.ts";
import { defaultRuleEngine } from "../../core/rule-engine.ts";

export interface AutonomousEvolutionOptions {
  /** Review interval in milliseconds. Default: 60000 (1 minute). */
  intervalMs?: number;
  /** LLM config for review calls. */
  llmCfg?: LLMConfig;
  /** Custom LLM caller for testing/mocking. */
  reviewCaller?: (messages: BaseMessage[]) => Promise<Result<string>>;
  /** Auto-apply low-risk skill creation. Default: true. */
  autoApplyLowRisk?: boolean;
  /** Run self-review every N ticks. Default: 10. */
  selfReviewEveryNTicks?: number;
  /** Callback for every decision. */
  onDecision?: (decision: EvolutionDecision) => void;
  /** Callback for errors. */
  onError?: (error: Error) => void;
}

export interface EvolutionDecision {
  sessionId: string;
  action: "create" | "patch" | "delete" | "no_action" | "self_patch";
  skillName?: string;
  description?: string;
  markdown?: string;
  applied: boolean;
  reason: string;
  toolsLoaded?: string[];
}

const AUTONOMOUS_REVIEW_PROMPT = `You are the Ouroboros Autonomous Evolution Agent.
Analyze the conversation trajectory below and decide if a reusable Skill should be created, patched, or deleted.

Rules:
1. CREATE if a successful pattern emerged that would be useful in future sessions.
2. PATCH only if an existing skill name is clearly identified and the change is incremental.
3. DELETE only if a skill is obsolete and harmful.
4. Otherwise reply exactly: NO_ACTION

Special rule: If the trajectory contains a successful computer_use browser automation, generate a browser skill. The generated index.ts should import BrowserController from "../../skills/browser/index.ts", create a lightweight controller instance, and replay the learned navigation/click/fill sequence.

When you decide CREATE or PATCH, respond in this exact format:

ACTION: create|patch|delete
SKILL_NAME: lowercase-name
DESCRIPTION: one-line description
===SKILL_MD===
---
name: lowercase-name
description: one-line description
version: 0.1.0
tags: [autonomous, evolution]
---

[skill body here]
===INDEX_TS===
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

export const exampleTool = buildTool({
  name: "example_tool",
  description: "...",
  inputSchema: z.object({ input: z.string() }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ input }) {
    return { result: input };
  },
});

export default exampleTool;
===END===

If the skill does NOT need executable code, you may omit the ===INDEX_TS=== section.
Be concise.`;

// =============================================================================
// Default Review Caller (uses real LLM)
// =============================================================================

async function defaultReviewCaller(llmCfg: LLMConfig, messages: BaseMessage[]): Promise<Result<string>> {
  try {
    const res = await callLLM(llmCfg, messages, []);
    if (!res.success) return res;
    const text =
      typeof res.data.content === "string"
        ? res.data.content
        : (Array.isArray(res.data.content) && res.data.content.find((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")?.text) || "";
    return ok(text);
  } catch (e) {
    return err({ code: "LLM_ERROR", message: String(e) });
  }
}

// =============================================================================
// Parse Review Response
// =============================================================================

function parseReviewResponse(text: string) {
  const actionMatch = text.match(/ACTION:\s*(create|patch|delete|no_action)/i);
  if (!actionMatch) return { action: "no_action" as const };

  const action = actionMatch[1].toLowerCase() as EvolutionDecision["action"];
  if (action === "no_action") return { action };

  const nameMatch = text.match(/SKILL_NAME:\s*(.+)/);
  const descMatch = text.match(/DESCRIPTION:\s*(.+)/);

  // Support new delimited format
  const mdBlock = text.match(/===SKILL_MD===\n([\s\S]*?)(?:\n===INDEX_TS===|\n===END===|$)/);
  const tsBlock = text.match(/===INDEX_TS===\n([\s\S]*?)\n===END===/);

  // Fallback to legacy MARKDOWN: ... END format
  const legacyMd = text.match(/MARKDOWN:\n([\s\S]+?)\n(?:END|$)/);

  return {
    action,
    skillName: nameMatch?.[1].trim(),
    description: descMatch?.[1].trim(),
    markdown: mdBlock?.[1].trim() || legacyMd?.[1].trim(),
    indexTs: tsBlock?.[1].trim(),
  };
}

// =============================================================================
// Trajectory Compression
// =============================================================================

async function compressMessages(messages: BaseMessage[]): Promise<BaseMessage[]> {
  const rawChars = JSON.stringify(messages).length;
  if (rawChars <= 6000) return messages;
  const compressor = createTrajectoryCompressor();
  const fakeEntries = messages.map((m, idx) => ({
    turn: idx,
    messages: [m],
    toolCalls: [] as unknown[],
    outcome: "success" as const,
  }));
  const compressed = await compressor.compress(fakeEntries, 3000);
  if (compressed.success && compressed.data.length < messages.length) {
    const summary: BaseMessage = {
      role: "system",
      content: `Compressed trajectory: ${messages.length} messages → ${compressed.data.length} entries.`,
    };
    return [summary, ...compressed.data.flatMap((e) => e.messages)];
  }
  return messages;
}

// =============================================================================
// Daemon Class
// =============================================================================

export class AutonomousEvolutionDaemon {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickCount = 0;
  private reviewedSessions = new Set<string>();
  private opts: Required<AutonomousEvolutionOptions>;
  private decisionHistory: EvolutionDecision[] = [];
  private maxHistory = 50;
  private consecutiveErrors = 0;
  private running = false;
  private lastDeepDreamAt = 0;
  private lastPromotionScoringAt = 0;

  constructor(opts: AutonomousEvolutionOptions = {}) {
    this.opts = {
      intervalMs: opts.intervalMs ?? 60000,
      llmCfg: opts.llmCfg ?? { provider: "local", model: "mock" },
      reviewCaller: opts.reviewCaller ?? ((msgs) => defaultReviewCaller(this.opts.llmCfg, msgs)),
      autoApplyLowRisk: opts.autoApplyLowRisk ?? true,
      selfReviewEveryNTicks: opts.selfReviewEveryNTicks ?? 10,
      onDecision: opts.onDecision ?? (() => {}),
      onError: opts.onError ?? (() => {}),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (!this.running) return;
    const backoffMs = Math.min(30 * 60 * 1000, this.opts.intervalMs * Math.pow(2, this.consecutiveErrors));
    this.timer = setTimeout(() => {
      this.tick()
        .then(() => {
          this.consecutiveErrors = 0;
        })
        .catch((e) => {
          this.consecutiveErrors++;
          this.opts.onError?.(e as Error);
        })
        .finally(() => {
          this.scheduleTick();
        });
    }, backoffMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getDecisionHistory(): EvolutionDecision[] {
    return [...this.decisionHistory];
  }

  getStats(): { tickCount: number; reviewedSessions: number; historySize: number } {
    return {
      tickCount: this.tickCount,
      reviewedSessions: this.reviewedSessions.size,
      historySize: this.decisionHistory.length,
    };
  }

  async tick(): Promise<void> {
    this.tickCount++;

    // 1. Session review
    const sessions = await listSessions();
    for (const session of sessions) {
      if (this.reviewedSessions.has(session.sessionId)) continue;
      await this.reviewSession(session.sessionId);
      this.reviewedSessions.add(session.sessionId);
    }

    // 2. Self-review every N ticks
    if (this.tickCount % this.opts.selfReviewEveryNTicks === 0) {
      await this.selfReview();
    }

    // 3. Deep Dreaming: once per day
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (Date.now() - this.lastDeepDreamAt > oneDayMs) {
      await this.deepDreaming();
      this.lastDeepDreamAt = Date.now();
    }

    // 4. Memory promotion scoring: once per day
    if (Date.now() - this.lastPromotionScoringAt > oneDayMs) {
      await this.runMemoryPromotionScoring();
      this.lastPromotionScoringAt = Date.now();
    }

    // 5. Retention policy: archive sessions older than 7 days
    await this.applyRetentionPolicy();
  }

  private async applyRetentionPolicy(): Promise<void> {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const staleRes = await getStaleSessions(sevenDaysAgo);
    if (!staleRes.success) return;
    for (const stale of staleRes.data) {
      const msgsRes = await getMessages(stale.sessionId);
      if (msgsRes.success && msgsRes.data.length > 0) {
        const rawEntries = msgsRes.data.map((m, idx) => ({
          turn: idx,
          messages: [m],
          toolCalls: [] as unknown[],
          outcome: "success" as const,
        }));
        const compressor = createTrajectoryCompressor();
        const compressed = await compressor.compress(rawEntries, 4000);
        const entries = compressed.success ? compressed.data : rawEntries;
        await saveTrajectory(stale.sessionId, entries, "archived", "Retention policy archive", compressed.success);
      }
      await deleteSessionMessages(stale.sessionId);
    }
  }

  private async reviewSession(sessionId: string): Promise<void> {
    const messagesRes = await getMessages(sessionId);
    if (!messagesRes.success || messagesRes.data.length === 0) return;

    const messages = await compressMessages(messagesRes.data);
    const reviewMessages: BaseMessage[] = [
      { role: "system", content: AUTONOMOUS_REVIEW_PROMPT },
      { role: "user", content: `Trajectory for session ${sessionId}:\n\n${JSON.stringify(messages, null, 2)}` },
    ];

    const caller = this.opts.reviewCaller;
    const textRes = await caller(reviewMessages);
    if (!textRes.success) {
      this.opts.onError?.(new Error(`Review LLM failed for ${sessionId}: ${textRes.error.message}`));
      return;
    }

    const parsed = parseReviewResponse(textRes.data);
    const decision: EvolutionDecision = {
      sessionId,
      action: parsed.action,
      skillName: parsed.skillName,
      description: parsed.description,
      markdown: parsed.markdown,
      applied: false,
      reason: "Review completed",
    };

    // Apply low-risk skill creation
    if (parsed.action === "create" && parsed.markdown && parsed.skillName) {
      const req = {
        type: "skill_create" as const,
        skillName: parsed.skillName,
        description: parsed.description || `Auto skill ${parsed.skillName}`,
        proposedChanges: { markdown: parsed.markdown },
        rationale: "Autonomous evolution agent detected a reusable pattern.",
        estimatedRisk: "low" as const,
      };
      const ruleCheck = defaultRuleEngine.evaluateModification(req);
      if (ruleCheck.success && ruleCheck.data === "allow" && this.opts.autoApplyLowRisk) {
        const writeRes = writeSkill(parsed.skillName, parsed.markdown);
        if (writeRes.success) {
          const skillDir = join(process.cwd(), "skills", parsed.skillName);
          await upsertSkillRegistry(parsed.skillName, skillDir, { name: parsed.skillName, description: parsed.description }, false);
          await logModification(sessionId, req, "allow", true);
          decision.applied = true;
          decision.reason = "Auto-applied low-risk skill creation.";

          // If executable code was generated, write it and hot-load
          if (parsed.indexTs) {
            try {
              writeFileSync(join(skillDir, "index.ts"), parsed.indexTs, "utf-8");
              const mod = await loadSkillModule(skillDir);
              const tools = extractToolsFromModule(mod);
              if (tools.length > 0) {
                // Dynamic import to avoid static circular dependency with runner-pool
                const { reloadSkillTools } = await import("../../web/runner-pool.ts");
                reloadSkillTools(tools);
                decision.toolsLoaded = tools.map((t) => t.name);
                decision.reason += ` Hot-loaded ${tools.length} tool(s): ${decision.toolsLoaded.join(", ")}.`;
              }
            } catch (e) {
              decision.reason += ` Executable code generation failed: ${String(e)}`;
            }
          }
        } else {
          decision.reason = `Write failed: ${writeRes.error.message}`;
        }
      } else {
        decision.reason = ruleCheck.success
          ? `Rule engine decision: ${ruleCheck.data}`
          : `Rule engine denied: ${ruleCheck.error.message}`;
      }
    }

    // Persist trajectory note
    const fakeEntries = messages.map((m, idx) => ({
      turn: idx,
      messages: [m],
      toolCalls: [] as unknown[],
      outcome: "success" as const,
      summary: `Autonomous review: ${decision.action}`,
    }));
    await saveTrajectory(sessionId, fakeEntries, "success", undefined, false);

    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxHistory) this.decisionHistory.shift();
    this.opts.onDecision(decision);
  }

  private async deepDreaming(): Promise<void> {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const threeDaysMs = 3 * oneDayMs;

    // 1. Collect trajectories from last 24h; fallback to 3 days if empty
    let since = Date.now() - oneDayMs;
    const db = getDb();
    let rows = db
      .prepare("SELECT entries, summary, timestamp FROM trajectories WHERE timestamp > ? ORDER BY timestamp DESC")
      .all(since) as { entries: string; summary: string | null; timestamp: number }[];

    if (!rows || rows.length === 0) {
      since = Date.now() - threeDaysMs;
      rows = db
        .prepare("SELECT entries, summary, timestamp FROM trajectories WHERE timestamp > ? ORDER BY timestamp DESC")
        .all(since) as { entries: string; summary: string | null; timestamp: number }[];
    }

    if (!rows || rows.length === 0) return;

    // 2. Build synthesis prompt
    const summaries: string[] = [];
    for (const row of rows.slice(0, 20)) {
      let text = row.summary || "";
      if (!text) {
        try {
          const entries = JSON.parse(row.entries) as Array<{ messages?: { role: string; content: unknown }[] }>;
          text = entries
            .flatMap((e) => e.messages || [])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => String(m.content).slice(0, 200))
            .join("\n");
        } catch {
          text = "(unparseable trajectory)";
        }
      }
      summaries.push(text);
    }

    const prompt = `You are the Ouroboros Deep Dreaming agent.
Analyze the following conversation trajectories and synthesize a coherent memory summary.
Focus on recurring user preferences, important facts, and successful patterns.

Trajectories:
${summaries.map((s, i) => `--- Trajectory ${i + 1} ---\n${s}`).join("\n\n")}

Output a concise markdown document. Be factual and avoid hallucination.`;

    const messages: BaseMessage[] = [
      { role: "system", content: prompt },
      { role: "user", content: "Write the Memory Synthesis." },
    ];

    const llmRes = await this.opts.reviewCaller(messages);
    if (!llmRes.success) {
      this.opts.onError?.(new Error(`Deep Dreaming LLM failed: ${llmRes.error.message}`));
      return;
    }

    // 3. Write synthesis to file
    const synthesisDir = join(process.cwd(), ".ouroboros", "memory-synthesis");
    if (!existsSync(synthesisDir)) mkdirSync(synthesisDir, { recursive: true });
    const synthesisPath = join(synthesisDir, "memory-synthesis.md");
    writeFileSync(synthesisPath, `# Memory Synthesis\n\n${llmRes.data}\n`, "utf-8");

    // 4. Log decision
    const decision: EvolutionDecision = {
      sessionId: "daemon_deep_dreaming",
      action: "create",
      skillName: "memory-synthesis",
      description: "Deep Dreaming memory synthesis",
      applied: true,
      reason: `Synthesized ${rows.length} trajectories into memory-synthesis.md`,
    };
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxHistory) this.decisionHistory.shift();
    this.opts.onDecision(decision);
  }

  private async runMemoryPromotionScoring(): Promise<void> {
    const db = getDb();
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // 1. Fetch recent memory recalls with details
    const rows = db
      .prepare("SELECT details FROM memory_recalls WHERE timestamp > ? AND details IS NOT NULL")
      .all(since) as { details: string }[];

    if (!rows || rows.length === 0) return;

    // 2. Aggregate scores per chunkId
    const chunkMap = new Map<string, { recallCount: number; totalScore: number }>();
    for (const row of rows) {
      try {
        const details = JSON.parse(row.details) as Array<{ chunkId: string | null; score: number }>;
        for (const d of details) {
          if (!d.chunkId) continue;
          const existing = chunkMap.get(d.chunkId) || { recallCount: 0, totalScore: 0 };
          existing.recallCount += 1;
          existing.totalScore += d.score;
          chunkMap.set(d.chunkId, existing);
        }
      } catch {
        // ignore malformed details
      }
    }

    if (chunkMap.size === 0) return;

    // 3. Compute promotion scores, update kb_chunks, and promote high-value chunks
    const updateStmt = db.prepare(`UPDATE kb_chunks SET promotion_score = ? WHERE id = ?`);
    const chunkInfoStmt = db.prepare(
      `SELECT kc.content, kd.session_id FROM kb_chunks kc JOIN kb_documents kd ON kc.document_id = kd.id WHERE kc.id = ?`
    );
    let promotedCount = 0;
    for (const [chunkId, stats] of chunkMap) {
      const avgScore = stats.totalScore / stats.recallCount;
      const frequency = Math.min(1, stats.recallCount / 5) * 0.24;
      const relevance = Math.min(1, avgScore) * 0.30;
      const consolidation = Math.min(1, stats.recallCount / 3) * 0.10;
      const promotionScore = Math.min(1, frequency + relevance + consolidation + 0.15 /* recency placeholder */ + 0.15 /* diversity placeholder */);
      updateStmt.run(promotionScore, chunkId);

      if (promotionScore >= 0.75) {
        const info = chunkInfoStmt.get(chunkId) as { content: string; session_id: string } | undefined;
        if (info) {
          const anchorId = `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const now = Date.now();
          db.prepare(
            `INSERT INTO personality_anchors (id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(anchorId, info.session_id, info.content.slice(0, 1000), "promoted_memory", promotionScore, now, 1, now);
          promotedCount++;
        }
      }
    }

    // 4. Log decision
    const decision: EvolutionDecision = {
      sessionId: "daemon_memory_promotion",
      action: "patch",
      skillName: "memory-promotion",
      description: "Memory promotion scoring",
      applied: true,
      reason: `Scored ${chunkMap.size} memory chunks for promotion; promoted ${promotedCount} to personality anchors`,
    };
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxHistory) this.decisionHistory.shift();
    this.opts.onDecision(decision);
  }

  private async selfReview(): Promise<void> {
    // Simple self-review: check the daemon source file for a known improvement marker.
    // In a real system, this would analyze error logs and propose source patches.
    const sourcePath = join(process.cwd(), "skills", "autonomous-evolution", "index.ts");
    if (!existsSync(sourcePath)) return;

    const source = readFileSync(sourcePath, "utf-8");
    const hasImprovementMarker = source.includes("SELF_IMPROVEMENT_VERSION: 1");

    if (!hasImprovementMarker) {
      // Inject a harmless comment marker as a demo of self-modification
      const marker = `// SELF_IMPROVEMENT_VERSION: 1`;
      const newSource = source.replace(
        /class AutonomousEvolutionDaemon \{/,
        `${marker}\nclass AutonomousEvolutionDaemon {`
      );
      if (newSource !== source) {
        const req = {
          type: "core_evolve" as const,
          description: "Add self-improvement version marker to daemon",
          proposedChanges: { file: sourcePath, diff: marker },
          rationale: "Enables future self-review to detect whether baseline improvements have been applied.",
          estimatedRisk: "low" as const,
        };
        const ruleCheck = defaultRuleEngine.evaluateModification(req);
        if (ruleCheck.success && ruleCheck.data === "allow") {
          writeFileSync(sourcePath, newSource, "utf-8");
          await logModification("daemon_self_review", req, "allow", true);
          const selfDecision: EvolutionDecision = {
            sessionId: "daemon_self_review",
            action: "self_patch",
            applied: true,
            reason: "Auto-applied low-risk self-improvement marker.",
          };
          this.decisionHistory.push(selfDecision);
          if (this.decisionHistory.length > this.maxHistory) this.decisionHistory.shift();
          this.opts.onDecision(selfDecision);
        }
      }
    }
  }
}

// =============================================================================
// Convenience factory
// =============================================================================

export function createAutonomousEvolutionDaemon(opts?: AutonomousEvolutionOptions): AutonomousEvolutionDaemon {
  return new AutonomousEvolutionDaemon(opts);
}
