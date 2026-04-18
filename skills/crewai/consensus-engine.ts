/**
 * Consensus Engine
 * ================
 * Resolves disagreements among multiple agent answers by
 * clustering similar responses and selecting the majority winner.
 */

export interface AgentAnswer {
  agentId: string;
  answer: string;
  confidence?: number; // 0-1, optional
}

export interface ConsensusResult {
  winner: string;
  winnerAgentId: string;
  clusterSize: number;
  totalAnswers: number;
  runnerUps: string[];
  agreementRatio: number;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
}

function similarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

const SIMILARITY_THRESHOLD = 0.6;

export function runConsensus(answers: AgentAnswer[]): ConsensusResult | undefined {
  if (answers.length === 0) return undefined;
  if (answers.length === 1) {
    return {
      winner: answers[0].answer,
      winnerAgentId: answers[0].agentId,
      clusterSize: 1,
      totalAnswers: 1,
      runnerUps: [],
      agreementRatio: 100,
    };
  }

  // Greedy clustering
  const clusters: Array<{ representative: AgentAnswer; members: AgentAnswer[] }> = [];

  for (const answer of answers) {
    let placed = false;
    for (const cluster of clusters) {
      if (similarity(answer.answer, cluster.representative.answer) >= SIMILARITY_THRESHOLD) {
        cluster.members.push(answer);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ representative: answer, members: [answer] });
    }
  }

  // Sort by cluster size descending, then by avg confidence descending
  clusters.sort((a, b) => {
    if (b.members.length !== a.members.length) {
      return b.members.length - a.members.length;
    }
    const avgConf = (c: typeof clusters[0]) =>
      c.members.reduce((s, m) => s + (m.confidence ?? 0.5), 0) / c.members.length;
    return avgConf(b) - avgConf(a);
  });

  const winnerCluster = clusters[0];
  const runnerUpClusters = clusters.slice(1);

  // Pick the highest-confidence answer within the winner cluster as representative
  const bestInWinner = winnerCluster.members.reduce((best, curr) => {
    const bestConf = best.confidence ?? 0.5;
    const currConf = curr.confidence ?? 0.5;
    return currConf > bestConf ? curr : best;
  }, winnerCluster.members[0]);

  return {
    winner: bestInWinner.answer,
    winnerAgentId: bestInWinner.agentId,
    clusterSize: winnerCluster.members.length,
    totalAnswers: answers.length,
    runnerUps: runnerUpClusters.map((c) => c.representative.answer),
    agreementRatio: Math.round((winnerCluster.members.length / answers.length) * 1000) / 10,
  };
}
