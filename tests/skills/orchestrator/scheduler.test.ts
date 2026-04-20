import { describe, it, expect } from "vitest";
import { evaluateTaskPriority } from "../../../skills/orchestrator/scheduler.ts";

describe("evaluateTaskPriority", () => {
  it("routes code tasks to cpu pool", () => {
    const result = evaluateTaskPriority("Parse and lint all TypeScript files in the project");
    expect(result.targetPool).toBe("cpu");
    expect(result.level).toBeGreaterThanOrEqual(1);
    expect(result.level).toBeLessThanOrEqual(4);
    expect(result.estimatedComplexity).toBeGreaterThanOrEqual(1);
    expect(result.estimatedComplexity).toBeLessThanOrEqual(10);
  });

  it("routes file/io tasks to io pool", () => {
    const result = evaluateTaskPriority("Read the package.json and list all dependencies");
    expect(result.targetPool).toBe("io");
  });

  it("routes browser tasks to io pool", () => {
    const result = evaluateTaskPriority("Navigate to example.com and take a screenshot");
    expect(result.targetPool).toBe("io");
  });

  it("routes llm tasks to llm pool", () => {
    const result = evaluateTaskPriority("Summarize the following article and extract key points");
    expect(result.targetPool).toBe("llm");
  });

  it("routes creative tasks to llm pool", () => {
    const result = evaluateTaskPriority("Draft a marketing email for the product launch");
    expect(result.targetPool).toBe("llm");
  });

  it("falls back when no strong signal", () => {
    const result = evaluateTaskPriority("Do the thing");
    expect(result.targetPool).toBe("fallback");
  });

  it("elevates priority for security tasks", () => {
    const result = evaluateTaskPriority("Audit authentication flow for vulnerabilities");
    expect(result.level).toBe(4);
  });

  it("elevates priority for evolution tasks", () => {
    const result = evaluateTaskPriority("Auto-evolve the skill registry based on usage patterns");
    expect(result.level).toBe(3);
  });

  it("uses normal priority for implementation tasks", () => {
    const result = evaluateTaskPriority("Implement a new API endpoint for user profiles");
    expect(result.level).toBe(2);
  });

  it("uses low priority for telemetry tasks", () => {
    const result = evaluateTaskPriority("Collect metrics and log performance data");
    expect(result.level).toBe(1);
  });

  it("incorporates taskName into routing", () => {
    const result = evaluateTaskPriority("Process the data", "batch-compression");
    expect(result.targetPool).toBe("cpu");
  });

  it("increases complexity for batch tasks", () => {
    const simple = evaluateTaskPriority("Quick fix");
    const batch = evaluateTaskPriority("Process all files recursively in the directory");
    expect(batch.estimatedComplexity).toBeGreaterThan(simple.estimatedComplexity);
  });

  it("decreases complexity for simple tasks", () => {
    const result = evaluateTaskPriority("Simple quick brief task");
    expect(result.estimatedComplexity).toBeLessThanOrEqual(3);
  });
});
