import { describe, it, expect } from "vitest";
import { createMockLLMCaller } from "../../../skills/agent-loop/llm-callers.ts";

describe("createMockLLMCaller", () => {
  it("returns greeting for hello", async () => {
    const caller = createMockLLMCaller();
    const result = await caller.call([{ role: "user", content: "hello" }], []);
    expect(result.role).toBe("assistant");
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("Ouroboros");
  });

  it("returns skill write for learn directive", async () => {
    const caller = createMockLLMCaller();
    const result = await caller.call([{ role: "user", content: "learn this: testing" }], [
      { name: "write_skill", inputSchema: { _def: { typeName: "ZodObject" } } as unknown as import("zod").ZodTypeAny, call: async () => ({ success: true }) } as unknown as import("../../../types/index.ts").Tool<unknown, unknown, unknown>,
    ]);
    expect(result.role).toBe("assistant");
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("returns generic echo for unknown input", async () => {
    const caller = createMockLLMCaller();
    const result = await caller.call([{ role: "user", content: "random query" }], []);
    expect(result.role).toBe("assistant");
    expect(typeof result.content).toBe("string");
  });
});
