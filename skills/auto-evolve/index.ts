/**
 * Auto-Evolve v1.1 MVP
 * ====================
 * Closes the self-improvement loop:
 *   telemetry → analyze → propose → (human approves) → execute → git commit
 *
 * Integration points:
 *   - telemetry-v2 CheckupReport  (input)
 *   - proposal-db                 (queue)
 *   - analyzers                   (transformation)
 *   - executor                    (application)
 *   - task-scheduler              (periodic runs)
 */

import { logger } from "../../core/logger.ts";
import { runAutoCheck, type CheckupReport } from "../telemetry-v2/auto-check.ts";
import {
  createProposal,
  listProposals,
  getProposal,
  updateProposalStatus,
  deleteProposal,
  getProposalStats,
  type ImprovementProposal,
  type ProposalFilter,
} from "./proposal-db.ts";
import { analyzeCheckupReport, analyzeDeadCode, type ProposalDraft } from "./analyzers.ts";
import { executeProposal, type ExecutionResult } from "./executor.ts";

export {
  createProposal,
  listProposals,
  getProposal,
  updateProposalStatus,
  deleteProposal,
  getProposalStats,
  executeProposal,
  analyzeCheckupReport,
  analyzeDeadCode,
  type ImprovementProposal,
  type ProposalFilter,
  type ProposalDraft,
  type ExecutionResult,
};

// ---------------------------------------------------------------------------
// Main loop: telemetry → proposals
// ---------------------------------------------------------------------------

export function generateProposalsFromCheckup(report: CheckupReport): ImprovementProposal[] {
  const drafts = analyzeCheckupReport(report);
  const proposals: ImprovementProposal[] = [];

  for (const draft of drafts) {
    try {
      const proposal = createProposal(draft);
      proposals.push(proposal);
      logger.info("Auto-evolve proposal created", {
        proposalId: proposal.id,
        category: proposal.category,
        title: proposal.title,
        autoApplicable: proposal.autoApplicable,
      });
    } catch (e) {
      logger.warn("Failed to create proposal", { error: String(e), draft: draft.title });
    }
  }

  return proposals;
}

/** Run full cycle: checkup → analyze → create proposals */
export function runEvolutionCycle(trigger: "scheduled" | "event" | "manual" = "manual"): {
  checkup: CheckupReport;
  proposals: ImprovementProposal[];
} {
  const checkup = runAutoCheck(trigger);
  const proposals = generateProposalsFromCheckup(checkup);

  // Also run dead-code analysis periodically (only on scheduled runs)
  if (trigger === "scheduled") {
    analyzeDeadCode().then((drafts) => {
      for (const draft of drafts) {
        try {
          createProposal(draft);
        } catch (e) {
          logger.warn("Failed to create dead-code proposal", { error: String(e) });
        }
      }
    }).catch((e) => logger.warn("Dead-code analysis failed", { error: String(e) }));
  }

  logger.info("Evolution cycle completed", {
    trigger,
    checkupId: checkup.id,
    proposalsGenerated: proposals.length,
    healthScore: checkup.healthScore,
  });

  return { checkup, proposals };
}

// ---------------------------------------------------------------------------
// Human review API helpers
// ---------------------------------------------------------------------------

export function approveProposal(id: string): { success: boolean; proposal?: ImprovementProposal; error?: string } {
  const proposal = getProposal(id);
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "pending" && proposal.status !== "snoozed") {
    return { success: false, error: `Cannot approve proposal with status: ${proposal.status}` };
  }

  updateProposalStatus(id, "approved");
  logger.info("Proposal approved", { proposalId: id, title: proposal.title });
  return { success: true, proposal: getProposal(id) };
}

export function rejectProposal(id: string, reason?: string): { success: boolean; proposal?: ImprovementProposal; error?: string } {
  const proposal = getProposal(id);
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "pending" && proposal.status !== "snoozed") {
    return { success: false, error: `Cannot reject proposal with status: ${proposal.status}` };
  }

  updateProposalStatus(id, "rejected", reason ? { errorMessage: reason } : undefined);
  logger.info("Proposal rejected", { proposalId: id, reason });
  return { success: true, proposal: getProposal(id) };
}

export function snoozeProposal(id: string): { success: boolean; proposal?: ImprovementProposal; error?: string } {
  const proposal = getProposal(id);
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "pending") {
    return { success: false, error: `Cannot snooze proposal with status: ${proposal.status}` };
  }

  updateProposalStatus(id, "snoozed");
  logger.info("Proposal snoozed", { proposalId: id });
  return { success: true, proposal: getProposal(id) };
}

/** Apply a single approved proposal immediately. */
export async function applyProposal(id: string): Promise<ExecutionResult> {
  const proposal = getProposal(id);
  if (!proposal) return { success: false, message: "Proposal not found" };
  if (proposal.status !== "approved") {
    return { success: false, message: `Proposal status is ${proposal.status}, must be 'approved'` };
  }

  const result = await executeProposal(proposal);
  logger.info("Proposal applied", { proposalId: id, success: result.success, message: result.message });
  return result;
}

/** Batch-apply all approved low-risk proposals. */
export async function applyApprovedProposals(): Promise<{ applied: number; failed: number; results: ExecutionResult[] }> {
  const approved = listProposals({ status: "approved", limit: 50 });
  const lowRisk = approved.filter((p) => p.riskLevel === "low" && p.autoApplicable);

  let applied = 0;
  let failed = 0;
  const results: ExecutionResult[] = [];

  for (const proposal of lowRisk) {
    const result = await applyProposal(proposal.id);
    results.push(result);
    if (result.success) applied++;
    else failed++;
  }

  logger.info("Batch apply completed", { applied, failed, total: lowRisk.length });
  return { applied, failed, results };
}

// ---------------------------------------------------------------------------
// Scheduled integration
// ---------------------------------------------------------------------------

export function scheduleEvolutionCycle(intervalMs = 24 * 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    try {
      runEvolutionCycle("scheduled");
    } catch (e) {
      logger.error("Scheduled evolution cycle failed", { error: String(e) });
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
