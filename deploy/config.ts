/**
 * Deployment Configuration
 * ========================
 * Multi-platform deployment config, env vars, and build commands.
 */

import { z } from "zod";

// =============================================================================
// Platform Types
// =============================================================================

export const DeploymentPlatformSchema = z.enum(["vercel", "flyio", "railway", "k8s", "docker", "helm"]);
export type DeploymentPlatform = z.infer<typeof DeploymentPlatformSchema>;

// =============================================================================
// Base Config
// =============================================================================

export const DeploymentConfigSchema = z.object({
  platform: DeploymentPlatformSchema,
  projectPath: z.string().describe("Absolute path to the project directory"),
  projectName: z.string().optional().describe("Override project name (defaults to dir name)"),
  domain: z.string().optional().describe("Custom domain for the deployment"),
  ssl: z.boolean().default(true).describe("Enable SSL/TLS"),
  region: z.string().optional().describe("Deployment region (platform-specific)"),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

// =============================================================================
// Environment Variables
// =============================================================================

export const EnvVarSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  secret: z.boolean().default(false).describe("If true, stored as secret (not logged)"),
});

export const EnvVarListSchema = z.array(EnvVarSchema);
export type EnvVar = z.infer<typeof EnvVarSchema>;

// =============================================================================
// Build Configuration
// =============================================================================

export const BuildConfigSchema = z.object({
  /** Directory relative to projectPath (default: '.') */
  rootDir: z.string().default("."),
  /** Build command (default: platform-detected) */
  buildCommand: z.string().optional(),
  /** Output directory for frontend (default: 'dist') */
  outputDir: z.string().default("dist"),
  /** Install command (default: 'npm install') */
  installCommand: z.string().optional(),
  /** Environment variables to inject at build time */
  buildEnv: EnvVarListSchema.optional(),
  /** Framework detection hint */
  framework: z.enum(["next", "nuxt", "remix", "sveltekit", "vite", "express", "fastify", "nest", "generic"]).optional(),
  /** Node version constraint */
  nodeVersion: z.string().optional(),
});

export type BuildConfig = z.infer<typeof BuildConfigSchema>;

// =============================================================================
// Platform-Specific Config
// =============================================================================

export const VercelConfigSchema = z.object({
  platform: z.literal("vercel"),
  projectPath: z.string(),
  projectName: z.string().optional(),
  domain: z.string().optional(),
  ssl: z.boolean().default(true),
  region: z.string().optional(),
  buildConfig: BuildConfigSchema.optional(),
  /** Vercel team slug (for org deployments) */
  teamSlug: z.string().optional(),
  /** Token (falls back to VERCEL_TOKEN env var) */
  token: z.string().optional(),
});

export const FlyioConfigSchema = z.object({
  platform: z.literal("flyio"),
  projectPath: z.string(),
  projectName: z.string().optional(),
  domain: z.string().optional(),
  ssl: z.boolean().default(true),
  region: z.string().optional(),
  buildConfig: BuildConfigSchema.optional(),
  /** Fly.io app name (defaults to projectName) */
  appName: z.string().optional(),
  /** VM size (e.g. 'shared-cpu-1x', 'performance-1x') */
  vmSize: z.string().default("shared-cpu-1x"),
  /** VM memory in MB */
  vmMemory: z.number().default(1024),
  /** Auto halt after N seconds of inactivity (0 = no autohalt) */
  autoHaltSeconds: z.number().default(0),
  /** Dockerfile path relative to projectPath */
  dockerfile: z.string().optional(),
});

export const RailwayConfigSchema = z.object({
  platform: z.literal("railway"),
  projectPath: z.string(),
  projectName: z.string().optional(),
  domain: z.string().optional(),
  ssl: z.boolean().default(true),
  region: z.string().optional(),
  buildConfig: BuildConfigSchema.optional(),
  /** Railway service name */
  serviceName: z.string().optional(),
  /** Environment to deploy to */
  environment: z.string().default("production"),
  /** Token (falls back to RAILWAY_TOKEN env var) */
  token: z.string().optional(),
});

export const PlatformConfigSchema = z.discriminatedUnion("platform", [
  VercelConfigSchema,
  FlyioConfigSchema,
  RailwayConfigSchema,
]);

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

// =============================================================================
// Rollback Config
// =============================================================================

export const RollbackOptionsSchema = z.object({
  /** Deployment ID to roll back to. If omitted, rolls back to the previous deployment. */
  deploymentId: z.string().optional(),
  /** Force rollback even if there are newer deployments */
  force: z.boolean().default(false),
});

export type RollbackOptions = z.infer<typeof RollbackOptionsSchema>;

// =============================================================================
// Deployment Result
// =============================================================================

export const DeploymentResultSchema = z.object({
  success: z.boolean(),
  deploymentId: z.string().optional(),
  deploymentUrl: z.string().optional(),
  platform: DeploymentPlatformSchema,
  message: z.string(),
  logs: z.string().optional(),
  /** Timestamp when deployment was triggered */
  triggeredAt: z.string().optional(),
  /** Estimated time to live (seconds) */
  ttlSeconds: z.number().optional(),
});

export type DeploymentResult = z.infer<typeof DeploymentResultSchema>;

// =============================================================================
// Deployment Status
// =============================================================================

export const DeploymentStatusSchema = z.object({
  deploymentId: z.string(),
  status: z.enum(["QUEUED", "BUILDING", "DEPLOYING", "SUCCESS", "FAILED", "CANCELLED", "ERROR"]),
  platform: DeploymentPlatformSchema,
  url: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  commit: z.string().optional(),
  region: z.string().optional(),
  error: z.string().optional(),
});

export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

// =============================================================================
// Deployment History Entry
// =============================================================================

export const DeploymentHistoryEntrySchema = z.object({
  deploymentId: z.string(),
  platform: DeploymentPlatformSchema,
  status: z.enum(["QUEUED", "BUILDING", "DEPLOYING", "SUCCESS", "FAILED", "CANCELLED", "ERROR"]),
  url: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  commit: z.string().optional(),
  message: z.string().optional(),
});

export type DeploymentHistoryEntry = z.infer<typeof DeploymentHistoryEntrySchema>;

// =============================================================================
// Default timeouts
// =============================================================================

export const DEPLOY_TIMEOUT_MS = 300_000; // 5 minutes
export const STATUS_POLL_INTERVAL_MS = 5_000; // 5 seconds
