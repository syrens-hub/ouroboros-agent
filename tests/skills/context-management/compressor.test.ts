import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextCompressor, SUMMARY_PREFIX, PRUNED_TOOL_PLACEHOLDER } from "../../../skills/context-management/compressor.ts";
import type { BaseMessage } from "../../../types/index.ts";

const mockCallAuxiliary = vi.fn();

vi.mock("../../../core/auxiliary-llm.ts", () => ({
  callAuxiliary: (...args: any[]) => mockCallAuxiliary(...args),
}));

describe("ContextCompressor", () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    compressor = new ContextCompressor();
    mockCallAuxiliary.mockReset();
  });

  it("returns original messages when under threshold", async () => {
    const messages: BaseMessage[] = [
      { role: "system", content: "You are Ouroboros" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = await compressor.compress(messages, { threshold: 10000 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(messages);
    }
  });

  it("prunes old tool results", () => {
    const messages: BaseMessage[] = [
      { role: "user", content: "run" },
      { role: "tool_result", content: "result-1" },
      { role: "tool_result", content: "result-2" },
      { role: "tool_result", content: "result-3" },
      { role: "tool_result", content: "result-4" },
      { role: "tool_result", content: "result-5" },
    ];
    const pruned = compressor.pruneToolResults(messages, 3);
    // Last 3 tool_results are kept (indices 5,4,3)
    expect(pruned[1].content).toBe(PRUNED_TOOL_PLACEHOLDER);
    expect(pruned[2].content).toBe(PRUNED_TOOL_PLACEHOLDER);
    expect(pruned[3].content).toBe("result-3");
    expect(pruned[4].content).toBe("result-4");
    expect(pruned[5].content).toBe("result-5");
  });

  it("protects head and tail by token budget", () => {
    const messages: BaseMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ];
    const { head, middle, tail } = compressor.protectHeadAndTail(messages, 10);
    expect(head.length).toBeGreaterThanOrEqual(1);
    expect(tail.length).toBeGreaterThanOrEqual(1);
    expect(head.length + middle.length + tail.length).toBe(messages.length);
  });

  it("injects summary with prefix when compressing", async () => {
    const longContent = "a".repeat(3000);
    const messages: BaseMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
    ];

    mockCallAuxiliary.mockResolvedValue({
      success: true,
      data: { role: "assistant", content: "Summary: all good" },
    });

    const result = await compressor.compress(messages, { threshold: 100, tailTokenBudget: 200 });
    expect(result.success).toBe(true);
    if (result.success) {
      const summaryMsg = result.data.find(
        (m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith(SUMMARY_PREFIX)
      );
      expect(summaryMsg).toBeDefined();
    }
  });

  it("reuses previous summary on iterative compression", async () => {
    mockCallAuxiliary.mockResolvedValue({
      success: true,
      data: { role: "assistant", content: "Iterated summary" },
    });

    const messages: BaseMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(500),
    }));

    await compressor.compress(messages, { threshold: 100, tailTokenBudget: 200 });
    expect(mockCallAuxiliary).toHaveBeenCalledTimes(1);
    const prompt = mockCallAuxiliary.mock.calls[0][1];
    const userMsg = prompt.find((m: any) => m.role === "user");
    expect(userMsg.content).not.toContain("Previous summary");

    await compressor.compress(messages, { threshold: 100, tailTokenBudget: 200 });
    expect(mockCallAuxiliary).toHaveBeenCalledTimes(2);
    const prompt2 = mockCallAuxiliary.mock.calls[1][1];
    const userMsg2 = prompt2.find((m: any) => m.role === "user");
    expect(userMsg2.content).toContain("Previous summary");
  });
});
