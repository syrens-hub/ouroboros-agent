/**
 * Adaptive Compression Types
 * Shared type definitions for the adaptive compression system.
 * Designed to match OpenClaw ContextEngine interface patterns.
 */

// ============ Message Types ============

/**
 * Minimal AgentMessage interface matching OpenClaw's pi-agent-core types.
 * Only includes fields used by the compressor.
 */
export interface AgentMessage {
  id?: string;
  role: "user" | "assistant" | "system" | "tool_result" | "tool_call";
  content: string | ContentBlock[];
  name?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
  attachments?: Attachment[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string | ContentBlock[] }
  | { type: "image"; source: { type: "base64" | "url"; mediaType: string; data: string } }
  | { type: "thinking"; thinking: string };

export interface Attachment {
  type: "image" | "document" | "audio";
  name?: string;
  mimeType?: string;
  url?: string;
}

// ============ Complexity Types ============

export interface ComplexityScore {
  total: number;
  toolResultTokens: number;
  codeBlockCount: number;
  uniqueFileCount: number;
  errorDensity: number;
  turnCount: number;
  imageCount: number;
  attachmentCount: number;
}

export interface CompressionQuality {
  hasFileReferences: boolean;
  hasCodeSnippets: boolean;
  hasErrorContext: boolean;
  hasDecisionRecord: boolean;
  hasPendingTasks: boolean;
  coverageRatio: number;
  informationDensity: number;
  sectionCompleteness: number;
}

export interface QualityGrade {
  score: number;
  grade: "A" | "B" | "C" | "D";
  passed: boolean;
  warnings: string[];
  missingSections: string[];
}

export interface AdaptiveThreshold {
  warningThreshold: number;
  targetTokens: number;
  compressionRatio: number;
  strategy: "aggressive" | "normal" | "conservative";
}

// ============ Config Types ============

export interface AdaptiveCompressorConfig {
  /** Token count to trigger compression warning */
  baseWarningThreshold: number;
  /** Target token count after compression */
  baseTargetTokens: number;
  /** Weight for tool result tokens in complexity score */
  toolResultWeight: number;
  /** Weight per code block in complexity score */
  codeBlockWeight: number;
  /** Weight per unique file in complexity score */
  uniqueFileWeight: number;
  /** Weight for error density in complexity score */
  errorDensityWeight: number;
  /** Minimum quality score (0-100) to pass */
  minQualityScore: number;
  /** Minimum coverage ratio (0-1) to pass */
  minCoverageRatio: number;
  /** Minimum information density (0-1) to pass */
  minInformationDensity: number;
  /** Required sections for quality evaluation */
  requiredSections: string[];
  /** Maximum retry attempts for summary generation */
  maxRetries: number;
  /** Quality score threshold to trigger retry */
  retryThreshold: number;
}

export const DEFAULT_CONFIG: AdaptiveCompressorConfig = {
  baseWarningThreshold: 180_000,
  baseTargetTokens: 40_000,
  toolResultWeight: 0.4,
  codeBlockWeight: 80,
  uniqueFileWeight: 40,
  errorDensityWeight: 0.3,
  minQualityScore: 60,
  minCoverageRatio: 0.05,
  minInformationDensity: 0.5,
  requiredSections: [
    "Primary Request",
    "Files and Code",
    "Current Work",
    "Pending Tasks",
    "Errors and Fixes",
  ],
  maxRetries: 2,
  retryThreshold: 75,
};

// ============ Quality Section Patterns ============

export interface QualitySectionPattern {
  section: string;
  patterns: RegExp[];
}

export const QUALITY_SECTION_PATTERNS: QualitySectionPattern[] = [
  { section: "Primary Request", patterns: [/primary request/i, /intent/i, /goal/i] },
  {
    section: "Key Technical Concepts",
    patterns: [/technical concepts?/i, /technolog/i],
  },
  {
    section: "Files and Code",
    patterns: [/files?(?: and code)?/i, /\.ts|\.js|\.py|\.go|\.rs/i],
  },
  { section: "Errors and Fixes", patterns: [/error|fix/i] },
  { section: "Problem Solving", patterns: [/problem|solution/i] },
  { section: "All User Messages", patterns: [/user messages?/i] },
  { section: "Pending Tasks", patterns: [/pending|task|to[- ]?do/i] },
  { section: "Current Work", patterns: [/current work/i, /was being worked/i] },
  { section: "Optional Next Step", patterns: [/next step/i] },
];

// ============ Assessment Result ============

export interface FullAssessment {
  complexity: ComplexityScore;
  threshold: AdaptiveThreshold;
  quality: CompressionQuality;
  grade: QualityGrade;
  shouldCompact: boolean;
  recommendedTargetTokens: number;
  retryInstructions?: string;
}

// ============ OpenClaw ContextEngine Interface Types ============

export interface AssembleResult {
  messages: AgentMessage[];
  estimatedTokens: number;
  systemPromptAddition?: string;
}

export interface CompactResult {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  result?: {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore: number;
    tokensAfter?: number;
    details?: unknown;
  };
}

export interface IngestResult {
  ingested: boolean;
}

export interface ContextEngineInfo {
  id: string;
  name: string;
  version?: string;
  ownsCompaction?: boolean;
}
