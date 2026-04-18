import type { Claim } from "./types.ts";

export interface ContradictionReport {
  claimA: Claim;
  claimB: Claim;
  reason: string;
  severity: "low" | "medium" | "high";
  suggestedResolution?: string;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "and",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "as",
  "it",
  "this",
  "that",
  "的",
  "了",
  "在",
  "是",
  "我",
  "有",
  "和",
  "就",
  "不",
  "人",
  "都",
  "一",
  "一个",
  "上",
  "也",
  "很",
  "到",
  "说",
  "要",
  "去",
  "你",
  "会",
  "着",
  "没有",
  "看",
  "好",
  "自己",
  "这",
]);

const OPPOSITE_SENTIMENTS: Array<[string[], string[]]> = [
  [["喜欢", "love", "like", "enjoy"], ["讨厌", "hate", "dislike", "detest"]],
  [["fast", "quick", "rapid", "快", "迅速"], ["slow", "sluggish", "slowly", "慢", "缓慢"]],
  [["good", "great", "excellent", "好", "优秀", "棒"], ["bad", "terrible", "awful", "坏", "差", "糟糕"]],
  [["easy", "simple", "容易", "简单"], ["hard", "difficult", "complex", "难", "困难", "复杂"]],
  [["big", "large", "huge", "大"], ["small", "tiny", "little", "小"]],
  [["hot", "warm", "热", "暖"], ["cold", "cool", "冷", "凉"]],
  [["high", "高"], ["low", "低"]],
  [["more", "多"], ["less", "fewer", "少"]],
  [["true", "correct", "right", "真", "对"], ["false", "wrong", "incorrect", "假", "错"]],
  [["happy", "glad", "joyful", "开心", "高兴"], ["sad", "unhappy", "upset", "难过", "伤心"]],
  [["支持", "support", "agree", "赞成"], ["反对", "oppose", "disagree", "reject"]],
];

function extractKeywords(content: string): Set<string> {
  const words = content.toLowerCase().split(/[^\w\u4e00-\u9fa5]+/);
  const keywords = new Set<string>();
  for (const w of words) {
    if (w.length > 1 && !STOP_WORDS.has(w)) {
      keywords.add(w);
    }
  }
  return keywords;
}

function hasOverlappingKeywords(a: Claim, b: Claim): boolean {
  const kwA = extractKeywords(a.content);
  const kwB = extractKeywords(b.content);
  for (const k of kwA) {
    if (kwB.has(k)) return true;
  }
  return false;
}

function findOppositeSentiments(a: Claim, b: Claim): Array<{ wordA: string; wordB: string; pair: string }> {
  const contentA = a.content.toLowerCase();
  const contentB = b.content.toLowerCase();
  const results: Array<{ wordA: string; wordB: string; pair: string }> = [];

  for (const [groupA, groupB] of OPPOSITE_SENTIMENTS) {
    for (const wordA of groupA) {
      for (const wordB of groupB) {
        if (contentA.includes(wordA.toLowerCase()) && contentB.includes(wordB.toLowerCase())) {
          results.push({ wordA, wordB, pair: `${wordA} vs ${wordB}` });
        } else if (contentA.includes(wordB.toLowerCase()) && contentB.includes(wordA.toLowerCase())) {
          results.push({ wordA: wordB, wordB: wordA, pair: `${wordB} vs ${wordA}` });
        }
      }
    }
  }
  return results;
}

function checkContradiction(a: Claim, b: Claim): ContradictionReport | undefined {
  if (a.id === b.id) return undefined;
  if (a.category !== b.category) return undefined;

  if (!hasOverlappingKeywords(a, b)) return undefined;

  const opposites = findOppositeSentiments(a, b);
  const bothActive = a.status === "active" && b.status === "active";

  if (opposites.length > 0 && bothActive) {
    const severity: ContradictionReport["severity"] = opposites.length > 1 ? "high" : "medium";
    return {
      claimA: a,
      claimB: b,
      reason: `Active claims contain opposite sentiments (${opposites.map((o) => o.pair).join(", ")}) in category '${a.category}'`,
      severity,
      suggestedResolution: "Investigate context to determine which claim is current, or clarify conditions under which each applies.",
    };
  }

  return {
    claimA: a,
    claimB: b,
    reason: `Same category '${a.category}' with overlapping keywords`,
    severity: "low",
    suggestedResolution: "Verify whether these claims describe the same subject from different perspectives.",
  };
}

export function detectContradictions(claims: Claim[]): ContradictionReport[] {
  const reports: ContradictionReport[] = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const report = checkContradiction(claims[i], claims[j]);
      if (report) reports.push(report);
    }
  }
  return reports;
}

export function findPotentialContradictions(newClaim: Claim, existingClaims: Claim[]): ContradictionReport[] {
  const reports: ContradictionReport[] = [];
  for (const claim of existingClaims) {
    const report = checkContradiction(newClaim, claim);
    if (report) reports.push(report);
  }
  return reports;
}
