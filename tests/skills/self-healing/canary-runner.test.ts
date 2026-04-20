import { describe, it, expect } from "vitest";
import { runCanaryTests } from "../../../skills/self-healing/canary-runner.ts";

describe("canary-runner", () => {
  it("returns success placeholder when no script", async () => {
    const result = await runCanaryTests();
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects scripts with disallowed patterns", async () => {
    const result = await runCanaryTests("require('fs')");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("disallowed");
  });

  it("rejects scripts with eval", async () => {
    const result = await runCanaryTests("eval('1+1')");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("disallowed");
  });

  it("rejects scripts with new Function", async () => {
    const result = await runCanaryTests("new Function('return 1')");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("disallowed");
  });

  it("rejects scripts with child_process", async () => {
    const result = await runCanaryTests("child_process.exec('ls')");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("disallowed");
  });

  it("rejects overly long scripts", async () => {
    const result = await runCanaryTests("console.log(1);".repeat(1000));
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("disallowed");
  });

  it("runs safe script successfully", async () => {
    const result = await runCanaryTests("console.log('hello')");
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello");
  });

  it("runs safe script with error exit code", async () => {
    const result = await runCanaryTests("process.exit(1)");
    expect(result.success).toBe(false);
  });
});
