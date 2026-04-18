import { z } from "zod";

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
