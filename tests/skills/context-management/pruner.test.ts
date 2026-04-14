import { describe, it, expect } from "vitest";
import {
  ContextPruner,
  calculateTokenCount,
  type ContextMessage,
  type PruningConfig,
} from "../../../skills/context-management/pruner.ts";

const baseConfig: PruningConfig = {
  strategy: "balanced",
  targetTokens: 100,
  minMessages: 2,
  maxMessages: 10,
  preserveSystem: true,
  preserveFirstUserMessage: true,
  preserveToolResults: true,
  preserveRecentMessages: 2,
  importanceThreshold: 0,
};

function msg(
  id: string,
  role: ContextMessage["role"],
  content: string,
  extra: Partial<Omit<ContextMessage, "id" | "role" | "content">> = {}
): ContextMessage {
  return {
    id,
    role,
    content,
    tokenCount: extra.tokenCount ?? calculateTokenCount(content),
    ...extra,
  };
}

describe("calculateTokenCount", () => {
  it("calculates tokens for english text", () => {
    expect(calculateTokenCount("hello world")).toBe(
      Math.ceil(0 / 2) + Math.ceil(2 / 4) + Math.ceil(1 / 8)
    );
  });

  it("calculates tokens for chinese text", () => {
    expect(calculateTokenCount("你好")).toBe(
      Math.ceil(2 / 2) + Math.ceil(0 / 4) + Math.ceil(0 / 8)
    );
  });

  it("calculates tokens for mixed text", () => {
    expect(calculateTokenCount("你好 world")).toBe(
      Math.ceil(2 / 2) + Math.ceil(1 / 4) + Math.ceil(1 / 8)
    );
  });
});

describe("ContextPruner", () => {
  describe("aggressive strategy", () => {
    it("keeps only system, preserved, and recent", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system prompt"),
        msg("m2", "user", "first user"),
        msg("m3", "assistant", "assistant one"),
        msg("m4", "user", "second user"),
        msg("m5", "assistant", "assistant two"),
        msg("m6", "tool", "tool result"),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 1000,
        preserveRecentMessages: 2,
      });
      expect(result.remainingMessages.map((m) => m.id)).toEqual([
        "m1",
        "m2",
        "m4",
        "m5",
        "m6",
      ]);
      expect(result.removedMessages.map((m) => m.id)).toEqual(["m3"]);
      expect(result.strategy).toBe("aggressive");
    });

    it("drops recent if over target tokens", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system", { tokenCount: 5 }),
        msg("m2", "user", "first", { tokenCount: 5 }),
        msg("m3", "assistant", "recent1", { tokenCount: 10 }),
        msg("m4", "assistant", "recent2", { tokenCount: 10 }),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 15,
        preserveRecentMessages: 2,
      });
      expect(result.totalTokens).toBeLessThanOrEqual(15);
      expect(result.remainingMessages.map((m) => m.id)).not.toContain("m3");
      expect(result.remainingMessages.map((m) => m.id)).not.toContain("m4");
    });
  });

  describe("conservative strategy", () => {
    it("keeps all messages when under target tokens", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system"),
        msg("m2", "user", "first"),
        msg("m3", "assistant", "regular one"),
        msg("m4", "user", "second"),
        msg("m5", "assistant", "regular two"),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "conservative",
        targetTokens: 1000,
        preserveRecentMessages: 2,
      });
      expect(result.remainingMessages.map((m) => m.id)).toEqual([
        "m1",
        "m2",
        "m3",
        "m4",
        "m5",
      ]);
      expect(result.removedMessages).toHaveLength(0);
    });

    it("drops low-importance regular first when over target", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system", { tokenCount: 5 }),
        msg("m2", "user", "first", { tokenCount: 5 }),
        msg("m3", "assistant", "low", { tokenCount: 10, importanceScore: 0.1 }),
        msg("m4", "assistant", "high", {
          tokenCount: 10,
          importanceScore: 0.9,
        }),
        msg("m5", "user", "recent", { tokenCount: 5 }),
        msg("m6", "assistant", "recent", { tokenCount: 5 }),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "conservative",
        targetTokens: 30,
        preserveRecentMessages: 2,
      });
      expect(result.remainingMessages.map((m) => m.id)).toEqual([
        "m1",
        "m2",
        "m4",
        "m5",
        "m6",
      ]);
      expect(result.totalTokens).toBe(30);
    });
  });

  describe("balanced strategy", () => {
    it("adds regular messages by importance score", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system", { tokenCount: 5 }),
        msg("m2", "user", "first", { tokenCount: 5 }),
        msg("m3", "assistant", "low", { tokenCount: 10, importanceScore: 0.1 }),
        msg("m4", "assistant", "high", {
          tokenCount: 10,
          importanceScore: 0.9,
        }),
        msg("m5", "user", "recent", { tokenCount: 5 }),
        msg("m6", "assistant", "recent", { tokenCount: 5 }),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "balanced",
        targetTokens: 30,
        preserveRecentMessages: 2,
        importanceThreshold: 0,
      });
      expect(result.remainingMessages.map((m) => m.id)).toEqual([
        "m1",
        "m2",
        "m4",
        "m5",
        "m6",
      ]);
    });

    it("respects importance threshold", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system", { tokenCount: 5 }),
        msg("m2", "user", "first", { tokenCount: 5 }),
        msg("m3", "assistant", "below threshold", {
          tokenCount: 5,
          importanceScore: 0.3,
        }),
        msg("m4", "assistant", "above threshold", {
          tokenCount: 5,
          importanceScore: 0.8,
        }),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "balanced",
        targetTokens: 100,
        preserveRecentMessages: 0,
        importanceThreshold: 0.5,
      });
      expect(result.remainingMessages.some((m) => m.id === "m3")).toBe(false);
      expect(result.remainingMessages.some((m) => m.id === "m4")).toBe(true);
    });
  });

  describe("intelligent strategy", () => {
    it("prefers messages with keyword relevance to recent messages", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system"),
        msg("m2", "user", "first user"),
        msg("m3", "assistant", "the api returned an error"),
        msg("m4", "assistant", "cats are cute"),
        msg("m5", "user", "api error happened"),
        msg("m6", "assistant", "fix the api"),
      ];
      const baseTokens =
        calculateTokenCount("system") +
        calculateTokenCount("first user") +
        calculateTokenCount("api error happened") +
        calculateTokenCount("fix the api");
      const relevanceTokens =
        baseTokens + calculateTokenCount("the api returned an error");
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "intelligent",
        targetTokens: relevanceTokens,
        preserveRecentMessages: 2,
        importanceThreshold: 0,
      });
      expect(result.remainingMessages.some((m) => m.id === "m3")).toBe(true);
      expect(result.remainingMessages.some((m) => m.id === "m4")).toBe(false);
    });
  });

  describe("preservation rules", () => {
    it("always preserves system messages", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system"),
        msg("m2", "user", "user"),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 1,
        preserveRecentMessages: 0,
      });
      expect(result.remainingMessages.some((m) => m.id === "m1")).toBe(true);
    });

    it("preserves first user message when configured", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system"),
        msg("m2", "user", "first"),
        msg("m3", "user", "second"),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 1000,
        preserveFirstUserMessage: true,
        preserveRecentMessages: 0,
      });
      expect(result.remainingMessages.some((m) => m.id === "m2")).toBe(true);
    });

    it("does not preserve first user message when disabled", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system"),
        msg("m2", "user", "first"),
        msg("m3", "user", "second"),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 1000,
        preserveFirstUserMessage: false,
        preserveRecentMessages: 0,
        minMessages: 1,
      });
      expect(result.remainingMessages.some((m) => m.id === "m2")).toBe(false);
    });

    it("preserves tool results when configured", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system"),
        msg("m2", "tool", "result"),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 1000,
        preserveToolResults: true,
        preserveRecentMessages: 0,
      });
      expect(result.remainingMessages.some((m) => m.id === "m2")).toBe(true);
    });

    it("preserves messages marked as preserved", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system"),
        msg("m2", "assistant", "important", { preserved: true }),
        msg("m3", "assistant", "regular"),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 1000,
        preserveRecentMessages: 0,
      });
      expect(result.remainingMessages.some((m) => m.id === "m2")).toBe(true);
      expect(result.remainingMessages.some((m) => m.id === "m3")).toBe(false);
    });
  });

  describe("token and message limits", () => {
    it("enforces maxMessages", () => {
      const messages: ContextMessage[] = Array.from({ length: 10 }, (_, i) =>
        msg(`m${i + 1}`, "assistant", `msg ${i + 1}`, { tokenCount: 1 })
      );
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "conservative",
        targetTokens: 1000,
        preserveRecentMessages: 0,
        preserveSystem: false,
        preserveFirstUserMessage: false,
        maxMessages: 5,
      });
      expect(result.remainingMessages.length).toBeLessThanOrEqual(5);
    });

    it("enforces minMessages", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system", { tokenCount: 100 }),
        msg("m2", "assistant", "msg2", { tokenCount: 100 }),
        msg("m3", "assistant", "msg3", { tokenCount: 100 }),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 50,
        preserveRecentMessages: 0,
        preserveSystem: false,
        preserveFirstUserMessage: false,
        minMessages: 2,
      });
      expect(result.remainingMessages.length).toBeGreaterThanOrEqual(2);
    });

    it("totalTokens reflects remaining messages", () => {
      const messages: ContextMessage[] = [
        msg("m1", "system", "system", { tokenCount: 5 }),
        msg("m2", "user", "user", { tokenCount: 5 }),
        msg("m3", "assistant", "drop", { tokenCount: 10 }),
      ];
      const result = ContextPruner.prune(messages, {
        ...baseConfig,
        strategy: "aggressive",
        targetTokens: 10,
        preserveRecentMessages: 0,
      });
      const expectedTokens = result.remainingMessages.reduce(
        (sum, m) => sum + m.tokenCount,
        0
      );
      expect(result.totalTokens).toBe(expectedTokens);
      expect(result.totalTokens).toBeLessThanOrEqual(10);
    });
  });
});
