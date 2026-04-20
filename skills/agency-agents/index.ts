/**
 * Agency Agents Module
 * ====================
 * Dynamic personality injection for Ouroboros agent loops.
 * Loads specialized agent definitions (Markdown with YAML frontmatter)
 * and injects them as system prompts into agent runners.
 *
 * Based on: https://github.com/msitarzewski/agency-agents (MIT)
 */

export { loadAgentsFromDir, type AgentDefinition } from "./loader.ts";
export { AgentRegistry, getAgentRegistry, reloadAgentRegistry, _resetAgentRegistry } from "./registry.ts";
export { buildSystemPrompt, buildConciseSystemPrompt, buildOrchestratorPrompt, type AgentSystemPrompt } from "./prompt-builder.ts";
