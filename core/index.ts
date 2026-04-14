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
  createSandboxContext,
  createSandboxToolCallContext,
  createChildAbortController,
  generateTaskId,
} from "./sandbox.ts";
export type { SandboxContext } from "./sandbox.ts";

export { streamLLM, callLLM } from "./llm-router.ts";
export type { LLMConfig, LLMStreamChunk, LLMProvider } from "./llm-router.ts";

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
