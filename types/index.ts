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

export interface Tool<Input, Output = unknown, Progress = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<Input>;

  /** Whether the tool only reads state (does not mutate files/system). */
  readonly isReadOnly: boolean;

  /** Whether multiple invocations of this tool can run concurrently safely. */
  readonly isConcurrencySafe: boolean | ((input: unknown) => boolean);

  /** Custom permission check beyond rule matching. */
  checkPermissions(input: Input, ctx: ToolPermissionContext): Result<ToolPermissionLevel>;

  /** Execute the tool. */
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

// ============================================================================
// Message Types
// ============================================================================

export const MessageRoleSchema = z.enum(["system", "user", "assistant", "tool_result"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;

export const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ImageBlockSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(["low", "high", "auto"]).optional(),
  }),
});
export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const ContentBlockSchema = z.union([TextBlockSchema, ImageBlockSchema]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const BaseMessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.union([z.string(), z.array(z.union([ContentBlockSchema, ToolUseBlockSchema, z.record(z.unknown())]))]),
  name: z.string().optional(),
});
export type BaseMessage = z.infer<typeof BaseMessageSchema>;

export const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.union([z.string(), z.array(z.union([TextBlockSchema, ToolUseBlockSchema]))]),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
  }).optional(),
});
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

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
// Self-Modification Boundary
// ============================================================================

export const ModificationTypeSchema = z.enum([
  "skill_create",
  "skill_update",
  "skill_patch",
  "skill_delete",
  "core_evolve",
  "loop_replace",
  "rule_engine_override",
]);
export type ModificationType = z.infer<typeof ModificationTypeSchema>;

export const ModificationRequestSchema = z.object({
  type: ModificationTypeSchema,
  targetPath: z.string().optional(),
  skillName: z.string().optional(),
  description: z.string(),
  estimatedRisk: z.enum(["low", "medium", "high", "critical"]),
  rationale: z.string(),
  patch: z.string().optional(),
  proposedChanges: z.record(z.unknown()).optional(),
});
export type ModificationRequest = z.infer<typeof ModificationRequestSchema>;

// ============================================================================
// Trajectory & Learning
// ============================================================================

export const TrajectoryEntrySchema = z.object({
  turn: z.number(),
  messages: z.array(BaseMessageSchema),
  toolCalls: z.array(z.unknown()),
  outcome: z.enum(["success", "failure", "cancelled", "compressed"]),
  summary: z.string().optional(),
});
export type TrajectoryEntry = z.infer<typeof TrajectoryEntrySchema>;

export interface TrajectoryCompressor {
  compress(entries: TrajectoryEntry[], targetTokens: number): Promise<Result<TrajectoryEntry[]>>;
}

// ============================================================================
// Skill Registry
// ============================================================================

export const SkillFrontmatterSchema = z.object({
  name: SkillNameSchema,
  description: z.string(),
  version: z.string().default("0.1.0"),
  allowedTools: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  autoLoad: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  dependencies: z.record(z.string()).optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface Skill {
  readonly name: SkillName;
  readonly frontmatter: SkillFrontmatter;
  readonly markdownBody: string;
  readonly directory: string;
  readonly sourceCodeFiles?: Map<string, string>; // optional compiled code attachments
}

// ============================================================================
// IM Channel Types
// ============================================================================

export interface ChannelMessage {
  id: string;
  channelId: string;
  threadId?: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: number;
  mentionsBot?: boolean;
  isGroup?: boolean;
  richText?: { type: string; text?: string; value?: string }[];
}

export interface ChannelMember {
  id: string;
  name: string;
}

export interface ChannelInboundAdapter {
  onMessage(handler: (msg: ChannelMessage) => void): () => void;
  onReadReceipt?(handler: (channelId: string, messageId: string, readerId: string) => void): () => void;
}

export interface ChannelOutboundAdapter {
  sendText(channelId: string, text: string, opts?: { threadId?: string; mentionUsers?: string[] }): Promise<Result<unknown>>;
  sendMedia?(channelId: string, mediaUrl: string, opts?: { threadId?: string }): Promise<Result<unknown>>;
  sendRichText(channelId: string, blocks: NonNullable<ChannelMessage["richText"]>, opts?: { threadId?: string }): Promise<Result<unknown>>;
  sendReadReceipt(channelId: string, messageId: string): Promise<Result<unknown>>;
}

export interface ChannelPlugin {
  id: string;
  meta: {
    selectionLabel: string;
    blurb: string;
    aliases?: string[];
  };
  inbound: ChannelInboundAdapter;
  outbound: ChannelOutboundAdapter;
  getMembers(channelId: string): Promise<Result<ChannelMember[]>>;
  getChannelInfo?(channelId: string): Promise<Result<{ name: string; memberCount: number }>>;
}

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// ============================================================================
// Vector Memory Types
// ============================================================================

export interface VectorMemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface VectorMemorySearchResult {
  entry: VectorMemoryEntry;
  score: number;
}

export interface VectorMemory {
  add(sessionId: string, content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(sessionId: string, query: string, topK?: number): Promise<VectorMemorySearchResult[]>;
  delete(sessionId: string, id: string): Promise<boolean>;
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

// ============================================================================
// StateGraph Types
// ============================================================================

export interface Checkpoint<TState> {
  nodeId: string;
  state: TState;
  visited: string[];
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WebhookRegistration {
  id: string;
  path: string;
  secret: string;
  eventType: string;
  targetSessionId?: string;
  enabled: boolean;
}
