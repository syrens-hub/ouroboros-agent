import { describe, it, expect } from "vitest";
import { ContextManager } from "../../../skills/context-management/index.ts";
import type { BaseMessage } from "../../../types/index.ts";

describe("ContextManager", () => {
  it("prunes and preserves system messages", async () => {
    const cm = new ContextManager();
    const messages: BaseMessage[] = [
      { role: "system", content: "You are Ouroboros" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = await cm.buildContext({ messages, pruning: { targetTokens: 1000 } });
    expect(result.messages.length).toBe(3);
    expect(result.messages[0].role).toBe("system");
  });

  it("injects system items into existing system message", async () => {
    const cm = new ContextManager();
    const messages: BaseMessage[] = [
      { role: "system", content: "You are Ouroboros" },
      { role: "user", content: "hello" },
    ];
    const result = await cm.buildContext({
      messages,
      injections: [
        { id: "inj1", content: "User prefers concise answers.", tokenCount: 5, priority: 1, enabled: true, point: "system" },
      ],
    });
    const systemMsg = result.messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("User prefers concise answers.");
  });

  it("injects non-system items before last user message", async () => {
    const cm = new ContextManager();
    const messages: BaseMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ];
    const result = await cm.buildContext({
      messages,
      injections: [
        { id: "inj1", content: "Context: project X", tokenCount: 3, priority: 1, enabled: true, point: "pre_user" },
      ],
    });
    const userIdx = result.messages.findLastIndex((m) => m.role === "user");
    expect(userIdx).toBeGreaterThan(0);
    expect(result.messages[userIdx - 1].role).toBe("user");
    expect(result.messages[userIdx - 1].name).toBe("context_injector");
  });

  it("respects maxInjectionTokens", async () => {
    const cm = new ContextManager();
    const messages: BaseMessage[] = [{ role: "system", content: "sys" }];
    const result = await cm.buildContext({
      messages,
      injections: [
        { id: "inj1", content: "A", tokenCount: 5, priority: 2, enabled: true, point: "system" },
        { id: "inj2", content: "B", tokenCount: 10, priority: 1, enabled: true, point: "system" },
      ],
      maxInjectionTokens: 5,
    });
    const systemMsg = result.messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("A");
    expect(systemMsg?.content).not.toContain("B");
    expect(result.injectionResult?.injectedCount).toBe(1);
    expect(result.injectionResult?.skippedCount).toBe(1);
  });

  it("applies aggressive pruning when over token budget", async () => {
    const cm = new ContextManager();
    const longMessages: BaseMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i} `.repeat(50),
    }));
    const messages: BaseMessage[] = [
      { role: "system", content: "sys" },
      ...longMessages,
      { role: "assistant", content: "ok" },
    ];
    const result = await cm.buildContext({
      messages,
      pruning: { strategy: "aggressive", targetTokens: 100, preserveRecentMessages: 2 },
    });
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.pruningStats?.compressionRatio).toBeGreaterThan(0);
  });
});
