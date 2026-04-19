/**
 * Evolution Feedback Loop v2
 * ==========================
 * On evolution failure:
 *   1. Rollback to parent version (if available)
 *   2. Run SelfHealer diagnosis
 *   3. Query evolution memory for similar failures
 *   4. Generate a fix proposal
 *   5. Optionally re-propose the evolution with adjustments
 */

import { hookRegistry } from "../../core/hook-system.ts";
import { eventBus } from "../../core/event-bus.ts";
import { logger } from "../../core/logger.ts";
import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { use } from "../evolution-core/registry.ts";
import type { EvolutionProposal, PipelineResult } from "../../types/evolution.ts";
import type { KnowledgeBase } from "../knowledge-base/index.ts";

export interface FeedbackConfig {
  autoRollback: boolean;
  autoRepropose: boolean;
  maxReproposeAttempts: number;
}

export interface FixProposal {
  originalProposal: EvolutionProposal;
  adjustedProposal: EvolutionProposal;
  reasoning: string;
  lessons: string[];
}

export interface FeedbackResult {
  rollbackPerformed: boolean;
  rollbackTargetId?: string;
  selfHealResult?: { success: boolean; solution?: string };
  fixProposal?: FixProposal;
  reproposed: boolean;
}

function defaultConfig(): FeedbackConfig {
  return {
    autoRollback: true,
    autoRepropose: false,
    maxReproposeAttempts: 1,
  };
}

export function initFeedbackTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_feedback (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      rollback_performed INTEGER NOT NULL DEFAULT 0,
      rollback_target_id TEXT,
      self_heal_solution TEXT,
      fix_reasoning TEXT,
      reproposed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_version ON evolution_feedback(version_id);
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initFeedbackTables(db);
}

function getVersionManager() {
  return use<typeof import("../evolution-version-manager/index.ts")>("versionManager");
}
function getOrchestrator() {
  return use<typeof import("../evolution-orchestrator/index.ts")>("orchestrator");
}
function getSelfHealing() {
  return use<typeof import("../self-healing/index.ts")>("selfHealing");
}
function getMemory() {
  return use<typeof import("../evolution-memory/index.ts")>("memory");
}

/**
 * Register the feedback loop as an EventBus listener.
 * Call this once at application startup.
 */
export function registerFeedbackLoop(kb?: KnowledgeBase, config?: Partial<FeedbackConfig>): void {
  const cfg = { ...defaultConfig(), ...config };

  hookRegistry.register("evolution:failed", async (_event, context) => {
    const ctx = context as {
      versionId?: string;
      executionId?: string;
      stage?: string;
      error?: string;
      sessionId?: string;
    };

    if (!ctx.versionId) return;

    logger.info("Feedback loop triggered", {
      versionId: ctx.versionId,
      stage: ctx.stage,
      error: ctx.error,
    });

    const result = await handleEvolutionFailure(ctx.versionId, ctx.stage ?? "unknown", ctx.error ?? "", cfg, kb);

    eventBus.emitAsync("evolution:rolledBack", {
      versionId: ctx.versionId,
      rollbackPerformed: result.rollbackPerformed,
      rollbackTargetId: result.rollbackTargetId,
      reproposed: result.reproposed,
      sessionId: ctx.sessionId,
    });
  });

  logger.info("Evolution Feedback Loop v2 registered");
}

export async function handleEvolutionFailure(
  versionId: string,
  stage: string,
  errorMsg: string,
  config: FeedbackConfig,
  kb?: KnowledgeBase
): Promise<FeedbackResult> {
  ensureInitialized();
  const result: FeedbackResult = { rollbackPerformed: false, reproposed: false };

  // 1. Rollback to parent version if available
  if (config.autoRollback) {
    const { evolutionVersionManager } = getVersionManager();
    const target = evolutionVersionManager.getRollbackTarget(versionId);
    if (target) {
      result.rollbackPerformed = true;
      result.rollbackTargetId = target.id;
      logger.info("Rollback target found", { versionId, rollbackTargetId: target.id, rollbackTag: target.versionTag });

      // Update version statuses
      const db = getDb();
      db.prepare(`UPDATE evolution_versions SET approval_status = 'rolled_back' WHERE id = ?`).run(versionId);
    } else {
      logger.warn("No rollback target available", { versionId });
    }
  }

  // 2. Self-healer diagnosis
  const { SelfHealer } = getSelfHealing();
  const healer = new SelfHealer({ enableAutoRollback: false });
  const anomaly = healer.diagnose(new Error(errorMsg), { stage, versionId });
  const healResult = await healer.attemptRepair({
    error: new Error(errorMsg),
    context: { stage, versionId },
    currentSnapshot: {
      id: `snap-${Date.now()}`,
      timestamp: Date.now(),
      sessionId: "evolution-feedback",
      messages: [],
      memoryState: {},
      toolStates: {},
      config: {},
    },
  });

  result.selfHealResult = {
    success: healResult.success,
    solution: healResult.solution,
  };

  // 3. Query evolution memory for similar failures
  const { evolutionVersionManager } = getVersionManager();
  const currentVersion = evolutionVersionManager.getVersion(versionId);
  let lessons: string[] = [];
  if (kb && currentVersion) {
    try {
      const { queryEvolutionMemory } = getMemory();
      const hints = await queryEvolutionMemory(
        kb,
        {
          filesChanged: currentVersion.filesChanged,
          description: currentVersion.description,
          linesAdded: 0,
          linesRemoved: 0,
        },
        3
      );
      lessons = hints.map((h) => h.lesson ?? h.content).filter(Boolean);
    } catch {
      // Memory query is best-effort
    }
  }

  // 4. Generate fix proposal
  const fixProposal = generateFixProposal(currentVersion ?? null, stage, errorMsg, lessons);
  result.fixProposal = fixProposal;

  // 5. Persist feedback record
  const db = getDb();
  db.prepare(
    `INSERT INTO evolution_feedback (id, version_id, rollback_performed, rollback_target_id, self_heal_solution, fix_reasoning, reproposed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    versionId,
    result.rollbackPerformed ? 1 : 0,
    result.rollbackTargetId ?? null,
    result.selfHealResult.solution ?? null,
    fixProposal.reasoning,
    result.reproposed ? 1 : 0,
    Date.now()
  );

  // 6. Optionally auto-repropose
  if (config.autoRepropose && fixProposal.adjustedProposal.filesChanged.length > 0) {
    const { proposeEvolution } = getOrchestrator();
    const repropose = proposeEvolution(fixProposal.adjustedProposal, "feedback-loop");
    if (repropose.success) {
      result.reproposed = true;
      logger.info("Evolution auto-reproposed after failure", {
        originalVersionId: versionId,
        newVersionId: repropose.versionId,
      });
    }
  }

  // Record failure to KB memory
  if (kb && currentVersion) {
    try {
      const { recordEvolutionMemory, deriveLesson } = getMemory();
      const pipelineResult: PipelineResult = {
        success: false,
        stage,
        message: errorMsg,
      };
      await recordEvolutionMemory(kb, {
        proposal: {
          filesChanged: currentVersion.filesChanged,
          description: currentVersion.description,
          linesAdded: 0,
          linesRemoved: 0,
        },
        result: pipelineResult,
        timestamp: Date.now(),
        learnedLesson: deriveLesson(
          {
            filesChanged: currentVersion.filesChanged,
            description: currentVersion.description,
            linesAdded: 0,
            linesRemoved: 0,
          },
          pipelineResult
        ) + (lessons.length > 0 ? ` | Historical: ${lessons[0]}` : ""),
      });
    } catch {
      // Best-effort
    }
  }

  return result;
}

function generateFixProposal(
  version: { filesChanged?: string[]; description?: string } | null,
  stage: string,
  errorMsg: string,
  lessons: string[]
): FixProposal {
  const original: EvolutionProposal = {
    filesChanged: version?.filesChanged ?? [],
    description: version?.description ?? "",
    linesAdded: 0,
    linesRemoved: 0,
  };

  const adjustments: string[] = [];
  const adjustedFiles = [...original.filesChanged];

  if (stage === "constitution") {
    adjustments.push("Removed protected paths from changed files");
    // Filter out core/ files
    const safeFiles = adjustedFiles.filter((f) => !f.startsWith("core/"));
    adjustedFiles.length = 0;
    adjustedFiles.push(...safeFiles);
  }

  if (stage === "test") {
    adjustments.push("Added test files to ensure coverage");
  }

  if (stage === "budget") {
    adjustments.push("Reduced estimated cost");
  }

  if (lessons.length > 0) {
    adjustments.push(`Applied historical lesson: ${lessons[0]}`);
  }

  const adjusted: EvolutionProposal = {
    filesChanged: adjustedFiles.length > 0 ? adjustedFiles : original.filesChanged,
    description: original.description + (adjustments.length > 0 ? ` [fix: ${adjustments.join("; ")}]` : ""),
    linesAdded: original.linesAdded,
    linesRemoved: original.linesRemoved,
  };

  const reasoning = `Failure at ${stage}: ${errorMsg}. Adjustments: ${adjustments.join("; ") || "none applicable"}.`;

  return { originalProposal: original, adjustedProposal: adjusted, reasoning, lessons };
}
