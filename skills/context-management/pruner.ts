export type PruningStrategy = "balanced" | "aggressive" | "conservative" | "intelligent";

export interface PruningConfig {
  strategy: PruningStrategy;
  targetTokens: number;
  minMessages: number;
  maxMessages: number;
  preserveSystem: boolean;
  preserveFirstUserMessage: boolean;
  preserveToolResults: boolean;
  preserveRecentMessages: number;
  importanceThreshold: number;
}

export interface ContextMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokenCount: number;
  importanceScore?: number;
  preserved?: boolean;
}

export interface PruningResult {
  remainingMessages: ContextMessage[];
  removedMessages: ContextMessage[];
  totalTokens: number;
  strategy: PruningStrategy;
  summary: string;
}

const defaultConfig: PruningConfig = {
  strategy: "balanced",
  targetTokens: 4096,
  minMessages: 2,
  maxMessages: 100,
  preserveSystem: true,
  preserveFirstUserMessage: true,
  preserveToolResults: true,
  preserveRecentMessages: 4,
  importanceThreshold: 0,
};

export function calculateTokenCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const englishWordChars = (text.match(/[a-zA-Z]+/g) || []).reduce(
    (sum, word) => sum + word.length,
    0
  );
  const otherChars = text.length - chineseChars - englishWordChars;
  return (
    Math.ceil(chineseChars / 2) +
    Math.ceil(englishWords / 4) +
    Math.ceil(otherChars / 8)
  );
}

function findLastIndex<T>(
  arr: T[],
  predicate: (value: T) => boolean
): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i;
  }
  return -1;
}

function extractKeywords(messages: ContextMessage[]): string[] {
  const words = new Set<string>();
  for (const msg of messages) {
    const matches = msg.content.toLowerCase().match(/[a-z]{3,}/g);
    if (matches) {
      for (const word of matches) {
        words.add(word);
      }
    }
  }
  return Array.from(words);
}

function calculateKeywordRelevance(
  content: string,
  keywords: string[]
): number {
  const contentWords = content.toLowerCase().match(/[a-z]{3,}/g) || [];
  let score = 0;
  for (const word of contentWords) {
    if (keywords.includes(word)) score++;
  }
  return score;
}

export class ContextPruner {
  static prune(
    messages: ContextMessage[],
    config?: Partial<PruningConfig>
  ): PruningResult {
    const cfg: PruningConfig = { ...defaultConfig, ...config };

    const systemMessages: ContextMessage[] = [];
    const preservedMessages: ContextMessage[] = [];
    const recentMessages: ContextMessage[] = [];
    const regularMessages: ContextMessage[] = [];

    let firstUserFound = false;
    const candidates: ContextMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system" && cfg.preserveSystem) {
        systemMessages.push(msg);
      } else if (msg.preserved) {
        preservedMessages.push(msg);
      } else if (msg.role === "tool" && cfg.preserveToolResults) {
        preservedMessages.push(msg);
      } else if (
        msg.role === "user" &&
        cfg.preserveFirstUserMessage &&
        !firstUserFound
      ) {
        firstUserFound = true;
        preservedMessages.push(msg);
      } else {
        candidates.push(msg);
      }
    }

    const recentCount = Math.min(cfg.preserveRecentMessages, candidates.length);
    recentMessages.push(...candidates.slice(candidates.length - recentCount));
    regularMessages.push(...candidates.slice(0, candidates.length - recentCount));

    const protectedIds = new Set(
      [...systemMessages, ...preservedMessages].map((m) => m.id)
    );

    let remaining: ContextMessage[] = [];

    switch (cfg.strategy) {
      case "aggressive": {
        remaining = [...systemMessages, ...preservedMessages, ...recentMessages];
        let tokens = remaining.reduce((sum, m) => sum + m.tokenCount, 0);
        const minProtected = systemMessages.length + preservedMessages.length;
        while (
          tokens > cfg.targetTokens &&
          remaining.length > minProtected + Math.max(0, cfg.minMessages - minProtected)
        ) {
          const dropIdx = findLastIndex(
            remaining,
            (m) => recentMessages.includes(m) && !protectedIds.has(m.id)
          );
          if (dropIdx === -1) break;
          const dropped = remaining.splice(dropIdx, 1)[0]!;
          tokens -= dropped.tokenCount;
        }
        break;
      }
      case "conservative": {
        remaining = [
          ...systemMessages,
          ...preservedMessages,
          ...recentMessages,
          ...regularMessages,
        ];
        let tokens = remaining.reduce((sum, m) => sum + m.tokenCount, 0);
        const regularByImportance = [...regularMessages].sort(
          (a, b) => (a.importanceScore ?? 0) - (b.importanceScore ?? 0)
        );
        for (const msg of regularByImportance) {
          if (tokens <= cfg.targetTokens) break;
          if (remaining.length <= cfg.minMessages) break;
          const idx = remaining.indexOf(msg);
          if (idx !== -1) {
            remaining.splice(idx, 1);
            tokens -= msg.tokenCount;
          }
        }
        while (tokens > cfg.targetTokens && remaining.length > cfg.minMessages) {
          const dropIdx = findLastIndex(
            remaining,
            (m) => recentMessages.includes(m) && !protectedIds.has(m.id)
          );
          if (dropIdx === -1) break;
          const dropped = remaining.splice(dropIdx, 1)[0]!;
          tokens -= dropped.tokenCount;
        }
        break;
      }
      case "balanced": {
        remaining = [...systemMessages, ...preservedMessages, ...recentMessages];
        let tokens = remaining.reduce((sum, m) => sum + m.tokenCount, 0);
        const sortedRegular = [...regularMessages].sort(
          (a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0)
        );
        for (const msg of sortedRegular) {
          if (tokens + msg.tokenCount > cfg.targetTokens) break;
          if (remaining.length >= cfg.maxMessages) break;
          if (
            msg.importanceScore !== undefined &&
            msg.importanceScore < cfg.importanceThreshold
          ) {
            continue;
          }
          remaining.push(msg);
          tokens += msg.tokenCount;
        }
        break;
      }
      case "intelligent": {
        remaining = [...systemMessages, ...preservedMessages, ...recentMessages];
        const keywords = extractKeywords(recentMessages);
        let tokens = remaining.reduce((sum, m) => sum + m.tokenCount, 0);
        const scoredRegular = regularMessages.map((msg) => ({
          msg,
          score:
            (msg.importanceScore ?? 0) +
            calculateKeywordRelevance(msg.content, keywords),
        }));
        scoredRegular.sort((a, b) => b.score - a.score);
        for (const { msg } of scoredRegular) {
          if (tokens + msg.tokenCount > cfg.targetTokens) break;
          if (remaining.length >= cfg.maxMessages) break;
          if (
            msg.importanceScore !== undefined &&
            msg.importanceScore < cfg.importanceThreshold
          ) {
            continue;
          }
          remaining.push(msg);
          tokens += msg.tokenCount;
        }
        break;
      }
    }

    // Ensure minMessages
    if (remaining.length < cfg.minMessages) {
      for (const msg of messages) {
        if (remaining.includes(msg)) continue;
        remaining.push(msg);
        if (remaining.length >= cfg.minMessages) break;
      }
    }

    // Ensure maxMessages
    if (remaining.length > cfg.maxMessages) {
      while (remaining.length > cfg.maxMessages) {
        const dropIdx = findLastIndex(
          remaining,
          (m) => !protectedIds.has(m.id)
        );
        if (dropIdx === -1) break;
        remaining.splice(dropIdx, 1);
      }
    }

    // Maintain original order
    const remainingIds = new Set(remaining.map((m) => m.id));
    const orderedRemaining = messages.filter((m) => remainingIds.has(m.id));
    const removed = messages.filter((m) => !remainingIds.has(m.id));
    const totalTokens = orderedRemaining.reduce((sum, m) => sum + m.tokenCount, 0);

    return {
      remainingMessages: orderedRemaining,
      removedMessages: removed,
      totalTokens,
      strategy: cfg.strategy,
      summary: `Pruned ${messages.length} messages to ${orderedRemaining.length} using ${cfg.strategy} strategy. Removed ${removed.length} messages.`,
    };
  }
}
