/**
 * Quality Evaluator
 * Assesses the quality of generated summaries across 7 dimensions + section completeness.
 *
 * Design:
 * - Multi-dimensional scoring (0-100)
 * - Section completeness weighted at 30%
 * - Deterministic (no randomness)
 */

import type {
  AgentMessage,
  CompressionQuality,
  QualityGrade,
  AdaptiveCompressorConfig,
  QualitySectionPattern,
} from "./types.js";
import { DEFAULT_CONFIG, QUALITY_SECTION_PATTERNS } from "./types.js";

// Scoring weights
const FILE_SCORE_MAX = 15;
const CODE_SCORE_MAX = 20;
const ERROR_SCORE_MAX = 15;
const DECISION_SCORE_MAX = 10;
const TASK_SCORE_MAX = 10;
const COVERAGE_SCORE_MAX = 15;
const DENSITY_SCORE_MAX = 15;
const SECTION_WEIGHT = 0.3;
const RAW_WEIGHT = 0.7;

// Grade thresholds
const GRADE_A_THRESHOLD = 80;
const GRADE_B_THRESHOLD = 65;
const GRADE_C_THRESHOLD = 50;

// Key sections that must be present for quality pass
const CRITICAL_SECTIONS = ["Primary Request", "Files and Code", "Current Work"];

// Summary analysis patterns
const FILE_REFERENCE_PATTERN = /\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|cs|rb|php|swift|kt|m|md|json|yaml|yml|toml|xml|html|css|scss|sass|less)/i;
const CODE_SNIPPET_PATTERN = /```[\s\S]{20,}```/;
const ERROR_CONTEXT_PATTERN = /(?:error|exception|failed|issue|problem)[\s:]+[\S]/i;
const DECISION_PATTERN = /(?:decided|chose|chosen|selected|adopted|use[d]?|implement)/i;
const PENDING_TASK_PATTERN = /(?:pending|todo|to[- ]?do|remain(?:s|ing)?|not yet|still need)/i;

function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

function countLines(text: string): number {
  return text.split("\n").filter((l) => l.trim().length > 0).length;
}

export class QualityEvaluator {
  private config: AdaptiveCompressorConfig;
  private sectionPatterns: QualitySectionPattern[];

  constructor(config: Partial<AdaptiveCompressorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sectionPatterns = QUALITY_SECTION_PATTERNS;
  }

  /**
   * Evaluate summary quality against 7 dimensions + section completeness.
   */
  evaluateQuality(
    summary: string,
    originalMessages: AgentMessage[]
  ): CompressionQuality {
    const normalizedSummary = summary.toLowerCase();

    // Dimension 1: File references present
    const hasFileReferences = FILE_REFERENCE_PATTERN.test(summary);

    // Dimension 2: Code snippets present
    const hasCodeSnippets = CODE_SNIPPET_PATTERN.test(summary);

    // Dimension 3: Error context present
    const hasErrorContext = ERROR_CONTEXT_PATTERN.test(summary);

    // Dimension 4: Decision record present
    const hasDecisionRecord =
      DECISION_PATTERN.test(summary) ||
      /(?:because|since|reason)[\s:]+/i.test(summary);

    // Dimension 5: Pending tasks present
    const hasPendingTasks = PENDING_TASK_PATTERN.test(summary);

    // Dimension 6: Coverage ratio (summary lines / original lines)
    const summaryLines = countLines(summary);
    const originalLines = this.countMessageLines(originalMessages);
    const coverageRatio =
      originalLines > 0 ? summaryLines / originalLines : 0;

    // Dimension 7: Information density
    const summaryTokens = estimateTokens(summary);
    const effectiveTokens = this.estimateEffectiveInformationTokens(summary);
    const informationDensity =
      summaryTokens > 0 ? effectiveTokens / summaryTokens : 0;

    // Section completeness
    const presentSections = this.sectionPatterns.filter(({ patterns }) =>
      patterns.some((p) => p.test(normalizedSummary))
    ).length;
    const sectionCompleteness = presentSections / this.sectionPatterns.length;

    return {
      hasFileReferences,
      hasCodeSnippets,
      hasErrorContext,
      hasDecisionRecord,
      hasPendingTasks,
      coverageRatio,
      informationDensity,
      sectionCompleteness,
    };
  }

  /**
   * Compute final grade from quality dimensions.
   *
   * Scoring:
   * - Raw dimensions: 70% weight
   * - Section completeness: 30% weight
   *
   * Grade thresholds:
   * - A: >= 80 (auto pass)
   * - B: >= 65 (auto pass)
   * - C: >= 50 (need minQualityScore)
   * - D: < 50 (fail)
   */
  gradeQuality(quality: CompressionQuality): QualityGrade {
    const warnings: string[] = [];
    const missingSections: string[] = [];

    // Per-dimension scoring
    const fileScore = quality.hasFileReferences ? FILE_SCORE_MAX : 0;
    const codeScore = quality.hasCodeSnippets ? CODE_SCORE_MAX : 0;
    const errorScore = quality.hasErrorContext ? ERROR_SCORE_MAX : 0;
    const decisionScore = quality.hasDecisionRecord ? DECISION_SCORE_MAX : 0;
    const taskScore = quality.hasPendingTasks ? TASK_SCORE_MAX : 0;
    const coverageScore = Math.min(quality.coverageRatio * 200, COVERAGE_SCORE_MAX);
    const densityScore = Math.min(quality.informationDensity * 100, DENSITY_SCORE_MAX);

    // Warnings for missing dimensions
    if (!quality.hasFileReferences) {
      warnings.push("摘要缺少文件引用");
      missingSections.push("Files and Code");
    }
    if (!quality.hasCodeSnippets) {
      warnings.push("摘要缺少代码片段");
    }
    if (!quality.hasErrorContext) {
      warnings.push("摘要缺少错误上下文");
    }
    if (!quality.hasDecisionRecord) {
      warnings.push("摘要缺少决策记录");
    }
    if (!quality.hasPendingTasks) {
      warnings.push("摘要缺少待办任务");
    }
    if (quality.coverageRatio < this.config.minCoverageRatio) {
      warnings.push(
        `覆盖率不足: ${(quality.coverageRatio * 100).toFixed(1)}% < ${(this.config.minCoverageRatio * 100)}%`
      );
    }
    if (quality.informationDensity < this.config.minInformationDensity) {
      warnings.push(
        `信息密度不足: ${(quality.informationDensity * 100).toFixed(1)}% < ${(this.config.minInformationDensity * 100)}%`
      );
    }

    // Section completeness score
    const rawScore =
      fileScore +
      codeScore +
      errorScore +
      decisionScore +
      taskScore +
      coverageScore +
      densityScore;
    const sectionScore = Math.round(quality.sectionCompleteness * 100);
    const finalScore = Math.round(rawScore * RAW_WEIGHT + sectionScore * SECTION_WEIGHT);

    // Determine grade
    let grade: "A" | "B" | "C" | "D";
    let passed: boolean;

    if (finalScore >= GRADE_A_THRESHOLD) {
      grade = "A";
      passed = true;
    } else if (finalScore >= GRADE_B_THRESHOLD) {
      grade = "B";
      passed = true;
    } else if (finalScore >= GRADE_C_THRESHOLD) {
      grade = "C";
      passed = finalScore >= this.config.minQualityScore;
    } else {
      grade = "D";
      passed = false;
    }

    return {
      score: finalScore,
      grade,
      passed,
      warnings,
      missingSections,
    };
  }

  /**
   * Determine if summary should be retried.
   * Conditions: score below retry threshold OR critical sections missing.
   */
  shouldRetry(
    grade: QualityGrade,
    attemptCount: number,
    maxRetries: number
  ): { shouldRetry: boolean; reason?: string } {
    if (attemptCount >= maxRetries) {
      return { shouldRetry: false, reason: "max retries exceeded" };
    }

    if (grade.score < this.config.retryThreshold) {
      return {
        shouldRetry: true,
        reason: `质量分数 ${grade.score} < 阈值 ${this.config.retryThreshold}`,
      };
    }

    const missingCritical = CRITICAL_SECTIONS.filter((s) =>
      grade.missingSections.includes(s)
    );
    if (missingCritical.length > 0) {
      return {
        shouldRetry: true,
        reason: `缺少关键章节: ${missingCritical.join(", ")}`,
      };
    }

    return { shouldRetry: false };
  }

  /**
   * Build retry instructions to guide summary regeneration.
   */
  buildRetryInstructions(
    grade: QualityGrade,
    messages: AgentMessage[]
  ): string {
    const instructions: string[] = [];

    instructions.push(
      "请在摘要中包含以下关键信息：\n"
    );

    if (grade.missingSections.includes("Primary Request")) {
      instructions.push("1. **主要请求/目标**: 用户最初想要完成什么");
    }
    if (grade.missingSections.includes("Files and Code")) {
      const files = this.extractFileMentions(messages);
      if (files.length > 0) {
        instructions.push(`2. **涉及的文件**: ${files.slice(0, 10).join(", ")}`);
      }
    }
    if (grade.missingSections.includes("Current Work")) {
      instructions.push("3. **当前工作状态**: 正在做什么，进展如何");
    }
    if (!grade.warnings.some((w) => w.includes("错误上下文"))) {
      const errors = this.extractErrors(messages);
      if (errors.length > 0) {
        instructions.push(`4. **错误信息**: ${errors.slice(0, 3).join("; ")}`);
      }
    }
    if (!grade.warnings.some((w) => w.includes("待办任务"))) {
      const tasks = this.extractTasks(messages);
      if (tasks.length > 0) {
        instructions.push(`5. **待办事项**: ${tasks.slice(0, 5).join(", ")}`);
      }
    }

    return instructions.join("\n");
  }

  private countMessageLines(messages: AgentMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join(" ");
      total += countLines(content);
    }
    return total;
  }

  private estimateEffectiveInformationTokens(summary: string): number {
    // Remove common boilerplate to get effective information
    const boilerplate = [
      /^(以下是|下面|现在|here is|below|now)/i,
      /^(总结|summary|summarize)/i,
      /^\s*[-*]\s*$/m,
    ];
    let text = summary;
    for (const pattern of boilerplate) {
      text = text.replace(pattern, "");
    }
    return estimateTokens(text);
  }

  private extractFileMentions(messages: AgentMessage[]): string[] {
    const files = new Set<string>();
    const pattern = /\.\w{1,10}/g;
    for (const msg of messages) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join(" ");
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach((f) => files.add(f));
      }
    }
    return Array.from(files);
  }

  private extractErrors(messages: AgentMessage[]): string[] {
    const errors: string[] = [];
    const pattern = /error|exception|failed|failure/i;
    for (const msg of messages) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join(" ");
      const match = content.match(pattern);
      if (match) {
        errors.push(match[0]);
      }
    }
    return errors;
  }

  private extractTasks(messages: AgentMessage[]): string[] {
    const tasks: string[] = [];
    const pattern = /(?:todo|to[- ]?do|pending|need to|should)/gi;
    for (const msg of messages) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join(" ");
      const lines = content.split("\n");
      for (const line of lines) {
        if (pattern.test(line)) {
          tasks.push(line.trim().slice(0, 80));
        }
      }
    }
    return tasks;
  }
}
