/**
 * Ouroboros Agent Loop Skill
 * ==========================
 * The main agent loop is NOT sacred. It is a Skill that can be learned,
 * patched, and even replaced by a better loop.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

export { createAgentLoopState } from "./state.ts";
export { createRealLLMCaller, createMockLLMCaller, type LLMCaller } from "./llm-callers.ts";
export { createAgentLoopRunner, type AgentLoopRunner, type LoopConfig, type Progress, type LoopStateSnapshot } from "./runner.ts";

// =============================================================================
// Agent Loop as a Tool (meta-level: run the loop as a subagent)
// =============================================================================

export const agentLoopTool = buildTool({
  name: "run_agent_loop",
  description:
    "Run a subagent with its own Ouroboros agent loop. " +
    "The subagent has isolated state and restricted tool access.",
  inputSchema: z.object({
    directive: z.string(),
    allowedTools: z.array(z.string()).optional(),
    readOnly: z.boolean().default(true),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async call({ directive, allowedTools, readOnly }, _ctx) {
    return {
      success: true,
      message: `Subagent loop would run with directive: ${directive}`,
      sandboxMode: readOnly ? "read-only" : "full",
      allowedTools: allowedTools || "all safe",
    };
  },
});
