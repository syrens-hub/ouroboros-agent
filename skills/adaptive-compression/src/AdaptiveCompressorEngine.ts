/**
 * Adaptive Compressor Engine
 * Implements the OpenClaw ContextEngine interface with adaptive compression.
 *
 * Design principles:
 * 1. Deterministic: same input → same output
 * 2. Complexity-driven: thresholds adapt to conversation structure
 * 3. Quality-aware: summaries are evaluated before acceptance
 * 4. Incremental: supports incremental summary updates
 *
 * This class is designed to be registered as an OpenClaw ContextEngine
 * via registerContextEngineForOwner('adaptive', () => new AdaptiveCompressorEngine(), 'core')
 */

import type {
  AgentMessage,
  AssembleResult,
  CompactResult,
  IngestResult,
  ContextEngineInfo,
  FullAssessment,
  AdaptiveCompressorConfig,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { ComplexityScorer } from "./ComplexityScorer.js";
import { AdaptiveThresholdCalculator } from "./AdaptiveThreshold.js";
import { QualityEvaluator } from "./QualityEvaluator.js";

// ============================================================================
// OpenClaw ContextEngine Interface
// ============================================================================

/**
 * AdaptiveCompressorEngine
 *
 * An adaptive context engine that:
 * - Computes complexity-weighted thresholds for compression
 * - Evaluates summary quality before accepting
 * - Retries with repair instructions on low-quality summaries
 * - Provides per-model assemble optimization
 */
export class AdaptiveCompressorEngine {
  readonly info: ContextEngineInfo = {
    id: "adaptive",
    name: "Adaptive Compression Engine",
    version: "1.0.0",
    ownsCompaction: true, // We manage our own compaction lifecycle
  };

  private config: AdaptiveCompressorConfig;
  private complexityScorer: ComplexityScorer;
  private thresholdCalculator: AdaptiveThresholdCalculator;
  private qualityEvaluator: QualityEvaluator;

  // Internal state
  private sessionMessages: Map<string, AgentMessage[]> = new Map();
  private summaryCache: Map<string, string> = new Map();

  constructor(config?: Partial<AdaptiveCompressorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.complexityScorer = new ComplexityScorer(this.config);
    this.thresholdCalculator = new AdaptiveThresholdCalculator(this.config);
    this.qualityEvaluator = new QualityEvaluator(this.config);
  }

  // ==========================================================================
  // Required ContextEngine Methods
  // ==========================================================================

  /**
   * Ingest a single message into the engine's store.
   * For adaptive engine, we maintain in-memory message history per session.
   */
  async ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    const { sessionId, message } = params;

    // Skip heartbeats for storage efficiency
    if (params.isHeartbeat) {
      return { ingested: false };
    }

    // Check for duplicate
    const messages = this.getOrCreateSession(sessionId);
    if (this.isDuplicateMessage(messages, message)) {
      return { ingested: false };
    }

    messages.push(message);
    return { ingested: true };
  }

  /**
   * Assemble model context under a token budget.
   * This is the main entry point for context assembly.
   *
   * Returns messages trimmed to fit within token budget, using
   * adaptive thresholds based on conversation complexity.
   */
  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
    model?: string;
    prompt?: string;
  }): Promise<AssembleResult> {
    const { messages, tokenBudget, model } = params;

    if (messages.length === 0) {
      return { messages: [], estimatedTokens: 0 };
    }

    // Compute complexity for adaptive threshold
    const complexity = this.complexityScorer.computeComplexity(messages);
    const threshold = this.thresholdCalculator.computeThreshold(complexity);

    // Use tokenBudget if provided, otherwise use adaptive target
    const effectiveBudget = tokenBudget ?? threshold.targetTokens;

    // Estimate total tokens
    const estimatedTokens = this.estimateTotalTokens(messages);

    // If within budget, return all messages
    if (estimatedTokens <= effectiveBudget) {
      return { messages, estimatedTokens };
    }

    // Need to truncate - prioritize recent messages
    const trimmedMessages = this.trimToBudget(messages, effectiveBudget);

    return {
      messages: trimmedMessages,
      estimatedTokens: this.estimateTotalTokens(trimmedMessages),
      systemPromptAddition: this.buildSystemAddition(complexity, threshold),
    };
  }

  /**
   * Compact context to reduce token usage.
   * This is the main compression entry point.
   *
   * Process:
   * 1. Assess complexity and compute adaptive threshold
   * 2. Generate summary using provided summarizeFn
   * 3. Evaluate summary quality
   * 4. If quality insufficient, retry with repair instructions
   * 5. Return compressed result
   */
  async compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: unknown;
  }): Promise<CompactResult> {
    const { sessionId, force, currentTokenCount, customInstructions } = params;

    // Get messages for this session
    const messages = this.sessionMessages.get(sessionId) ?? [];
    const tokensBefore = this.estimateTotalTokens(messages);

    // Quick exit: nothing to compact
    if (messages.length < 3 && !force) {
      return {
        ok: true,
        compacted: false,
        reason: "nothing to compact",
      };
    }

    // Assess complexity
    const complexity = this.complexityScorer.computeComplexity(messages);
    const threshold = this.thresholdCalculator.computeThreshold(complexity);

    // Check if compression is needed
    const effectiveCount = currentTokenCount ?? tokensBefore;
    if (effectiveCount < threshold.warningThreshold && !force) {
      return {
        ok: true,
        compacted: false,
        reason: "below threshold",
      };
    }

    // Generate summary with retries
    const { summary, quality, grade, attempts } = await this.generateQualitySummary(
      messages,
      threshold,
      customInstructions
    );

    if (!summary) {
      return {
        ok: false,
        compacted: false,
        reason: "summary generation failed",
      };
    }

    // Cache summary
    this.summaryCache.set(sessionId, summary);

    return {
      ok: true,
      compacted: true,
      reason: `compressed in ${attempts} attempt(s), grade: ${grade}`,
      result: {
        summary,
        tokensBefore,
        tokensAfter: this.estimateSummaryTokens(summary),
        details: {
          complexity,
          threshold,
          quality,
          grade,
          attempts,
        },
      },
    };
  }

  /**
   * Dispose of engine resources.
   */
  async dispose(): Promise<void> {
    this.sessionMessages.clear();
    this.summaryCache.clear();
  }

  // ==========================================================================
  // Assessment API (for diagnostics and external use)
  // ==========================================================================

  /**
   * Full assessment of whether compression is needed and what quality to expect.
   * Useful for debugging and external monitoring.
   */
  assess(params: {
    messages: AgentMessage[];
    tokenBudget?: number;
  }): FullAssessment {
    const { messages, tokenBudget } = params;

    const complexity = this.complexityScorer.computeComplexity(messages);
    const threshold = this.thresholdCalculator.computeThreshold(complexity);
    const estimatedTokens = this.estimateTotalTokens(messages);

    const shouldCompact =
      estimatedTokens >= threshold.warningThreshold || tokenBudget !== undefined;

    return {
      complexity,
      threshold,
      quality: {
        hasFileReferences: false,
        hasCodeSnippets: false,
        hasErrorContext: false,
        hasDecisionRecord: false,
        hasPendingTasks: false,
        coverageRatio: 0,
        informationDensity: 0,
        sectionCompleteness: 0,
      },
      grade: { score: 0, grade: "C", passed: true, warnings: [], missingSections: [] },
      shouldCompact,
      recommendedTargetTokens: threshold.targetTokens,
    };
  }

  /**
   * Log assessment for debugging.
   */
  logAssessment(assessment: FullAssessment): string {
    const { complexity, threshold, shouldCompact, recommendedTargetTokens } = assessment;
    const thresholdDesc = this.thresholdCalculator.getStrategyDescription(threshold);

    return (
      `[AdaptiveCompressor] ` +
      `complexity=${Math.round(complexity.total)}, ` +
      `${thresholdDesc}, ` +
      `compact=${shouldCompact}, ` +
      `targetTokens=${recommendedTargetTokens}`
    );
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private getOrCreateSession(sessionId: string): AgentMessage[] {
    if (!this.sessionMessages.has(sessionId)) {
      this.sessionMessages.set(sessionId, []);
    }
    return this.sessionMessages.get(sessionId)!;
  }

  private isDuplicateMessage(
    messages: AgentMessage[],
    newMsg: AgentMessage
  ): boolean {
    if (!newMsg.id) return false;
    return messages.some((m) => m.id === newMsg.id);
  }

  private estimateTotalTokens(messages: AgentMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        total += Math.ceil(msg.content.length / 4);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            total += Math.ceil(block.text.length / 4);
          }
        }
      }
    }
    return total;
  }

  private estimateSummaryTokens(summary: string): number {
    return Math.ceil(summary.length / 4);
  }

  private trimToBudget(
    messages: AgentMessage[],
    budget: number
  ): AgentMessage[] {
    // Keep most recent messages first, working backwards
    const result: AgentMessage[] = [];
    let tokens = 0;

    // Start from the end (most recent)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      const msgTokens = this.estimateMessageTokens(msg);

      if (tokens + msgTokens <= budget) {
        result.unshift(msg);
        tokens += msgTokens;
      } else {
        break;
      }
    }

    return result;
  }

  private estimateMessageTokens(msg: AgentMessage): number {
    if (typeof msg.content === "string") {
      return Math.ceil(msg.content.length / 4);
    }
    let total = 0;
    for (const block of msg.content) {
      if (block.type === "text") {
        total += Math.ceil(block.text.length / 4);
      }
    }
    return total;
  }

  private buildSystemAddition(
    complexity: ReturnType<ComplexityScorer["computeComplexity"]>,
    threshold: ReturnType<AdaptiveThresholdCalculator["computeThreshold"]>
  ): string {
    if (threshold.strategy === "conservative") {
      return "";
    }

    const parts: string[] = [];

    if (complexity.codeBlockCount > 20) {
      parts.push(
        `This conversation involves ${complexity.codeBlockCount} code blocks. Preserve implementation details.`
      );
    }

    if (complexity.uniqueFileCount > 5) {
      parts.push(
        `${complexity.uniqueFileCount} files are involved. Track file changes carefully.`
      );
    }

    if (complexity.errorDensity > 0.2) {
      parts.push(
        `High error context (${(complexity.errorDensity * 100).toFixed(0)}%). Include error resolution in summary.`
      );
    }

    return parts.join(" ");
  }

  private async generateQualitySummary(
    messages: AgentMessage[],
    threshold: ReturnType<AdaptiveThresholdCalculator["computeThreshold"]>,
    customInstructions?: string
  ): Promise<{
    summary: string | null;
    quality: ReturnType<QualityEvaluator["evaluateQuality"]> | null;
    grade: ReturnType<QualityEvaluator["gradeQuality"]> | null;
    attempts: number;
  }> {
    const maxAttempts = this.config.maxRetries;
    let lastQuality: ReturnType<QualityEvaluator["evaluateQuality"]> | null = null;
    let lastGrade: ReturnType<QualityEvaluator["gradeQuality"]> | null = null;
    let summary: string | null = null;
    let retryInstructions = customInstructions;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      // Generate summary (placeholder - in real impl, call LLM here)
      summary = await this.invokeSummaryGeneration(messages, {
        targetTokens: threshold.targetTokens,
        customInstructions: retryInstructions,
      });

      if (!summary) {
        break;
      }

      // Evaluate quality
      lastQuality = this.qualityEvaluator.evaluateQuality(summary, messages);
      lastGrade = this.qualityEvaluator.gradeQuality(lastQuality);

      // Check if quality is sufficient
      const { shouldRetry } = this.qualityEvaluator.shouldRetry(
        lastGrade,
        attempt,
        maxAttempts
      );

      if (!shouldRetry) {
        return { summary, quality: lastQuality, grade: lastGrade, attempts: attempt + 1 };
      }

      // Generate retry instructions
      retryInstructions = this.qualityEvaluator.buildRetryInstructions(lastGrade, messages);
    }

    return { summary, quality: lastQuality, grade: lastGrade, attempts: maxAttempts + 1 };
  }

  /**
   * Invoke LLM to generate summary.
   * Placeholder: in real implementation, this would call the actual LLM.
   *
   * In OpenClaw integration, this would delegate to pi-coding-agent
   * or use the compactEmbeddedPiSessionDirect bridge.
   */
  private async invokeSummaryGeneration(
    messages: AgentMessage[],
    options: {
      targetTokens: number;
      customInstructions?: string;
    }
  ): Promise<string | null> {
    // TODO: Integrate with OpenClaw's LLM calling mechanism
    // Options:
    // 1. delegateCompactionToRuntime() for built-in behavior
    // 2. Direct LLM call via pi-agent-core
    // 3. External summarizeFn passed in

    // Placeholder: construct a basic summary
    const recentMessages = messages.slice(-10);
    const userMessages = recentMessages
      .filter((m) => m.role === "user")
      .map((m) => {
        const content =
          typeof m.content === "string"
            ? m.content.slice(0, 200)
            : "[structured content]";
        return content;
      })
      .join("\n\n");

    const summary = `## Summary

### Primary Request
${userMessages || "User request"}

### Current Work
In progress...

### Pending Tasks
- None identified

### Files and Code
${options.customInstructions || "See conversation history"}
`;

    return summary;
  }
}

// ============================================================================
// Export for skill system
// ============================================================================

export { AdaptiveCompressorEngine as default };
