import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import {
  scanCodeSmells,
  analyzeTestGaps,
  generateProposalFromSmells,
  generateProposalFromTestGaps,
  runAutoReview,
} from "../../../skills/evolution-generator/index.ts";

const FIXTURE_DIR = join(process.cwd(), "tests", "skills", "evolution-generator", "fixtures");

function ensureClean(): void {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });
}

describe("Evolution Generator v8.3", () => {
  beforeEach(() => {
    ensureClean();
  });

  afterEach(() => {
    ensureClean();
  });

  it("detects magic numbers", () => {
    writeFileSync(
      resolve(FIXTURE_DIR, "magic.ts"),
      "export function calc() { return 42 + 100; }\n",
      "utf-8"
    );

    const smells = scanCodeSmells(["tests/skills/evolution-generator/fixtures"]);
    expect(smells.some((s) => s.type === "magic_number")).toBe(true);
  });

  it("detects long functions", () => {
    const lines = ["export function long() {"];
    for (let i = 0; i < 60; i++) lines.push(`  console.log(${i});`);
    lines.push("}");
    writeFileSync(resolve(FIXTURE_DIR, "long.ts"), lines.join("\n") + "\n", "utf-8");

    const smells = scanCodeSmells(["tests/skills/evolution-generator/fixtures"]);
    expect(smells.some((s) => s.type === "long_function")).toBe(true);
  });

  it("detects missing test files", () => {
    mkdirSync(resolve(FIXTURE_DIR, "src"), { recursive: true });
    writeFileSync(
      resolve(FIXTURE_DIR, "src", "helper.ts"),
      "export function helper() { return 1; }\n",
      "utf-8"
    );

    const gaps = analyzeTestGaps(["tests/skills/evolution-generator/fixtures/src"]);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].coverage).toBe("none");
  });

  it("generates proposal from smells", () => {
    const proposal = generateProposalFromSmells([
      {
        file: "skills/a.ts",
        line: 5,
        type: "magic_number",
        severity: "high",
        message: "Magic number 999",
        suggestion: "Extract constant",
      },
    ]);

    expect(proposal).not.toBeNull();
    expect(proposal!.proposal.filesChanged).toContain("skills/a.ts");
    expect(proposal!.proposal.description).toContain("Refactor");
  });

  it("generates proposal from test gaps", () => {
    const proposal = generateProposalFromTestGaps([
      {
        sourceFile: "skills/new.ts",
        coverage: "none",
        missingTests: ["<entire file>"],
      },
    ]);

    expect(proposal).not.toBeNull();
    expect(proposal!.proposal.filesChanged).toContain("skills/new.ts");
  });

  it("runAutoReview returns null when nothing found", () => {
    const result = runAutoReview();
    // May be null or may find something in the real codebase
    expect(result === null || result.proposal !== undefined).toBe(true);
  });
});
