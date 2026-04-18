import { z } from "zod";
import { SkillNameSchema } from "./core.ts";

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
  readonly name: string;
  readonly frontmatter: SkillFrontmatter;
  readonly markdownBody: string;
  readonly directory: string;
  readonly sourceCodeFiles?: Map<string, string>;
}
