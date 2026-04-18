/**
 * Autonomous Evolution Loop v9.0
 * ================================
 * 24/7 self-improvement without human intervention.
 *
 * Cycle:
 *   1. runAutoReview() → find smells/gaps
 *   2. generateProposal() → package into EvolutionProposal
 *   3. proposeEvolution() → safety pipeline
 *   4. if auto-approved → executeEvolution()
 *   5. record outcome → evolution memory
 *   6. if consecutive failures ≥ max → enter SLEEP
 */

import { getDb } from "../../core/db-manager.ts";
import type { DbAdapter } from "../../core/db-adapter.ts";
import { logger } from "../../core/logger.ts";
import { eventBus } from "../../core/event-bus.ts";
import { proposeEvolution, executeEvolution, type EvolutionProposal, type PipelineResult } from "../evolution-orchestrator/index.ts";
import { approvalGenerator } from "../approval/index.ts";
import { runAutoReview, type GeneratedProposal } from "../evolution-generator/index.ts";
import { deriveLesson } from "../evolution-memory/index.ts";
import { recordEvolutionEvent } from "../evolution-observability/index.ts";

export interface AutonomousConfig {
  intervalMs: number;
  maxConsecutiveFailures: number;
  autoApproveRiskThreshold: number;
  enabled: boolean;
  sleepDurationMs: number;
}

export interface AutonomousState {
  running: boolean;
  consecutiveFailures: number;
  totalCycles: number;
  totalProposals: number;
  totalExecuted: number;
  lastRunAt: number | null;
  status: "idle" | "running" | "sleeping";
  sleepUntil: number | null;
}

function defaultConfig(): AutonomousConfig {
  return {
    intervalMs: 60 * 60 * 1000, // 1 hour
    maxConsecutiveFailures: 3,
    autoApproveRiskThreshold: 20,
    enabled: true,
    sleepDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  };
}

function genId(): string {
  return `ael-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function initAutonomousTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS autonomous_evolution_state (
      id TEXT PRIMARY KEY,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      total_cycles INTEGER NOT NULL DEFAULT 0,
      total_proposals INTEGER NOT NULL DEFAULT 0,
      total_executed INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      sleep_until INTEGER
    );
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initAutonomousTables(db);
}

function loadState(): AutonomousState {
  ensureInitialized();
  const db = getDb();
  const row = db.prepare(`SELECT * FROM autonomous_evolution_state WHERE id = 'singleton'`).get() as Record<string, unknown> | undefined;

  if (!row) {
    db.prepare(
      `INSERT INTO autonomous_evolution_state (id, consecutive_failures, total_cycles, total_proposals, total_executed, status)
       VALUES ('singleton', 0, 0, 0, 0, 'idle')`
    ).run();
    return { running: false, consecutiveFailures: 0, totalCycles: 0, totalProposals: 0, totalExecuted: 0, lastRunAt: null, status: "idle", sleepUntil: null };
  }

  return {
    running: false,
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    totalCycles: Number(row.total_cycles ?? 0),
    totalProposals: Number(row.total_proposals ?? 0),
    totalExecuted: Number(row.total_executed ?? 0),
    lastRunAt: row.last_run_at ? Number(row.last_run_at) : null,
    status: String(row.status ?? "idle") as AutonomousState["status"],
    sleepUntil: row.sleep_until ? Number(row.sleep_until) : null,
  };
}

function saveState(state: AutonomousState): void {
  ensureInitialized();
  const db = getDb();
  db.prepare(
    `UPDATE autonomous_evolution_state SET
      consecutive_failures = ?,
      total_cycles = ?,
      total_proposals = ?,
      total_executed = ?,
      last_run_at = ?,
      status = ?,
      sleep_until = ?
     WHERE id = 'singleton'`
  ).run(
    state.consecutiveFailures,
    state.totalCycles,
    state.totalProposals,
    state.totalExecuted,
    state.lastRunAt ?? null,
    state.status,
    state.sleepUntil ?? null
  );
}

export class AutonomousEvolutionLoop {
  private config: AutonomousConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: AutonomousState;

  constructor(config?: Partial<AutonomousConfig>) {
    this.config = { ...defaultConfig(), ...config };
    this.state = loadState();
  }

  start(): void {
    if (this.state.running || !this.config.enabled) return;
    this.state.running = true;
    this.state.status = "running";
    saveState(this.state);

    logger.info("Autonomous Evolution Loop v9.0 started", { intervalMs: this.config.intervalMs });

    this.tick();
    this.timer = setInterval(() => this.tick(), this.config.intervalMs);
  }

  stop(): void {
    this.state.running = false;
    this.state.status = "idle";
    saveState(this.state);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Autonomous Evolution Loop stopped");
  }

  isRunning(): boolean {
    return this.state.running;
  }

  getState(): AutonomousState {
    return { ...this.state };
  }

  private async tick(): Promise<void> {
    if (!this.state.running) return;

    // Check sleep
    if (this.state.sleepUntil && Date.now() < this.state.sleepUntil) {
      logger.debug("Autonomous loop sleeping", { sleepUntil: this.state.sleepUntil });
      return;
    }
    if (this.state.sleepUntil && Date.now() >= this.state.sleepUntil) {
      this.state.sleepUntil = null;
      this.state.consecutiveFailures = 0;
      this.state.status = "running";
      logger.info("Autonomous loop woke up from sleep");
    }

    this.state.totalCycles++;
    this.state.lastRunAt = Date.now();
    saveState(this.state);

    logger.info("Autonomous evolution cycle started", { cycle: this.state.totalCycles });

    try {
      await this.runCycle();
    } catch (e) {
      logger.error("Autonomous cycle error", { error: String(e) });
      this.handleFailure();
    }
  }

  private async runCycle(): Promise<void> {
    // 1. Auto-review
    const generated = runAutoReview();
    if (!generated) {
      logger.info("No improvement opportunities found this cycle");
      this.state.consecutiveFailures = 0;
      saveState(this.state);
      return;
    }

    this.state.totalProposals++;
    saveState(this.state);

    logger.info("Auto-generated proposal", {
      files: generated.proposal.filesChanged,
      description: generated.proposal.description,
      riskScore: generated.proposal.estimatedCostUsd,
    });

    recordEvolutionEvent("evolution:proposed", {
      versionId: "autonomous",
      message: generated.proposal.description,
    });

    // 2. Propose through safety pipeline
    const proposalResult = proposeEvolution(generated.proposal, "autonomous-loop");

    if (!proposalResult.success) {
      logger.warn("Autonomous proposal blocked", { stage: proposalResult.stage, message: proposalResult.message });
      this.handleFailure();
      return;
    }

    // 3. Auto-execute if risk is low enough
    if (proposalResult.approvalId && proposalResult.versionId) {
      const approval = approvalGenerator.getApproval(proposalResult.approvalId);
      const risk = proposalResult.riskScore ?? 100;

      if (approval?.decision === "auto" || (approval?.decision === "delayed" && risk < this.config.autoApproveRiskThreshold)) {
        // Process expired delays (may auto-approve)
        approvalGenerator.processExpiredDelays();

        const resolved = approvalGenerator.resolveApproval(proposalResult.approvalId, true);
        if (resolved) {
          const execResult = await executeEvolution(
            proposalResult.versionId,
            generated.proposal.filesChanged,
            "autonomous-loop"
          );

          if (execResult.success) {
            this.state.totalExecuted++;
            this.state.consecutiveFailures = 0;
            saveState(this.state);
            logger.info("Autonomous evolution executed successfully", { versionId: proposalResult.versionId });
            recordEvolutionEvent("evolution:executed", {
              versionId: proposalResult.versionId,
              status: "completed",
              message: execResult.message,
            });
          } else {
            logger.warn("Autonomous evolution execution failed", { versionId: proposalResult.versionId, error: execResult.message });
            this.handleFailure();
            recordEvolutionEvent("evolution:failed", {
              versionId: proposalResult.versionId,
              stage: execResult.stage,
              error: execResult.message,
            });
          }
        }
      } else {
        logger.info("Autonomous proposal requires manual/delayed approval — skipping execution", {
          approvalId: proposalResult.approvalId,
          decision: approval?.decision,
        });
        // Not a failure, just needs human review
        this.state.consecutiveFailures = 0;
        saveState(this.state);
      }
    }
  }

  private handleFailure(): void {
    this.state.consecutiveFailures++;
    saveState(this.state);

    if (this.state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.state.status = "sleeping";
      this.state.sleepUntil = Date.now() + this.config.sleepDurationMs;
      saveState(this.state);
      logger.warn("Autonomous loop entering sleep due to consecutive failures", {
        consecutiveFailures: this.state.consecutiveFailures,
        sleepUntil: this.state.sleepUntil,
      });
      eventBus.emitAsync("autonomous:sleep", {
        reason: "consecutive_failures",
        consecutiveFailures: this.state.consecutiveFailures,
        sleepUntil: this.state.sleepUntil,
      });
    }
  }
}

export const autonomousEvolutionLoop = new AutonomousEvolutionLoop();
