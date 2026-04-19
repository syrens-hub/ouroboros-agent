/**
 * Ouroboros Core SDK Surface
 * ==========================
 * This is the ONLY allowed import surface for extensions and skills.
 * Deep imports into core internals are forbidden.
 */

export { createRuleEngine, defaultRuleEngine, META_RULE_AXIOM } from "./rule-engine.ts";
export type { RuleEngine } from "./rule-engine.ts";

export {
  buildTool,
  createToolPool,
  assembleToolPool,
  StreamingToolExecutor,
} from "./tool-framework.ts";
export type { ToolPool, ToolBuildOptions } from "./tool-framework.ts";

export {
  runPermissionPipeline,
  evaluateRules,
  resolveSubagentTools,
} from "./permission-gate.ts";
export type { PermissionPipelineInput } from "./permission-gate.ts";

export {
  createChildAbortController,
  generateTaskId,
} from "./sandbox.ts";

export type { SandboxContext } from "../types/sandbox.ts";

export { streamLLM, callLLM } from "./llm-router.ts";
export type { LLMConfig, LLMStreamChunk, LLMProvider } from "./llm-router.ts";

export { cachedLlmCall, getSemanticCache, resetSemanticCache } from "./llm-cache-wrapper.ts";
export type { CachedLlmCallOpts } from "./llm-cache-wrapper.ts";

export {
  InMemorySemanticCache,
  DbSemanticCache,
  cosineSimilarity,
} from "./semantic-cache.ts";
export type {
  SemanticCache,
  SemanticCacheEntry,
  CacheResult,
} from "./semantic-cache.ts";

export {
  createSession,
  getSession,
  updateSession,
  appendMessage,
  getMessages,
  searchMessages,
  saveTrajectory,
  getTrajectories,
  upsertSkillRegistry,
  getSkillRegistry,
  logModification,
  splitSession,
} from "./session-db.ts";

export {
  createDbABTestFramework,
  DbABTestFramework,
  djb2Hash,
} from "./ab-test.ts";
export type { ABTest, ABTestFramework, ABTestMetrics } from "./ab-test.ts";
