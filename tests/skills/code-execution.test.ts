import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { SandboxRunner } from "../../skills/code-execution/index.ts";

const runner = new SandboxRunner();

describe("SandboxRunner", () => {
  it("executes TypeScript code", async () => {
    const result = await runner.run("typescript", `console.log("hello ts");`);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello ts");
    expect(result.timed_out).toBe(false);
  });

  it("executes JavaScript code", async () => {
    const result = await runner.run("javascript", `console.log("hello js");`);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello js");
    expect(result.timed_out).toBe(false);
  });

  it("executes Python code", async () => {
    const result = await runner.run("python", `print("hello py")`);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello py");
    expect(result.timed_out).toBe(false);
  });

  it("captures stderr on error", async () => {
    const result = await runner.run("javascript", `throw new Error("oops");`);
    expect(result.exit_code).not.toBe(0);
    expect(result.stderr).toContain("oops");
  });

  it("times out infinite loops", async () => {
    const result = await runner.run("javascript", `while(true){}`, {
      timeoutMs: 500,
    });
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBe(-1);
  });

  it("passes stdin to the process", async () => {
    const code = `
const chunks = [];
process.stdin.on("data", d => chunks.push(d));
process.stdin.on("end", () => {
  console.log(chunks.join(""));
});
`;
    const result = await runner.run("javascript", code, { stdin: "world" });
    expect(result.stdout).toContain("world");
    expect(result.exit_code).toBe(0);
  });

  it("passes stdin to python", async () => {
    const code = `import sys; print(sys.stdin.read().strip())`;
    const result = await runner.run("python", code, { stdin: "python-input" });
    expect(result.stdout).toContain("python-input");
    expect(result.exit_code).toBe(0);
  });

  it("sanitizes sensitive env variables", async () => {
    process.env.LLM_API_KEY = "sk-secret-test";
    process.env.MY_SAFE_VAR = "visible";
    const code = `console.log(process.env.LLM_API_KEY || "missing"); console.log(process.env.MY_SAFE_VAR || "missing");`;
    const result = await runner.run("javascript", code);
    expect(result.stdout).toContain("missing");
    expect(result.stdout).toContain("visible");
    delete process.env.LLM_API_KEY;
    delete process.env.MY_SAFE_VAR;
  });

  it("cleans up sandbox directory after run", async () => {
    const before = new Set(
      existsSync(join(process.cwd(), ".ouroboros", "sandbox"))
        ? require("fs").readdirSync(join(process.cwd(), ".ouroboros", "sandbox"))
        : []
    );
    await runner.run("javascript", `console.log("cleanup test");`);
    const after = new Set(
      existsSync(join(process.cwd(), ".ouroboros", "sandbox"))
        ? require("fs").readdirSync(join(process.cwd(), ".ouroboros", "sandbox"))
        : []
    );
    // If new dirs appeared, they should have been cleaned up
    const newDirs = Array.from(after).filter((d) => !before.has(d));
    // Allow at most 0 leftover dirs; if any exist they are likely from concurrent tests
    for (const d of newDirs) {
      const path = join(process.cwd(), ".ouroboros", "sandbox", d as string);
      expect(existsSync(path)).toBe(false);
    }
  });

  it("rejects code over 100KB", async () => {
    const hugeCode = "x".repeat(100_001);
    const result = await runner.run("javascript", hugeCode);
    expect(result.exit_code).toBe(-1);
    expect(result.stderr).toContain("100KB");
  });
});
