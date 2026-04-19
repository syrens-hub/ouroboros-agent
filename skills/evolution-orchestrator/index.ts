/**
 * Evolution Orchestrator
 * ======================
 * Integration layer that wires together all v5.3 safety and evolution modules
 * into a single coherent pipeline:
 *
 *   Propose -> Semantic Check -> Consensus Review -> Safety Gates -> Approval -> Version -> Execute -> Test
 */

import { SemanticConstitutionChecker } from "../semantic-constitution/index.ts";
import { evolutionLock, changeFreezePeriod, budgetController } from "../safety-controls/index.ts";
import { approvalGenerator, type ApprovalRequest, type SafetyStatus } from "../approval/index.ts";
import { evolutionVersionManager } from "../evolution-version-manager/index.ts";
import { incrementalTestRunner } from "../incremental-test/index.ts";
import { runEvolutionConsensus } from "../evolution-consensus/index.ts";
import type { KnowledgeBase } from "../knowledge-base/index.ts";
import { recordEvolutionMemory, queryEvolutionMemory, deriveLesson } from "../evolution-memory/index.ts";
import { applyDiffs, restoreBackup } from "../self-modify/index.ts";
import { logger } from "../../core/logger.ts";
import { getDistributedLock } from "../../core/distributed-lock.ts";
import { appConfig } from "../../core/config.ts";

import type { EvolutionProposal, PipelineResult, PipelineOptions } from "./types.ts";
export type { EvolutionProposal, PipelineResult, PipelineOptions } from "./types.ts"; // re-export for backward compatibility

const constitutionChecker = new SemanticConstitutionChecker();

function buildSafetyStatus(skipLock = false): SafetyStatus {
  const budget = budgetController.getStatus();
  return {
    frozen: changeFreezePeriod.isFrozen(),
    budgetExhausted: !budget.withinBudget,
    locked: skipLock ? false : evolutionLock.isLocked(),
  };
}

/**
 * Propose an evolution through the full safety pipeline.
 * This does NOT execute the evolution — it only validates, approves,
 * and creates a version record.
 */
export function proposeEvolution(proposal: EvolutionProposal, ownerId: string, opts?: PipelineOptions): PipelineResult {
  // Stage 1: Semantic constitution check (no lock needed)
  const constResult = constitutionChecker.checkEvolution({
    filesChanged: proposal.filesChanged,
    description: proposal.description,
    linesAdded: proposal.linesAdded,
    linesRemoved: proposal.linesRemoved,
  });

  if (!constResult.passed) {
    return {
      success: false,
      stage: "constitution",
      message: `Constitution check failed with risk score ${constResult.riskScore}`,
      riskScore: constResult.riskScore,
      violations: constResult.violations.map((v) => ({
        article: v.article,
        level: v.level,
        message: v.message,
      })),
    };
  }

  // Stage 2: Multi-agent consensus review
  let riskScore = constResult.riskScore;
  let consensusRec: PipelineResult["consensus"];

  if (!opts?.skipConsensus) {
    const consensus = runEvolutionConsensus(proposal);
    consensusRec = {
      recommendation: consensus.recommendation,
      adjustedRiskScore: consensus.adjustedRiskScore,
      agreementRatio: consensus.agreementRatio,
    };

    if (consensus.recommendation === "reject") {
      return {
        success: false,
        stage: "consensus",
        message: `Consensus rejected: ${consensus.winnerReasoning} (agreement: ${consensus.agreementRatio}%)`,
        riskScore: consensus.adjustedRiskScore,
        consensus: consensusRec,
      };
    }

    // Use consensus-adjusted risk score
    riskScore = consensus.adjustedRiskScore;
  }

  // Stage 3: Budget check
  if (proposal.estimatedCostUsd && !budgetController.checkBudget(proposal.estimatedCostUsd)) {
    return {
      success: false,
      stage: "budget",
      message: "Budget exhausted for this evolution",
      consensus: consensusRec,
    };
  }

  // Stage 4: Approval routing (lock not yet acquired)
  const safety = buildSafetyStatus(true);
  const approval = approvalGenerator.generateApproval(
    {
      filesChanged: proposal.filesChanged,
      riskScore,
      estimatedCostUsd: proposal.estimatedCostUsd,
      description: proposal.description,
    },
    safety
  );

  if (approval.decision === "denied") {
    return {
      success: false,
      stage: "approval",
      message: approval.reason,
      approvalId: approval.approvalId,
      riskScore,
      consensus: consensusRec,
    };
  }

  // Stage 5: Acquire evolution lock
  if (!evolutionLock.acquire(ownerId)) {
    return {
      success: false,
      stage: "lock",
      message: `Evolution lock is held by ${evolutionLock.getOwner() ?? "unknown"}`,
      consensus: consensusRec,
    };
  }

  try {
    // Stage 6: Version record (with diffs)
    const version = evolutionVersionManager.createVersion({
      filesChanged: proposal.filesChanged,
      riskScore,
      approvalStatus: approval.decision === "auto" ? "approved" : approval.decision,
      description: proposal.description,
      diffs: proposal.diffs,
    });

    logger.info("Evolution proposed and versioned", {
      versionId: version.id,
      versionTag: version.versionTag,
      approvalId: approval.approvalId,
      decision: approval.decision,
    });

    return {
      success: true,
      stage: approval.decision === "auto" ? "approved" : "pending",
      message: approval.decision === "auto"
        ? `Auto-approved and versioned as ${version.versionTag}`
        : `${approval.decision} approval required: ${approval.reason}`,
      versionId: version.id,
      approvalId: approval.approvalId,
      riskScore,
      consensus: consensusRec,
    };
  } finally {
    evolutionLock.release(ownerId);
  }
}

/**
 * Propose an evolution with Knowledge Base memory integration.
 * Queries historical similar evolutions before proposing.
 */
export async function proposeEvolutionWithMemory(
  kb: KnowledgeBase,
  proposal: EvolutionProposal,
  ownerId: string,
  opts?: PipelineOptions
): Promise<PipelineResult> {
  const result = proposeEvolution(proposal, ownerId, opts);

  // Query memory for similar evolutions (best-effort, non-blocking on failure)
  try {
    const hints = await queryEvolutionMemory(kb, proposal, 3);
    if (hints.length > 0) {
      result.memoryHints = hints.map((h) => h.lesson ?? h.content).filter(Boolean);
    }
  } catch {
    // Memory is advisory only — fail open
  }

  return result;
}

/**
 * Resolve a delayed/manual approval and optionally execute.
 */
export async function resolveAndExecute(
  approvalId: string,
  versionId: string,
  changedFiles: string[],
  ownerId: string,
  approved: boolean
): Promise<PipelineResult> {
  const resolved = approvalGenerator.resolveApproval(approvalId, approved);
  if (!resolved) {
    return {
      success: false,
      stage: "approval",
      message: "Approval not found or already resolved",
    };
  }

  if (!approved) {
    return {
      success: false,
      stage: "approval",
      message: "Approval denied by operator",
      approvalId,
      versionId,
    };
  }

  return executeEvolution(versionId, changedFiles, ownerId);
}

/**
 * Execute an approved evolution and run tests.
 * Returns the test run result.
 */
export async function executeEvolution(
  versionId: string,
  changedFiles: string[],
  ownerId: string
): Promise<PipelineResult> {
  // Stage 0: Acquire distributed lock (prevents concurrent execution across instances)
  const distributedLock = getDistributedLock();
  const lockTtlMs = appConfig.redis.lockTtlMs || 60000;
  const distLock = await distributedLock.acquire("evolution:execution", lockTtlMs);
  if (!distLock) {
    return {
      success: false,
      stage: "lock",
      message: "Another evolution is already in progress (distributed lock)",
    };
  }

  try {
    // Stage 1: Re-acquire local lock
    if (!evolutionLock.acquire(ownerId)) {
      return {
        success: false,
        stage: "lock",
        message: `Evolution lock is held by ${evolutionLock.getOwner() ?? "unknown"}`,
      };
    }

    try {
      // Stage 2: Mark version as applied
      const applied = evolutionVersionManager.markApplied(versionId);
      if (!applied) {
        return {
          success: false,
          stage: "version",
          message: `Version ${versionId} not found or already applied`,
        };
      }

      // Stage 3: Apply diffs (the actual self-modification)
      const version = evolutionVersionManager.getVersion(versionId);
      let backupPath: string | undefined;
      if (version?.diffs && Object.keys(version.diffs).length > 0) {
        const applyResult = applyDiffs(version.diffs, { skipSyntaxCheck: false, skipBackup: false });
        backupPath = applyResult.backupPath;
        if (!applyResult.success) {
          // Revert applied status
          evolutionVersionManager.updateTestStatus(versionId, "rollback");
          logger.error("Diff application failed", {
            versionId,
            failures: applyResult.filesFailed,
          });
          return {
            success: false,
            stage: "self-modify",
            message: `Diff application failed: ${applyResult.filesFailed.map((f) => `${f.path}: ${f.error}`).join("; ")}`,
            versionId,
          };
        }
        logger.info("Diffs applied", { versionId, files: applyResult.filesApplied });
      }

      // Stage 4: Record freeze period
      changeFreezePeriod.recordEvolution();

      // Stage 5: Run incremental tests
      const testResult = await incrementalTestRunner.run({
        changedFiles,
        mode: "incremental",
      });

      // Stage 6: Update version test status
      evolutionVersionManager.updateTestStatus(versionId, testResult.status);

      // Stage 7: If tests failed, roll back diffs
      if (testResult.status === "failed" && backupPath) {
        try {
          restoreBackup(`evo-${Date.now()}`, backupPath);
          logger.info("Rolled back diffs due to test failure", { versionId });
        } catch (e) {
          logger.error("Rollback after test failure failed", { versionId, error: String(e) });
        }
        return {
          success: false,
          stage: "test",
          message: `Tests failed (${testResult.passed} passed, ${testResult.failed} failed) — rolled back`,
          versionId,
          testRunId: testResult.runId,
        };
      }

      // Stage 8: Record budget if needed (placeholder — actual cost tracked elsewhere)
      budgetController.recordSpend(0.01); // nominal tracking cost

      logger.info("Evolution executed and tested", {
        versionId,
        testRunId: testResult.runId,
        testStatus: testResult.status,
      });

      return {
        success: testResult.status !== "failed",
        stage: "test",
        message: `Tests ${testResult.status} (${testResult.passed} passed, ${testResult.failed} failed)`,
        versionId,
        testRunId: testResult.runId,
      };
    } finally {
      evolutionLock.release(ownerId);
    }
  } finally {
    await distributedLock.release(distLock);
  }
}

/**
 * Execute an evolution and record the outcome to Knowledge Base memory.
 */
export async function executeEvolutionWithMemory(
  kb: KnowledgeBase,
  versionId: string,
  changedFiles: string[],
  ownerId: string,
  proposal: EvolutionProposal
): Promise<PipelineResult> {
  const result = await executeEvolution(versionId, changedFiles, ownerId);

  // Record memory (best-effort)
  try {
    const lesson = deriveLesson(proposal, result);
    await recordEvolutionMemory(kb, {
      proposal,
      result,
      timestamp: Date.now(),
      learnedLesson: lesson,
    });
  } catch {
    // Memory recording is best-effort
  }

  return result;
}
