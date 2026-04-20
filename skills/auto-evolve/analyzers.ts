/**
 * Auto-Evolve Analyzers
 * =====================
 * Transform telemetry findings into concrete ImprovementProposals.
 *
 * Analyzers are pure functions: (CheckupReport | MetricsSnapshot) → ProposalDraft[]
 * They do NOT touch the filesystem or database.
 */

import type { CheckupReport, Finding, Recommendation } from "../telemetry-v2/auto-check.ts";
import type { ProposalCategory } from "./proposal-db.ts";

export interface ProposalDraft {
  category: ProposalCategory;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  rootCause: string;
  suggestedFix: string;
  expectedImpact: string;
  riskLevel: "low" | "medium" | "high";
  autoApplicable: boolean;
  sourceCheckupId?: string;
  relatedMetric?: string;
  currentValue?: number;
  threshold?: number;
}

// ---------------------------------------------------------------------------
// Main entry: convert a CheckupReport into proposals
// ---------------------------------------------------------------------------

export function analyzeCheckupReport(report: CheckupReport): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];

  for (const finding of report.findings) {
    const rec = report.recommendations.find((r) =>
      matchesRecommendation(finding, r)
    );
    drafts.push(...findingToProposals(finding, rec, report.id));
  }

  // Also run heuristic analyzers on raw metrics
  drafts.push(...analyzeSlowQueries(report));
  drafts.push(...analyzeSkillErrors(report));

  return deduplicateProposals(drafts);
}

// ---------------------------------------------------------------------------
// Finding → Proposal mapping
// ---------------------------------------------------------------------------

function findingToProposals(
  finding: Finding,
  rec: Recommendation | undefined,
  checkupId: string
): ProposalDraft[] {
  const base: ProposalDraft = {
    category: finding.category as ProposalCategory,
    severity: finding.severity,
    title: rec?.title ?? `Fix: ${finding.title}`,
    description: rec?.description ?? finding.description,
    rootCause: finding.description,
    suggestedFix: rec?.suggestedAction ?? "Manual review required.",
    expectedImpact: rec?.expectedImpact ?? "Reduce metric below threshold.",
    riskLevel: rec ? mapPriorityToRisk(rec.priority) : mapSeverityToRisk(finding.severity),
    autoApplicable: rec?.autoApplicable ?? false,
    sourceCheckupId: checkupId,
    relatedMetric: finding.metric,
    currentValue: finding.currentValue,
    threshold: finding.threshold,
  };

  // Special-case: generate SQL for index suggestions
  if (finding.title.includes("Database P95 latency") || rec?.title.includes("Add database indexes")) {
    return [{
      ...base,
      title: "Add missing database indexes",
      suggestedFix: `ANALYZE slow queries; CREATE INDEX IF NOT EXISTS idx_<table>_<column> ON <table>(<column>);`,
      autoApplicable: true,
      riskLevel: "low",
    }];
  }

  // Special-case: prompt optimization
  if (rec?.title.includes("Prompt") || finding.metric === "skills.errorRate") {
    return [{
      ...base,
      title: rec?.title ?? "Optimize failing skill prompts",
      suggestedFix: rec?.suggestedAction ?? "Review skill handler and improve error handling / prompt clarity.",
      autoApplicable: false,
      riskLevel: "medium",
    }];
  }

  return [base];
}

// ---------------------------------------------------------------------------
// Heuristic analyzers
// ---------------------------------------------------------------------------

function analyzeSlowQueries(report: CheckupReport): ProposalDraft[] {
  const dbP95 = report.rawMetrics.categories.database.p95LatencyMs;
  if (dbP95 <= 100) return [];

  return [{
    category: "performance",
    severity: dbP95 > 500 ? "warning" : "info",
    title: "Add database indexes for slow queries",
    description: `Database P95 latency is ${dbP95}ms. Missing indexes are the most common cause of slow queries in SQLite/PostgreSQL.`,
    rootCause: "Tables queried frequently without indexed lookup columns.",
    suggestedFix: `
1. Identify slow queries via telemetry histograms
2. Run EXPLAIN QUERY PLAN on each
3. CREATE INDEX IF NOT EXISTS idx_<table>_<column> ON <table>(<column>)
4. Verify latency improvement
`.trim(),
    expectedImpact: `Reduce DB P95 latency from ${dbP95}ms to <50ms (typical 50-90% improvement).`,
    riskLevel: "low",
    autoApplicable: true,
    sourceCheckupId: report.id,
    relatedMetric: "db.p95LatencyMs",
    currentValue: dbP95,
    threshold: 100,
  }];
}

function analyzeSkillErrors(report: CheckupReport): ProposalDraft[] {
  const { callsTotal, errorsTotal, errorRate, topSkills } = report.rawMetrics.categories.skills;
  if (callsTotal < 5 || errorRate < 0.05) return [];

  const failingSkills = topSkills.filter((s) => s.errors > 0).map((s) => s.skill).join(", ");

  return [{
    category: "reliability",
    severity: errorRate > 0.1 ? "critical" : "warning",
    title: "Optimize failing skill prompts and error handling",
    description: `Skill error rate is ${(errorRate * 100).toFixed(1)}% (${errorsTotal}/${callsTotal}). Failing skills: ${failingSkills || "unknown"}.`,
    rootCause: "Skills may have brittle prompts, missing error handling, or timeout issues.",
    suggestedFix: `
1. Inspect error logs for top failing skills
2. Add input validation and graceful degradation
3. Improve LLM prompt clarity (examples, constraints)
4. Add retry logic with exponential backoff
`.trim(),
    expectedImpact: "Reduce skill error rate below 1%.",
    riskLevel: "medium",
    autoApplicable: false,
    sourceCheckupId: report.id,
    relatedMetric: "skills.errorRate",
    currentValue: errorRate,
    threshold: 0.05,
  }];
}

// ---------------------------------------------------------------------------
// Dead code analyzer (filesystem scan)
// ---------------------------------------------------------------------------

export interface DeadCodeFinding {
  file: string;
  symbol: string;
  type: "function" | "class" | "export";
  line: number;
}

export async function analyzeDeadCode(skillDir = "skills"): Promise<ProposalDraft[]> {
  const { readdirSync, statSync, readFileSync } = await import("fs");
  const { join } = await import("path");

  const findings: DeadCodeFinding[] = [];

  function scanDir(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!entry.startsWith(".") && entry !== "node_modules") scanDir(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      const content = readFileSync(full, "utf-8");
      findings.push(...findUnusedExports(full, content));
    }
  }

  try {
    scanDir(skillDir);
  } catch {
    // directory may not exist in all contexts
  }

  if (findings.length === 0) return [];

  return [{
    category: "performance",
    severity: "info",
    title: `Remove ${findings.length} potentially dead code exports`,
    description: `Found ${findings.length} exports that may be unused across the codebase.`,
    rootCause: "Code refactoring left behind unused exports.",
    suggestedFix: findings.map((f) => `- ${f.file}:${f.line} — ${f.symbol}`).join("\n"),
    expectedImpact: "Slightly faster startup and smaller bundle.",
    riskLevel: "low",
    autoApplicable: false,
    relatedMetric: "code.deadExports",
    currentValue: findings.length,
    threshold: 0,
  }];
}

function findUnusedExports(filePath: string, content: string): DeadCodeFinding[] {
  const findings: DeadCodeFinding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Simple heuristic: exported function/class that looks like a candidate
    const match = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
    if (match) {
      const symbol = match[1];
      // Heuristic: if the symbol contains "test", "mock", or "helper" it's likely used
      if (/test|mock|spec|helper|util/i.test(symbol)) continue;
      // Skip if it's explicitly marked @public or main export
      if (i > 0 && lines[i - 1].includes("@public")) continue;
      findings.push({ file: filePath, symbol, type: "function", line: i + 1 });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesRecommendation(finding: Finding, rec: Recommendation): boolean {
  return rec.title.toLowerCase().includes(finding.title.toLowerCase().split(" ")[0]);
}

function mapPriorityToRisk(p: "low" | "medium" | "high"): "low" | "medium" | "high" {
  return p;
}

function mapSeverityToRisk(s: "info" | "warning" | "critical"): "low" | "medium" | "high" {
  return s === "critical" ? "high" : s === "warning" ? "medium" : "low";
}

function deduplicateProposals(drafts: ProposalDraft[]): ProposalDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const key = `${d.category}:${d.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
