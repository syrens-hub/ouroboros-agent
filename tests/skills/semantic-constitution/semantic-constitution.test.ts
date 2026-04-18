import { describe, it, expect } from "vitest";
import { SemanticConstitutionChecker, type EvolutionSuggestion } from "../../../skills/semantic-constitution/index.ts";

describe("Semantic Constitution Checker", () => {
  const checker = new SemanticConstitutionChecker();

  describe("check (single file)", () => {
    it("allows safe file writes", () => {
      const result = checker.check({
        filePath: "skills/greet/index.ts",
        operation: "write",
        content: "export function greet() { return 'hi'; }",
        linesAdded: 5,
        linesRemoved: 0,
      });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("blocks modification of immutable paths", () => {
      const result = checker.check({
        filePath: "core/rule-engine.ts",
        operation: "write",
        content: "// changed",
        linesAdded: 1,
        linesRemoved: 0,
      });
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.level === "CRITICAL")).toBe(true);
    });

    it("blocks dangerous eval pattern", () => {
      const result = checker.check({
        filePath: "skills/test/index.ts",
        operation: "write",
        content: "const x = eval(userInput);",
        linesAdded: 1,
        linesRemoved: 0,
      });
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("eval"))).toBe(true);
    });

    it("blocks shell=true pattern", () => {
      const result = checker.check({
        filePath: "scripts/run.ts",
        operation: "write",
        content: 'childProcess.spawn("ls", { shell: true });',
        linesAdded: 1,
        linesRemoved: 0,
      });
      expect(result.violations.some((v) => v.message.includes("Shell"))).toBe(true);
      expect(result.violations.some((v) => v.level === "HIGH")).toBe(true);
    });

    it("flags oversized changes", () => {
      const result = checker.check({
        filePath: "skills/big/index.ts",
        operation: "write",
        content: "// big change",
        linesAdded: 600,
        linesRemoved: 0,
      });
      expect(result.violations.some((v) => v.article === "Change Control")).toBe(true);
    });

    it("detects distorted bible names", () => {
      const result = checker.check({
        filePath: "docs/B1BLE.md",
        operation: "write",
        content: "# fake",
        linesAdded: 1,
        linesRemoved: 0,
      });
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Distorted"))).toBe(true);
    });
  });

  describe("checkEvolution (multi-file)", () => {
    it("allows safe evolution", () => {
      const suggestion: EvolutionSuggestion = {
        filesChanged: ["skills/greet/index.ts"],
        description: "Add greeting",
        linesAdded: 10,
        linesRemoved: 2,
      };
      const result = checker.checkEvolution(suggestion);
      expect(result.passed).toBe(true);
    });

    it("flags impact chain (config → infrastructure)", () => {
      const suggestion: EvolutionSuggestion = {
        filesChanged: ["core/config.ts", "skills/event-bus/index.ts"],
        description: "Update config and event bus",
        linesAdded: 20,
        linesRemoved: 5,
      };
      const result = checker.checkEvolution(suggestion);
      expect(result.violations.some((v) => v.message.includes("Config changes") || v.message.includes("config"))).toBe(true);
    });

    it("flags too many files changed", () => {
      const suggestion: EvolutionSuggestion = {
        filesChanged: Array.from({ length: 12 }, (_, i) => `skills/mod${i}/index.ts`),
        description: "Big refactor",
        linesAdded: 100,
        linesRemoved: 50,
      };
      const result = checker.checkEvolution(suggestion);
      expect(result.violations.some((v) => v.message.includes("files changed"))).toBe(true);
    });

    it("calculates risk score correctly", () => {
      const suggestion: EvolutionSuggestion = {
        filesChanged: ["core/rule-engine.ts", "core/config.ts"],
        description: "Bad idea",
        linesAdded: 10,
        linesRemoved: 5,
      };
      const result = checker.checkEvolution(suggestion);
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.passed).toBe(false);
    });
  });
});
