/**
 * Evolution Consensus v2
 * ======================
 * Multi-agent review for evolution proposals.
 * Each specialized reviewer casts a vote, then the Consensus Engine
 * aggregates them into a single recommendation.
 */

import { use } from "../evolution-core/registry.ts";
import type { EvolutionProposal } from "../../types/evolution.ts";
import type { AgentAnswer } from "../crewai/consensus-engine.ts";
import type { SafetyCheckResult } from "../semantic-constitution/index.ts";

export type ReviewVerdict = "approve" | "reject" | "delay";

export interface ReviewerVote {
  reviewerRole: string;
  verdict: ReviewVerdict;
  reasoning: string;
  confidence: number; // 0-1
}

export interface ConsensusReviewResult {
  recommendation: ReviewVerdict;
  adjustedRiskScore: number;
  agreementRatio: number;
  votes: ReviewerVote[];
  winnerReasoning: string;
}

export interface ReviewerConfig {
  role: string;
  weight: number;
  evaluate: (proposal: EvolutionProposal, constCheck: SafetyCheckResult) => ReviewerVote;
}

function getSemanticConstitution() {
  return use<typeof import("../semantic-constitution/index.ts")>("semanticConstitution");
}
function getIncrementalTest() {
  return use<typeof import("../incremental-test/index.ts")>("incrementalTest");
}
function getSafetyControls() {
  return use<typeof import("../safety-controls/index.ts")>("safetyControls");
}
function getCrewai() {
  return use<typeof import("../crewai/consensus-engine.ts")>("crewai");
}

// ─── Built-in Reviewers ─────────────────────────────────────────────────────

const securityReviewer: ReviewerConfig = {
  role: "security",
  weight: 1.2,
  evaluate(proposal, constCheck) {
    const critical = constCheck.violations.filter((v) => v.level === "CRITICAL");
    if (critical.length > 0) {
      return {
        reviewerRole: "security",
        verdict: "reject",
        reasoning: `CRITICAL violations: ${critical.map((v) => v.message).join("; ")}`,
        confidence: 0.95,
      };
    }
    const high = constCheck.violations.filter((v) => v.level === "HIGH");
    if (high.length > 0) {
      return {
        reviewerRole: "security",
        verdict: "delay",
        reasoning: `HIGH risk: ${high.map((v) => v.message).join("; ")}`,
        confidence: 0.85,
      };
    }
    return {
      reviewerRole: "security",
      verdict: "approve",
      reasoning: "No security concerns detected",
      confidence: 0.9,
    };
  },
};

const architectureReviewer: ReviewerConfig = {
  role: "architecture",
  weight: 1.0,
  evaluate(proposal, _constCheck) {
    const totalLines = proposal.linesAdded + proposal.linesRemoved;
    const fileCount = proposal.filesChanged.length;

    if (fileCount > 10 || totalLines > 500) {
      return {
        reviewerRole: "architecture",
        verdict: "delay",
        reasoning: `Large change: ${fileCount} files, ${totalLines} lines. Recommend splitting.`,
        confidence: 0.8,
      };
    }
    if (fileCount > 5 || totalLines > 200) {
      return {
        reviewerRole: "architecture",
        verdict: "delay",
        reasoning: `Medium-sized change: ${fileCount} files, ${totalLines} lines.`,
        confidence: 0.7,
      };
    }
    return {
      reviewerRole: "architecture",
      verdict: "approve",
      reasoning: `Manageable change: ${fileCount} files, ${totalLines} lines.`,
      confidence: 0.85,
    };
  },
};

const testingReviewer: ReviewerConfig = {
  role: "testing",
  weight: 0.9,
  evaluate(proposal) {
    const { mapFilesToTests } = getIncrementalTest();
    const mappedTests = mapFilesToTests(proposal.filesChanged);
    if (mappedTests.length === 0) {
      return {
        reviewerRole: "testing",
        verdict: "delay",
        reasoning: "No test mapping found for changed files. Need to verify test coverage.",
        confidence: 0.75,
      };
    }
    return {
      reviewerRole: "testing",
      verdict: "approve",
      reasoning: `Test coverage mapped to ${mappedTests.length} test file(s).`,
      confidence: 0.8,
    };
  },
};

const costReviewer: ReviewerConfig = {
  role: "cost",
  weight: 0.8,
  evaluate(proposal) {
    const { budgetController } = getSafetyControls();
    const budget = budgetController.getStatus();
    if (proposal.estimatedCostUsd && proposal.estimatedCostUsd > budget.dailyRemaining) {
      return {
        reviewerRole: "cost",
        verdict: "reject",
        reasoning: `Estimated cost $${proposal.estimatedCostUsd} exceeds daily remaining $${budget.dailyRemaining.toFixed(2)}`,
        confidence: 0.9,
      };
    }
    if (!budget.withinBudget) {
      return {
        reviewerRole: "cost",
        verdict: "reject",
        reasoning: "Budget exhausted",
        confidence: 0.95,
      };
    }
    return {
      reviewerRole: "cost",
      verdict: "approve",
      reasoning: `Within budget. Daily remaining: $${budget.dailyRemaining.toFixed(2)}`,
      confidence: 0.85,
    };
  },
};

const DEFAULT_REVIEWERS = [securityReviewer, architectureReviewer, testingReviewer, costReviewer];

// ─── Consensus Runner ───────────────────────────────────────────────────────

export function runEvolutionConsensus(
  proposal: EvolutionProposal,
  reviewers: ReviewerConfig[] = DEFAULT_REVIEWERS
): ConsensusReviewResult {
  // Run semantic check once for all reviewers
  const { semanticConstitutionChecker } = getSemanticConstitution();
  const constCheck = semanticConstitutionChecker.checkEvolution({
    filesChanged: proposal.filesChanged,
    description: proposal.description,
    linesAdded: proposal.linesAdded,
    linesRemoved: proposal.linesRemoved,
  });

  // Collect votes
  const votes = reviewers.map((r) => r.evaluate(proposal, constCheck));

  // Security veto: any CRITICAL-level reject from security overrides consensus
  const securityReject = votes.find(
    (v) => v.reviewerRole === "security" && v.verdict === "reject"
  );
  if (securityReject) {
    return {
      recommendation: "reject",
      adjustedRiskScore: Math.max(constCheck.riskScore, 100),
      agreementRatio: 25,
      votes,
      winnerReasoning: securityReject.reasoning,
    };
  }

  // Map to AgentAnswer for consensus engine
  const answers: AgentAnswer[] = votes.map((v) => ({
    agentId: v.reviewerRole,
    answer: v.verdict,
    confidence: v.confidence,
  }));

  const { runConsensus } = getCrewai();
  const consensus = runConsensus(answers);
  if (!consensus) {
    return {
      recommendation: "delay",
      adjustedRiskScore: constCheck.riskScore,
      agreementRatio: 0,
      votes,
      winnerReasoning: "No consensus reached",
    };
  }

  const recommendation = consensus.winner as ReviewVerdict;
  const winnerVote = votes.find((v) => v.reviewerRole === consensus.winnerAgentId);

  // Adjust risk score based on consensus strength
  const baseRisk = constCheck.riskScore;
  let adjustedRisk = baseRisk;
  if (recommendation === "reject") {
    adjustedRisk = Math.max(baseRisk, 100);
  } else if (recommendation === "delay") {
    adjustedRisk = Math.max(baseRisk, 50);
  } else {
    // Approve: reduce risk if strong agreement
    const agreement = consensus.agreementRatio;
    if (agreement >= 75) {
      adjustedRisk = Math.max(0, baseRisk - 10);
    }
  }

  return {
    recommendation,
    adjustedRiskScore: adjustedRisk,
    agreementRatio: consensus.agreementRatio,
    votes,
    winnerReasoning: winnerVote?.reasoning ?? consensus.winner,
  };
}
