import type { AgentLoopState } from "../../types/index.ts";

export function createAgentLoopState(
  sessionId: string,
  skillPrompts: string[] = [],
  mode: "orchestrator" | "worker" = "worker",
  overrideSystemPrompt?: string
): AgentLoopState {
  const orchestratorPrompt =
    "You are the Orchestrator. You do NOT execute tasks directly. " +
    "Your ONLY job is to:\n" +
    "1) Understand the user's high-level request.\n" +
    "2) Decompose it into concrete subtasks.\n" +
    "3) Delegate EACH subtask to a specialized worker via the `delegate_task` tool.\n" +
    "4) Wait for results, verify completeness, and report a concise summary to the user.\n\n" +
    "CRITICAL RULES:\n" +
    "- You MUST NOT write code, read files, browse the web, or perform any concrete work yourself.\n" +
    "- For EVERY user request, no matter how simple, you MUST call `delegate_task`.\n" +
    "- Never output code, file contents, or search results directly. Only the Worker may do so.\n" +
    "- Your response to the user must be a brief summary of what the worker accomplished.";

  const workerPrompt =
    "You are Ouroboros, a self-modifying agent. " +
    "You may use tools. After complex successes, consider saving knowledge as a skill. " +
    "You may also propose improvements to your own agent loop via self_modify.";

  const basePrompt = overrideSystemPrompt || (mode === "orchestrator" ? orchestratorPrompt : workerPrompt);
  const systemContent =
    basePrompt +
    (skillPrompts.length > 0
      ? "\n\nLoaded skills:\n" + skillPrompts.map((s) => `- ${s}`).join("\n")
      : "");
  return {
    sessionId,
    messages: [{ role: "system", content: systemContent }],
    status: "idle",
    activeTaskIds: [],
    loadedSkills: [],
    turnCount: 0,
    maxTurns: 32,
    contextBudget: 8000,
    compressThreshold: 6400,
  };
}
