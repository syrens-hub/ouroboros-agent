/**
 * Agency Agents Prompt Builder
 * =============================
 * Convert agent definitions into system prompts for LLM injection.
 */

import type { AgentDefinition } from "./loader.ts";

export interface AgentSystemPrompt {
  role: "system";
  content: string;
  agentId: string;
  agentName: string;
}

/**
 * Build a system prompt from an agent definition.
 * Uses the agent's full markdown content as the system prompt.
 */
export function buildSystemPrompt(agent: AgentDefinition): AgentSystemPrompt {
  const header = agent.emoji ? `${agent.emoji} ` : "";
  const prompt = `You are ${header}${agent.name}.

${agent.description}

${agent.content}`;

  return {
    role: "system",
    content: prompt,
    agentId: agent.id,
    agentName: agent.name,
  };
}

/**
 * Build a concise system prompt (for token-budget-constrained scenarios).
 */
export function buildConciseSystemPrompt(agent: AgentDefinition): AgentSystemPrompt {
  const header = agent.emoji ? `${agent.emoji} ` : "";
  const prompt = `You are ${header}${agent.name}. ${agent.description}

${agent.vibe ? `Vibe: ${agent.vibe}` : ""}`;

  return {
    role: "system",
    content: prompt,
    agentId: agent.id,
    agentName: agent.name,
  };
}

/**
 * Build an orchestrator coordination prompt for multi-agent tasks.
 */
export function buildOrchestratorPrompt(agents: AgentDefinition[], taskDescription: string): AgentSystemPrompt {
  const agentList = agents.map((a) => `- ${a.emoji || "•"} ${a.name}: ${a.description}`).join("\n");

  const content = `You are the Orchestrator Agent. Your job is to analyze the following task and delegate subtasks to the most appropriate specialist agents.

## Available Specialists
${agentList}

## Task
${taskDescription}

## Instructions
1. Analyze the task and determine which specialist(s) should handle it.
2. If multiple specialists are needed, break the task into clear subtasks.
3. For each subtask, specify:
   - Which specialist should handle it
   - A detailed description of what they should do
   - Expected deliverables
4. Summarize the overall execution plan.

Respond with a structured delegation plan.`;

  return {
    role: "system",
    content,
    agentId: "orchestrator",
    agentName: "Orchestrator",
  };
}
