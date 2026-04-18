import { z } from "zod";
import type { BaseMessage } from "./messages.ts";
import type { TaskId, SkillName } from "./core.ts";

// ============================================================================
// Agent Loop State
// ============================================================================

export const AgentLoopStatusSchema = z.enum(["idle", "running", "error"]);
export type AgentLoopStatus = z.infer<typeof AgentLoopStatusSchema>;

export interface AgentLoopState {
  readonly sessionId: string;
  messages: BaseMessage[];
  status: AgentLoopStatus;
  readonly activeTaskIds: TaskId[];
  loadedSkills: SkillName[];
  turnCount: number;
  readonly maxTurns: number;
  contextBudget?: number;
  compressThreshold?: number;
}

// ============================================================================
// Multi-Agent Types
// ============================================================================

export interface AgentRole {
  name: string;
  description: string;
  allowedTools: string[];
  systemPrompt?: string;
}

export interface SubTask {
  taskId: string;
  role: string;
  prompt: string;
  context?: BaseMessage[];
}

export interface TaskResult {
  taskId: string;
  role: string;
  output: string;
  status: "success" | "failure";
}
