import { safeJsonParse } from "../../core/safe-utils.ts";

/**
 * Handoff Protocol
 * ================
 * Standardized context passing between agents in a crew.
 * Ensures continuity when one agent finishes and another takes over.
 */

export interface HandoffContext {
  fromAgent: string;
  toAgent: string;
  taskId: string;
  summary: string;
  keyFindings: string[];
  openQuestions: string[];
  constraints: string[];
  artifacts: Array<{ name: string; content: string }>;
  timestamp: number;
}

export function createHandoff(params: {
  fromAgent: string;
  toAgent: string;
  taskId: string;
  summary: string;
  keyFindings?: string[];
  openQuestions?: string[];
  constraints?: string[];
  artifacts?: Array<{ name: string; content: string }>;
}): HandoffContext {
  return {
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    taskId: params.taskId,
    summary: params.summary,
    keyFindings: params.keyFindings ?? [],
    openQuestions: params.openQuestions ?? [],
    constraints: params.constraints ?? [],
    artifacts: params.artifacts ?? [],
    timestamp: Date.now(),
  };
}

export function applyHandoff(handoff: HandoffContext, nextTaskDescription: string): string {
  const parts: string[] = [
    `## Context Handoff from ${handoff.fromAgent} → ${handoff.toAgent}`,
    "",
    `**Summary:** ${handoff.summary}`,
    "",
  ];

  if (handoff.keyFindings.length > 0) {
    parts.push("**Key Findings:**");
    for (const finding of handoff.keyFindings) {
      parts.push(`- ${finding}`);
    }
    parts.push("");
  }

  if (handoff.openQuestions.length > 0) {
    parts.push("**Open Questions:**");
    for (const q of handoff.openQuestions) {
      parts.push(`- ${q}`);
    }
    parts.push("");
  }

  if (handoff.constraints.length > 0) {
    parts.push("**Constraints:**");
    for (const c of handoff.constraints) {
      parts.push(`- ${c}`);
    }
    parts.push("");
  }

  if (handoff.artifacts.length > 0) {
    parts.push("**Artifacts:**");
    for (const art of handoff.artifacts) {
      parts.push(`- **${art.name}:**`);
      parts.push("```");
      parts.push(art.content.slice(0, 2000));
      parts.push("```");
    }
    parts.push("");
  }

  parts.push("---");
  parts.push("");
  parts.push(`**Your Task:** ${nextTaskDescription}`);

  return parts.join("\n");
}

export function serializeHandoff(handoff: HandoffContext): string {
  return JSON.stringify(handoff);
}

export function deserializeHandoff(raw: string): HandoffContext | undefined {
  const parsed = safeJsonParse<HandoffContext>(raw, "handoff context");
  if (parsed && parsed.fromAgent && parsed.toAgent && parsed.taskId && parsed.summary !== undefined) {
    return parsed;
  }
  return undefined;
}
