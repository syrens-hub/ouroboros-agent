/**
 * Evolution Generator v8.3
 * =========================
 * LLM-driven (and heuristic fallback) code review, test-gap analysis,
 * and automatic EvolutionProposal generation.
 *
 * Architecture:
 *   1. Code Review Agent — scans source for smells, anti-patterns, duplication
 *   2. Test Gap Analyzer — finds untested or under-tested source files
 *   3. Auto-Proposal — packages findings into EvolutionProposal + diffs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, relative, join, extname } from "path";
import type { EvolutionProposal } from "../evolution-orchestrator/types.ts";
import { logger } from "../../core/logger.ts";

const PROJECT_ROOT = resolve(process.cwd());

// =============================================================================
// Types
// =============================================================================

export interface CodeSmell {
  file: string;
  line: number;
  type: "magic_number" | "long_function" | "duplicate_code" | "missing_type" | "deep_nesting" | "unused_import";
  severity: "low" | "medium" | "high";
  message: string;
  suggestion: string;
}

export interface TestGap {
  sourceFile: string;
  testFile?: string;
  coverage: "none" | "partial" | "full";
  missingTests: string[]; // function/class names missing tests
}

export interface GeneratedProposal {
  proposal: EvolutionProposal;
  rationale: string;
  findings: CodeSmell[] | TestGap[];
}

// =============================================================================
// Heuristic Scanners
// =============================================================================

function listTsFiles(dir: string, acc: string[] = [], base = dir): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      listTsFiles(p, acc, base);
    } else if (entry.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx")) && !p.endsWith(".d.ts")) {
      acc.push(relative(base, p).split("\\").join("/"));
    }
  }
  return acc;
}

function scanFileForSmells(filePath: string, content: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const lines = content.split("\n");

  // Magic numbers (heuristic: standalone digits > 1 digit, excluding obvious cases)
  const magicNumberRe = /[^\w](\d{2,})[^\w]/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    let m: RegExpExecArray | null;
    magicNumberRe.lastIndex = 0;
    while ((m = magicNumberRe.exec(line)) !== null) {
      const num = parseInt(m[1], 10);
      if (num === 0 || num === 1 || num === 200 || num === 404 || num === 500) continue;
      smells.push({
        file: filePath,
        line: i + 1,
        type: "magic_number",
        severity: "low",
        message: `Magic number ${num}`,
        suggestion: `Extract ${num} into a named constant`,
      });
    }
  }

  // Long functions (> 50 lines between braces)
  let braceDepth = 0;
  let funcStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = (line.match(/{/g) || []).length;
    const close = (line.match(/}/g) || []).length;
    if (braceDepth === 0 && open > 0 && /(function|=>|:)/.test(line)) {
      funcStart = i;
    }
    braceDepth += open - close;
    if (braceDepth === 0 && funcStart >= 0 && i - funcStart > 50) {
      smells.push({
        file: filePath,
        line: funcStart + 1,
        type: "long_function",
        severity: "medium",
        message: `Function/block spans ${i - funcStart} lines`,
        suggestion: "Refactor into smaller functions",
      });
      funcStart = -1;
    }
  }

  // Missing explicit return types on exported functions
  const exportedFnRe = /export\s+(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*[:{]/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    exportedFnRe.lastIndex = 0;
    if (exportedFnRe.test(line) && !line.includes(":")) {
      smells.push({
        file: filePath,
        line: i + 1,
        type: "missing_type",
        severity: "low",
        message: "Exported function lacks explicit return type",
        suggestion: "Add a TypeScript return type annotation",
      });
    }
  }

  // Deep nesting (> 4 levels)
  for (let i = 0; i < lines.length; i++) {
    const indent = lines[i].search(/\S/);
    if (indent >= 0 && indent / 2 >= 4) {
      smells.push({
        file: filePath,
        line: i + 1,
        type: "deep_nesting",
        severity: "medium",
        message: `Deep nesting detected (~${indent / 2} levels)`,
        suggestion: "Extract nested logic into helper functions",
      });
    }
  }

  return smells;
}

// =============================================================================
// Code Review Agent
// =============================================================================

export function scanCodeSmells(dirs: string[] = ["skills", "core", "web"]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  for (const dir of dirs) {
    const files = listTsFiles(resolve(PROJECT_ROOT, dir));
    for (const fp of files) {
      const abs = resolve(PROJECT_ROOT, dir, fp);
      try {
        const content = readFileSync(abs, "utf-8");
        smells.push(...scanFileForSmells(`${dir}/${fp}`, content));
      } catch {
        // ignore unreadable
      }
    }
  }
  logger.info("Code smell scan completed", { smellsFound: smells.length });
  return smells;
}

// =============================================================================
// Test Gap Analyzer
// =============================================================================

export function analyzeTestGaps(
  srcDirs: string[] = ["skills", "core"],
  testDir = "tests"
): TestGap[] {
  const gaps: TestGap[] = [];

  for (const srcDir of srcDirs) {
    const srcFiles = listTsFiles(resolve(PROJECT_ROOT, srcDir));
    for (const fp of srcFiles) {
      const relPath = `${srcDir}/${fp}`;
      // Heuristic: look for a test file mirroring the source path
      const testCandidates = [
        join(testDir, srcDir, fp.replace(/\.tsx?$/, ".test.ts")),
        join(testDir, srcDir, fp.replace(/\.tsx?$/, ".spec.ts")),
      ];
      const foundTest = testCandidates.find((t) => existsSync(resolve(PROJECT_ROOT, t)));

      if (!foundTest) {
        gaps.push({
          sourceFile: relPath,
          coverage: "none",
          missingTests: ["<entire file>"],
        });
      } else {
        // Very rough heuristic: count exported names vs test describe blocks
        const srcContent = readFileSync(resolve(PROJECT_ROOT, relPath), "utf-8");
        const testContent = readFileSync(resolve(PROJECT_ROOT, foundTest), "utf-8");
        const exportedNames = [...srcContent.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
        const testedNames = [...testContent.matchAll(/describe\s*\(\s*['"`](.*?)['"`]/g)].map((m) => m[1]);
        const missing = exportedNames.filter((n) => !testedNames.some((t) => t.includes(n)));
        if (missing.length > 0) {
          gaps.push({
            sourceFile: relPath,
            testFile: foundTest,
            coverage: "partial",
            missingTests: missing,
          });
        }
      }
    }
  }

  logger.info("Test gap analysis completed", { gapsFound: gaps.length });
  return gaps;
}

// =============================================================================
// Auto-Proposal Generator
// =============================================================================

export function generateProposalFromSmells(smells: CodeSmell[]): GeneratedProposal | null {
  if (smells.length === 0) return null;

  const byFile = new Map<string, CodeSmell[]>();
  for (const s of smells) {
    const arr = byFile.get(s.file) ?? [];
    arr.push(s);
    byFile.set(s.file, arr);
  }

  // Pick the file with the most high-severity smells
  const sorted = [...byFile.entries()].sort((a, b) => {
    const highA = a[1].filter((s) => s.severity === "high").length;
    const highB = b[1].filter((s) => s.severity === "high").length;
    return highB - highA || b[1].length - a[1].length;
  });

  const [targetFile, fileSmells] = sorted[0];
  const rationale = fileSmells.map((s) => `${s.type} at L${s.line}: ${s.message}`).join("; ");

  const proposal: EvolutionProposal = {
    filesChanged: [targetFile],
    description: `Refactor ${targetFile}: fix ${fileSmells.length} code smell(s)`,
    linesAdded: Math.ceil(fileSmells.length * 3),
    linesRemoved: Math.ceil(fileSmells.length * 1.5),
    estimatedCostUsd: 0.05,
  };

  return { proposal, rationale, findings: fileSmells };
}

export function generateProposalFromTestGaps(gaps: TestGap[]): GeneratedProposal | null {
  const noCoverage = gaps.filter((g) => g.coverage === "none");
  if (noCoverage.length === 0) return null;

  const target = noCoverage[0];
  const proposal: EvolutionProposal = {
    filesChanged: [target.sourceFile],
    description: `Add tests for ${target.sourceFile}`,
    linesAdded: 30,
    linesRemoved: 0,
    estimatedCostUsd: 0.03,
  };

  return {
    proposal,
    rationale: `No test coverage for ${target.sourceFile}`,
    findings: [target],
  };
}

/**
 * Run a full auto-review cycle and return the highest-priority proposal.
 */
export function runAutoReview(): GeneratedProposal | null {
  const smells = scanCodeSmells();
  const gaps = analyzeTestGaps();

  // Prioritize high-severity smells, then test gaps
  const smellProposal = generateProposalFromSmells(smells.filter((s) => s.severity === "high"));
  if (smellProposal) return smellProposal;

  const testProposal = generateProposalFromTestGaps(gaps);
  if (testProposal) return testProposal;

  const anySmellProposal = generateProposalFromSmells(smells);
  return anySmellProposal;
}
