import { z } from "zod";

// ============================================================================
// Core Identifiers
// ============================================================================

export const TaskIdSchema = z.string();
export type TaskId = z.infer<typeof TaskIdSchema>;

export const SkillNameSchema = z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/);
export type SkillName = z.infer<typeof SkillNameSchema>;

// ============================================================================
// Result Type (Railway-oriented programming)
// ============================================================================

export const OkSchema = z.object({ success: z.literal(true), data: z.unknown() });
export const ErrSchema = z.object({ success: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) });

export type Ok<T> = { success: true; data: T };
export type Err<E = { code: string; message: string }> = { success: false; error: E };
export type Result<T, E = { code: string; message: string }> = Ok<T> | Err<E>;

export function ok<T>(data: T): Ok<T> {
  return { success: true, data };
}

export function err<E>(error: E): Err<E> {
  return { success: false, error };
}

// ============================================================================
// Tool Types
// ============================================================================

export const ToolPermissionLevelSchema = z.enum(["allow", "ask", "deny"]);
export type ToolPermissionLevel = z.infer<typeof ToolPermissionLevelSchema>;

export const ConditionalRuleSchema = z.object({
  toolPattern: z.string(),
  path: z.string(),
  operator: z.enum(["equals", "contains", "startsWith", "endsWith", "regex", "gt", "lt"]),
  value: z.union([z.string(), z.number()]),
  action: ToolPermissionLevelSchema,
});
export type ConditionalRule = z.infer<typeof ConditionalRuleSchema>;

export const ToolPermissionContextSchema = z.object({
  alwaysAllowRules: z.array(z.string()),
  alwaysDenyRules: z.array(z.string()),
  alwaysAskRules: z.array(z.string()),
  conditionalRules: z.array(ConditionalRuleSchema).optional(),
  mode: z.enum(["interactive", "autonomous", "bypass", "readOnly", "plan"]),
  source: z.enum(["session", "daemon", "subagent", "cli", "worker"]),
  readOnly: z.boolean().optional(),
});
export type ToolPermissionContext = z.infer<typeof ToolPermissionContextSchema>;

export interface ToolCostProfile {
  latency: "instant" | "fast" | "slow" | "variable";
  cpuIntensity: "free" | "low" | "medium" | "high";
  externalCost: "none" | "low" | "medium" | "high";
  tokenEstimate?: number;
}

export interface Tool<Input, Output = unknown, Progress = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<Input>;
  readonly isReadOnly: boolean;
  readonly isConcurrencySafe: boolean | ((input: unknown) => boolean);
  readonly costProfile?: ToolCostProfile;
  checkPermissions(input: Input, ctx: ToolPermissionContext): Result<ToolPermissionLevel>;
  call(input: Input, ctx: ToolCallContext<Progress>): Promise<Output>;
}

export interface ToolCallContext<Progress = unknown> {
  readonly taskId: TaskId;
  readonly abortSignal: AbortSignal;
  readonly reportProgress: (p: Progress) => void;
  readonly invokeSubagent: <I, O>(tool: Tool<I, O>, input: I) => Promise<O>;
}

export interface ToolProgressEvent {
  type: "progress";
  toolName: string;
  step: number;
  totalSteps?: number;
  message: string;
  detail?: Record<string, unknown>;
  toolUseId?: string;
}
