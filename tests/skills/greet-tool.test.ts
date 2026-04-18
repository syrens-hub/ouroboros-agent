import { describe, it, expect } from "vitest";
import { greetTool } from "../../skills/greet-tool/index.ts";

describe("greet-tool", () => {
  it("greets in English by default", async () => {
    const result = await greetTool.call({ name: "Alice" }, {} as any);
    expect(result.message).toContain("Alice");
    expect(result.message).toContain("Hello");
  });

  it("greets in Chinese", async () => {
    const result = await greetTool.call({ name: "Bob", language: "zh" }, {} as any);
    expect(result.message).toContain("Bob");
    expect(result.message).toContain("你好");
  });

  it("greets in Japanese", async () => {
    const result = await greetTool.call({ name: "Carol", language: "jp" }, {} as any);
    expect(result.message).toContain("Carol");
    expect(result.message).toContain("こんにちは");
  });

  it("falls back to English for unsupported language", async () => {
    const result = await greetTool.call({ name: "Dave", language: "fr" as any }, {} as any);
    expect(result.message).toContain("Hello");
    expect(result.message).toContain("Dave");
  });

  it("is marked read-only and concurrency-safe", () => {
    expect(greetTool.name).toBe("greet");
    expect(greetTool.isReadOnly).toBe(true);
    expect(typeof greetTool.isConcurrencySafe === "function" ? greetTool.isConcurrencySafe({}) : greetTool.isConcurrencySafe).toBe(true);
  });
});
