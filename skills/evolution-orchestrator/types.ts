/**
 * Evolution Orchestrator Types
 * =============================
 * Shared types to avoid circular dependencies between evolution modules.
 */

export interface EvolutionProposal {
  filesChanged: string[];
  description: string;
  linesAdded: number;
  linesRemoved: number;
  estimatedCostUsd?: number;
  diffs?: Record<string, string>;
}

export interface PipelineResult {
  success: boolean;
  stage: string;
  message: string;
  versionId?: string;
  approvalId?: string;
  testRunId?: string;
  riskScore?: number;
  violations?: Array<{ article: string; level: string; message: string }>;
  consensus?: {
    recommendation: string;
    adjustedRiskScore: number;
    agreementRatio: number;
  };
  memoryHints?: string[];
}

export interface PipelineOptions {
  skipConsensus?: boolean;
}
