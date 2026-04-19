/**
 * Evolution Domain Types
 * ======================
 * Centralised type definitions for the evolution skill cluster.
 *
 * These types were extracted from skills/evolution-orchestrator/types.ts
 * to reduce cross-skill import coupling. Evolution skills should import
 * types from here instead of reaching into sibling skill directories.
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
