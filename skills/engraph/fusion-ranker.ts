import type { SearchResult } from "./types.ts";

const RRF_K = 60;

// Lane weights: keyword and semantic are primary; graph and temporal are contextual
const DEFAULT_LANE_WEIGHTS: Record<string, number> = {
  vector: 1.0,
  keyword: 1.2,
  semantic: 1.1,
  graph: 0.9,
  temporal: 0.7,
};

/**
 * Weighted Reciprocal Rank Fusion
 * ================================
 * Combines results from multiple lanes using weighted RRF:
 *   score = Σ(weight_lane / (k + rank_i))
 *
 * Deduplicates by `id`, keeping the highest fused score.
 * Returns top N results.
 */
export function fuseAndRank(
  laneResults: Map<string, SearchResult[]>,
  laneWeights?: Record<string, number>
): SearchResult[] {
  const weights = { ...DEFAULT_LANE_WEIGHTS, ...laneWeights };
  const fusedScores = new Map<string, { score: number; result: SearchResult; lanes: string[] }>();

  for (const [lane, results] of laneResults.entries()) {
    const weight = weights[lane] ?? 1.0;
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const rrfScore = weight / (RRF_K + rank + 1); // rank is 0-based

      const existing = fusedScores.get(r.id);
      if (existing) {
        existing.score += rrfScore;
        existing.result.score = existing.score;
        if (!existing.lanes.includes(lane)) {
          existing.lanes.push(lane);
        }
      } else {
        fusedScores.set(r.id, {
          score: rrfScore,
          result: { ...r, score: rrfScore },
          lanes: [lane],
        });
      }
    }
  }

  const merged = Array.from(fusedScores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({
      ...entry.result,
      metadata: {
        ...entry.result.metadata,
        _fusedFrom: entry.lanes,
      },
    }));

  const topN = Math.max(
    ...Array.from(laneResults.values()).map((r) => r.length),
    10
  );

  return merged.slice(0, topN);
}
