/**
 * Adaptive Compression Tools
 * OpenClaw Skill tools for calling the engine from agent conversations.
 *
 * Tools exposed:
 * - assess_compression: Analyze complexity and determine compression need
 * - compact_conversation: Compact with quality-guaranteed summary
 * - log_compression: Log compression assessment for debugging
 */

import type { AgentMessage } from "./types.js";
import { AdaptiveCompressorEngine } from "./AdaptiveCompressorEngine.js";

// Singleton engine instance
const engine = new AdaptiveCompressorEngine();

// Tool input/output schemas
export const ASSESS_COMPRESSION_SCHEMA = {
  name: "assess_compression",
  description:
    "Analyze conversation complexity and determine if compression is needed. " +
    "Returns adaptive thresholds based on conversation structure (code blocks, " +
    "files, errors, etc.). Use this before compact to understand why compression " +
    "is or isn't needed.",
  input_schema: {
    type: "object",
    properties: {
      messages: {
        type: "array",
        description: "Array of conversation messages",
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["user", "assistant", "system", "tool_result"] },
            content: { type: "string" },
          },
        },
      },
      token_budget: {
        type: "number",
        description: "Optional token budget override",
      },
    },
    required: ["messages"],
  },
};

export const COMPACT_CONVERSATION_SCHEMA = {
  name: "compact_conversation",
  description:
    "Compress conversation history using adaptive compression. " +
    "Generates quality-assessed summary with retry on low quality. " +
    "Uses complexity-driven thresholds and 7-dimension quality evaluation.",
  input_schema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "Session identifier for state tracking",
      },
      messages: {
        type: "array",
        description: "Full conversation messages to compress",
        items: {
          type: "object",
          properties: {
            role: { type: "string" },
            content: { type: "string" },
          },
        },
      },
      token_budget: {
        type: "number",
        description: "Target token count after compression",
      },
      force: {
        type: "boolean",
        description: "Force compression even if below threshold",
      },
    },
    required: ["messages"],
  },
};

export const LOG_COMPRESSION_SCHEMA = {
  name: "log_compression",
  description:
    "Log compression assessment in structured format for debugging. " +
    "Returns a single-line summary suitable for logging.",
  input_schema: {
    type: "object",
    properties: {
      messages: {
        type: "array",
        description: "Messages to assess and log",
      },
    },
    required: ["messages"],
  },
};

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Assess compression need for a conversation.
 */
export function assessCompression(params: {
  messages: Array<{ role: string; content: string }>;
  token_budget?: number;
}): {
  ok: boolean;
  complexity: {
    total: number;
    tool_result_tokens: number;
    code_block_count: number;
    unique_file_count: number;
    error_density: number;
    turn_count: number;
  };
  threshold: {
    warning_threshold: number;
    target_tokens: number;
    compression_ratio: number;
    strategy: string;
  };
  should_compact: boolean;
  log_line: string;
} {
  const agentMessages: AgentMessage[] = params.messages.map((m) => ({
    role: m.role as AgentMessage["role"],
    content: m.content,
  }));

  const assessment = engine.assess({
    messages: agentMessages,
    tokenBudget: params.token_budget,
  });

  return {
    ok: true,
    complexity: {
      total: Math.round(assessment.complexity.total),
      tool_result_tokens: assessment.complexity.toolResultTokens,
      code_block_count: assessment.complexity.codeBlockCount,
      unique_file_count: assessment.complexity.uniqueFileCount,
      error_density: Math.round(assessment.complexity.errorDensity * 1000) / 1000,
      turn_count: assessment.complexity.turnCount,
    },
    threshold: {
      warning_threshold: assessment.threshold.warningThreshold,
      target_tokens: assessment.threshold.targetTokens,
      compression_ratio: Math.round(assessment.threshold.compressionRatio * 1000) / 1000,
      strategy: assessment.threshold.strategy,
    },
    should_compact: assessment.shouldCompact,
    log_line: engine.logAssessment(assessment),
  };
}

/**
 * Compact conversation with quality guarantee.
 */
export async function compactConversation(params: {
  session_id?: string;
  messages: Array<{ role: string; content: string }>;
  token_budget?: number;
  force?: boolean;
}): Promise<{
  ok: boolean;
  compacted: boolean;
  reason: string;
  summary?: string;
  tokens_before?: number;
  tokens_after?: number;
  quality_grade?: string;
  quality_score?: number;
  attempts?: number;
}> {
  const sessionId = params.session_id ?? "default";
  const agentMessages: AgentMessage[] = params.messages.map((m) => ({
    role: m.role as AgentMessage["role"],
    content: m.content,
  }));

  // First, ingest messages
  for (const msg of agentMessages) {
    await engine.ingest({ sessionId, message: msg });
  }

  // Then compact
  const result = await engine.compact({
    sessionId,
    sessionFile: "",
    tokenBudget: params.token_budget,
    force: params.force,
  });

  const details = result.result?.details as Record<string, unknown> | undefined;
  const quality = details?.quality as Record<string, unknown> | undefined;
  return {
    ok: result.ok,
    compacted: result.compacted ?? false,
    reason: result.reason ?? "unknown",
    summary: result.result?.summary,
    tokens_before: result.result?.tokensBefore,
    tokens_after: result.result?.tokensAfter,
    quality_grade: typeof details?.grade === "string" ? details.grade : undefined,
    quality_score: quality && typeof quality.sectionCompleteness === "number" ? Math.round(quality.sectionCompleteness * 100) : undefined,
    attempts: typeof details?.attempts === "number" ? details.attempts : undefined,
  };
}

/**
 * Log compression assessment.
 */
export function logCompression(params: {
  messages: Array<{ role: string; content: string }>;
}): { log_line: string } {
  const agentMessages: AgentMessage[] = params.messages.map((m) => ({
    role: m.role as AgentMessage["role"],
    content: m.content,
  }));

  const assessment = engine.assess({ messages: agentMessages });
  return { log_line: engine.logAssessment(assessment) };
}
