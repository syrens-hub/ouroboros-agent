/**
 * Confidence Engine
 * =================
 * Propagates confidence scores across the claim graph.
 * Supporting claims boost confidence; refuting claims reduce it.
 */

import { getRelatedClaims, type RelationType } from "./claim-graph.ts";
import { getClaim, updateClaim } from "./store.ts";

export interface ConfidencePropagationResult {
  claimId: string;
  oldConfidence: number;
  newConfidence: number;
  factors: ConfidenceFactor[];
}

export interface ConfidenceFactor {
  type: RelationType;
  relatedClaimId: string;
  relatedConfidence: number;
  strength: number;
  delta: number;
}

const SUPPORT_BOOST = 0.08;
const REFUTE_PENALTY = 0.15;
const REFINE_BOOST = 0.05;
const RELATED_NEUTRAL = 0.0;

export function propagateConfidence(claimId: string): ConfidencePropagationResult | undefined {
  const claim = getClaim(claimId);
  if (!claim) return undefined;

  const relations = getRelatedClaims(claimId, { direction: "both" });
  const factors: ConfidenceFactor[] = [];
  let delta = 0;

  for (const rel of relations) {
    const otherId = rel.fromClaimId === claimId ? rel.toClaimId : rel.fromClaimId;
    const other = getClaim(otherId);
    if (!other) continue;

    let factorDelta = 0;
    switch (rel.relationType) {
      case "supports":
        factorDelta = other.confidence * rel.strength * SUPPORT_BOOST;
        break;
      case "refutes":
        factorDelta = -other.confidence * rel.strength * REFUTE_PENALTY;
        break;
      case "refines":
        factorDelta = other.confidence * rel.strength * REFINE_BOOST;
        break;
      case "related":
        factorDelta = RELATED_NEUTRAL;
        break;
    }

    // If the relation is incoming (other -> claim), flip the semantic
    if (rel.toClaimId === claimId) {
      // e.g. other supports claim → positive (already correct)
      // other refutes claim → negative (already correct)
      // No flip needed because relation direction is semantic
    }

    delta += factorDelta;
    factors.push({
      type: rel.relationType,
      relatedClaimId: otherId,
      relatedConfidence: other.confidence,
      strength: rel.strength,
      delta: factorDelta,
    });
  }

  const oldConfidence = claim.confidence;
  const newConfidence = Math.max(0.05, Math.min(0.99, oldConfidence + delta));

  if (Math.abs(newConfidence - oldConfidence) > 0.001) {
    updateClaim(claimId, { confidence: Math.round(newConfidence * 1000) / 1000 });
  }

  return {
    claimId,
    oldConfidence,
    newConfidence,
    factors,
  };
}

export function batchPropagate(claimIds: string[]): ConfidencePropagationResult[] {
  const results: ConfidencePropagationResult[] = [];
  for (const id of claimIds) {
    const result = propagateConfidence(id);
    if (result) results.push(result);
  }
  return results;
}
