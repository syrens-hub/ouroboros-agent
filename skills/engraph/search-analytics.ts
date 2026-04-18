/**
 * Search Analytics
 * ================
 * Lightweight analytics to track lane performance and query patterns.
 */

export interface LaneStat {
  lane: string;
  candidates: number;
  topScore: number;
  latencyMs: number;
}

export interface SearchStatRecord {
  query: string;
  timestamp: number;
  totalLatencyMs: number;
  lanes: LaneStat[];
  resultCount: number;
}

const recentStats: SearchStatRecord[] = [];
const MAX_STATS = 200;

export function recordSearchStats(
  query: string,
  totalLatencyMs: number,
  laneStats: LaneStat[],
  resultCount: number
): void {
  recentStats.push({
    query,
    timestamp: Date.now(),
    totalLatencyMs,
    lanes: laneStats,
    resultCount,
  });
  while (recentStats.length > MAX_STATS) {
    recentStats.shift();
  }
}

export function getSearchStats(limit = 50): SearchStatRecord[] {
  return recentStats.slice(-limit);
}

export function getLanePerformanceSummary(): Record<string, { avgCandidates: number; avgLatencyMs: number; hitRate: number }> {
  const laneData = new Map<string, { candidates: number[]; latencies: number[]; hits: number; total: number }>();

  for (const stat of recentStats) {
    for (const lane of stat.lanes) {
      const existing = laneData.get(lane.lane) || { candidates: [], latencies: [], hits: 0, total: 0 };
      existing.candidates.push(lane.candidates);
      existing.latencies.push(lane.latencyMs);
      existing.hits += lane.candidates > 0 ? 1 : 0;
      existing.total += 1;
      laneData.set(lane.lane, existing);
    }
  }

  const summary: Record<string, { avgCandidates: number; avgLatencyMs: number; hitRate: number }> = {};
  for (const [lane, data] of laneData.entries()) {
    const avgCandidates = data.candidates.reduce((a, b) => a + b, 0) / Math.max(1, data.candidates.length);
    const avgLatencyMs = data.latencies.reduce((a, b) => a + b, 0) / Math.max(1, data.latencies.length);
    summary[lane] = {
      avgCandidates: Math.round(avgCandidates * 100) / 100,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      hitRate: Math.round((data.hits / Math.max(1, data.total)) * 1000) / 10,
    };
  }

  return summary;
}

export function clearSearchStats(): void {
  recentStats.length = 0;
}
