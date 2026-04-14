export interface ToolCallPattern {
  sequence: string[];
  successRate: number;
  count: number;
}

function getNGrams(arr: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= arr.length - n; i++) {
    grams.push(arr.slice(i, i + n).join("|"));
  }
  return grams;
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

export class PatternRecognizer {
  private patterns: Map<string, ToolCallPattern> = new Map();

  analyze(trajectory: { toolCalls: string[]; success: boolean }[]): ToolCallPattern[] {
    const localPatterns = new Map<string, { successes: number; total: number }>();

    for (const t of trajectory) {
      const calls = t.toolCalls;
      if (calls.length < 2) continue;
      for (let len = 2; len <= calls.length; len++) {
        for (let i = 0; i <= calls.length - len; i++) {
          const seq = calls.slice(i, i + len);
          const key = seq.join("→");
          const existing = localPatterns.get(key) || { successes: 0, total: 0 };
          existing.total += 1;
          if (t.success) existing.successes += 1;
          localPatterns.set(key, existing);
        }
      }
    }

    const clusters: { key: string; successes: number; total: number }[][] = [];
    for (const [key, stats] of localPatterns) {
      const seq = key.split("→");
      const grams = getNGrams(seq, 2);
      let added = false;
      for (const cluster of clusters) {
        const clusterSeq = cluster[0].key.split("→");
        if (clusterSeq.length !== seq.length) continue;
        const clusterGrams = getNGrams(clusterSeq, 2);
        const sim = jaccardSimilarity(grams, clusterGrams);
        if (sim >= 0.5) {
          cluster.push({ key, ...stats });
          added = true;
          break;
        }
      }
      if (!added) {
        clusters.push([{ key, ...stats }]);
      }
    }

    const result: ToolCallPattern[] = [];
    for (const cluster of clusters) {
      const total = cluster.reduce((s, c) => s + c.total, 0);
      const successes = cluster.reduce((s, c) => s + c.successes, 0);
      const canonical = cluster.reduce((max, c) => (c.total > max.total ? c : max), cluster[0]);
      result.push({
        sequence: canonical.key.split("→"),
        successRate: successes / total,
        count: total,
      });
    }

    for (const p of result) {
      const key = p.sequence.join("→");
      const existing = this.patterns.get(key);
      if (existing) {
        const newCount = existing.count + p.count;
        const newSuccesses = existing.successRate * existing.count + p.successRate * p.count;
        this.patterns.set(key, {
          sequence: p.sequence,
          successRate: newSuccesses / newCount,
          count: newCount,
        });
      } else {
        this.patterns.set(key, p);
      }
    }

    return result;
  }

  suggestOptimizedSequence(taskType: string): ToolCallPattern | null {
    let best: ToolCallPattern | null = null;
    const lowerTask = taskType.toLowerCase();
    for (const p of this.patterns.values()) {
      const seqStr = p.sequence.join(" ").toLowerCase();
      if (seqStr.includes(lowerTask) || lowerTask.includes(seqStr)) {
        if (!best || p.successRate > best.successRate || (p.successRate === best.successRate && p.count > best.count)) {
          best = p;
        }
      }
    }
    return best;
  }
}
