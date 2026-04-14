/**
 * Complexity Scorer
 * Analyzes message history to compute a multi-dimensional complexity score.
 *
 * Design principles:
 * - Deterministic: same input → same output (no Math.random())
 * - Feature-rich: not just token count, but structural features
 */

import type { AgentMessage, ComplexityScore, AdaptiveCompressorConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

const DEFAULT_FILE_PATTERN = /\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|cs|rb|php|swift|kt|m|md|json|yaml|yml|toml|xml|html|css|scss|sass|less)$/i;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```|`[^`]+`/g;
const ERROR_PATTERN = /error|exception|failed|failure|wrong|incorrect|invalid/i;

/**
 * Extract plain text content from an AgentMessage.
 * Handles both string content and structured content blocks.
 */
function extractTextContent(msg: AgentMessage): string {
  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "tool_result") {
          return typeof block.content === "string" ? block.content : "";
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

/**
 * Rough token estimation using character count.
 * Claude Code uses ~4 chars per token for English text.
 * This is a fallback when proper tokenizer is unavailable.
 */
function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  // Rough estimate: 4 characters per token
  return Math.ceil(text.length / 4);
}

export class ComplexityScorer {
  private config: AdaptiveCompressorConfig;
  private filePattern: RegExp;
  private codePattern: RegExp;
  private errorPattern: RegExp;

  constructor(config: Partial<AdaptiveCompressorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.filePattern = DEFAULT_FILE_PATTERN;
    this.codePattern = CODE_BLOCK_PATTERN;
    this.errorPattern = ERROR_PATTERN;
  }

  /**
   * Compute complexity score from message history.
   *
   * Dimensions:
   * - toolResultTokens: tokens in user messages (proxy for input complexity)
   * - codeBlockCount: number of code blocks (structural complexity)
   * - uniqueFileCount: number of unique files mentioned (breadth)
   * - errorDensity: error mentions per turn (problem severity)
   */
  computeComplexity(messages: AgentMessage[]): ComplexityScore {
    let toolResultTokens = 0;
    let codeBlockCount = 0;
    const uniqueFiles = new Set<string>();
    let errorCount = 0;
    let imageCount = 0;
    let attachmentCount = 0;

    for (const msg of messages) {
      const content = extractTextContent(msg);

      if (msg.role === "user" && content) {
        toolResultTokens += estimateTokens(content);
        codeBlockCount += this.countMatches(content, this.codePattern);
        this.extractFileMatches(content, this.filePattern).forEach((f) =>
          uniqueFiles.add(f)
        );
        if (this.errorPattern.test(content)) errorCount++;
      }

      if (msg.attachments && msg.attachments.length > 0) {
        attachmentCount += msg.attachments.length;
        for (const att of msg.attachments) {
          if (att.type === "image" || att.type === "document") {
            imageCount++;
          }
        }
      }

      if (msg.role === "assistant" && content) {
        codeBlockCount += this.countMatches(content, this.codePattern);
        if (this.errorPattern.test(content)) errorCount++;
      }
    }

    const turnCount = Math.max(
      1,
      messages.filter((m) => m.role === "user").length
    );
    const errorDensity = errorCount / turnCount;

    const total =
      toolResultTokens * this.config.toolResultWeight +
      codeBlockCount * this.config.codeBlockWeight +
      uniqueFiles.size * this.config.uniqueFileWeight +
      errorDensity * 10000 * this.config.errorDensityWeight;

    return {
      total,
      toolResultTokens,
      codeBlockCount,
      uniqueFileCount: uniqueFiles.size,
      errorDensity,
      turnCount,
      imageCount,
      attachmentCount,
    };
  }

  /**
   * Get statistics about the message history without full complexity.
   */
  getBasicStats(messages: AgentMessage[]): {
    messageCount: number;
    turnCount: number;
    tokenEstimate: number;
  } {
    let tokenEstimate = 0;
    for (const msg of messages) {
      const content = extractTextContent(msg);
      tokenEstimate += estimateTokens(content);
    }
    return {
      messageCount: messages.length,
      turnCount: messages.filter((m) => m.role === "user").length,
      tokenEstimate,
    };
  }

  private countMatches(text: string, pattern: RegExp): number {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  }

  private extractFileMatches(text: string, pattern: RegExp): string[] {
    const matches = text.match(pattern);
    return matches ? Array.from(matches) : [];
  }
}
