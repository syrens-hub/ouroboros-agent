import { describe, it, expect } from "vitest";
import { estimateInjectionTokens, buildMemoryLayerInjection, buildKbInjection } from "../../skills/agent-loop/context-utils.ts";

describe("context-utils", () => {
  it("estimates tokens for english text", () => {
    const tokens = estimateInjectionTokens("hello world test");
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates tokens for cjk text", () => {
    const tokens = estimateInjectionTokens("你好世界");
    expect(tokens).toBeGreaterThan(0);
  });

  it("builds memory layer injection", () => {
    const injection = buildMemoryLayerInjection([
      { layer: "episodic", summary: "Memory A", content: "Memory A detail" },
      { layer: "semantic", summary: "Memory B", content: "Memory B detail" },
    ]);
    expect(injection.content).toContain("Memory A");
    expect(injection.priority).toBeGreaterThan(0);
  });

  it("builds kb injection", () => {
    const injection = buildKbInjection([
      { content: "KB A" },
    ]);
    expect(injection.content).toContain("KB A");
  });
});
