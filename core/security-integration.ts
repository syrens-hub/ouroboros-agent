/**
 * Ouroboros Security Integration Layer
 * =====================================
 * Integrated security auditing, rate limiting, and tool execution monitoring.
 * 
 * This module bridges the security framework with the tool execution pipeline,
 * providing comprehensive security coverage without performance overhead.
 */

import { securityConfig } from "./config-extension.ts";
import {
  SecurityAuditor,
  ToolRateLimiter,
  PathValidator,
} from "./security-framework.ts";
import { logger } from "./logger.ts";
import type { Tool, ToolPermissionLevel } from "../types/index.ts";

// =============================================================================
// Singleton Instances (lazy initialization)
// =============================================================================

let securityAuditorInstance: SecurityAuditor | null = null;
let toolRateLimiterInstance: ToolRateLimiter | null = null;
let pathValidatorInstance: PathValidator | null = null;

export function getSecurityAuditor(): SecurityAuditor {
  if (!securityAuditorInstance) {
    securityAuditorInstance = new SecurityAuditor();
    logger.info("SecurityAuditor initialized");
  }
  return securityAuditorInstance;
}

export function getToolRateLimiter(): ToolRateLimiter {
  if (!toolRateLimiterInstance) {
    toolRateLimiterInstance = new ToolRateLimiter();
    logger.info("ToolRateLimiter initialized");
  }
  return toolRateLimiterInstance;
}

export function getPathValidator(): PathValidator {
  if (!pathValidatorInstance) {
    const denyPatterns = securityConfig.pathValidation?.denyPatterns ?? [
      "/etc/passwd",
      "/etc/shadow",
      "/.aws/credentials",
      "/.ssh/id_rsa",
      "/.env",
      "**/secrets/**",
      "**/.git/config",
    ];
    pathValidatorInstance = new PathValidator(denyPatterns);
    logger.info("PathValidator initialized", { denyPatterns });
  }
  return pathValidatorInstance;
}

// =============================================================================
// Tool Execution Security Context
// =============================================================================

export interface ToolSecurityContext {
  sessionId: string;
  userId?: string;
  toolName: string;
  toolInput: unknown;
  permissionLevel: ToolPermissionLevel;
  startTime: number;
}

// =============================================================================
// Security Check Results
// =============================================================================

export interface SecurityCheckResult {
  allowed: boolean;
  reason: string;
  rateLimitRemaining?: number;
  rateLimitRetryAfter?: number;
}

export interface PathValidationResult {
  valid: boolean;
  reason?: string;
}

// =============================================================================
// Pre-Execution Security Checks
// =============================================================================

export interface PreExecutionSecurityOptions {
  sessionId: string;
  userId?: string;
  enableRateLimiting?: boolean;
  enablePathValidation?: boolean;
  enableAuditLogging?: boolean;
}

/**
 * Perform comprehensive security checks before tool execution.
 * Returns the result of all security validations.
 */
export function preExecutionSecurityCheck(
  tool: Tool<unknown, unknown, unknown>,
  toolInput: unknown,
  opts: PreExecutionSecurityOptions
): SecurityCheckResult {
  const { sessionId, enableRateLimiting = true, enableAuditLogging = true } = opts;
  
  // 1. Rate Limiting Check
  if (enableRateLimiting) {
    const rateLimitConfig = securityConfig.rateLimiting ?? {
      maxCallsPerMinute: 100,
      windowMs: 60000,
    };
    
    const rateLimitResult = getToolRateLimiter().checkToolRateLimit(
      sessionId,
      tool.name,
      rateLimitConfig.maxCallsPerMinute,
      rateLimitConfig.windowMs
    );

    if (!rateLimitResult.allowed) {
      logger.warn("Rate limit exceeded", {
        sessionId,
        toolName: tool.name,
        retryAfter: rateLimitResult.retryAfter,
      });

      if (enableAuditLogging) {
        getSecurityAuditor().logDecision(
          sessionId,
          tool.name,
          toolInput,
          "deny",
          `Rate limit exceeded. Retry after ${rateLimitResult.retryAfter}s`
        );
      }

      return {
        allowed: false,
        reason: `Rate limit exceeded. Retry after ${rateLimitResult.retryAfter} seconds`,
        rateLimitRemaining: 0,
        rateLimitRetryAfter: rateLimitResult.retryAfter,
      };
    }
  }

  // All checks passed
  return {
    allowed: true,
    reason: "All security checks passed",
  };
}

/**
 * Validate file paths in tool input for security violations.
 * Returns the validation result.
 */
export function validateToolInputPaths(
  tool: Tool<unknown, unknown, unknown>,
  toolInput: unknown,
  pathFields: string[] = ["file_path", "path", "targetPath", "sourcePath"]
): PathValidationResult {
  const validator = getPathValidator();
  
  if (typeof toolInput !== "object" || toolInput === null) {
    return { valid: true };
  }

  const inputObj = toolInput as Record<string, unknown>;
  
  for (const field of pathFields) {
    const pathValue = inputObj[field];
    
    if (typeof pathValue === "string" && pathValue.length > 0) {
      if (!validator.validate(pathValue)) {
        logger.warn("Path validation failed", {
          toolName: tool.name,
          field,
          path: pathValue,
        });
        
        return {
valid: false,
          reason: `Path '${pathValue}' in field '${field}' violates security policy`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Log tool execution decision to the security audit log.
 */
export function logToolExecution(
  ctx: ToolSecurityContext,
  decision: ToolPermissionLevel,
  additionalContext?: Record<string, unknown>
): void {
  const auditor = getSecurityAuditor();
  
  const reason = additionalContext?.reason as string || 
    `Tool '${ctx.toolName}' execution ${decision}`;
  
  auditor.logDecision(
    ctx.sessionId,
    ctx.toolName,
    ctx.toolInput,
    decision,
    reason
  );

  logger.debug("Security audit logged", {
    sessionId: ctx.sessionId,
    toolName: ctx.toolName,
    decision,
    executionTimeMs: Date.now() - ctx.startTime,
  });
}

/**
 * Get recent security audits for a session or globally.
 */
export function getRecentSecurityAudits(
  sessionId?: string,
  limit = 50
): ReturnType<SecurityAuditor["getRecentAudits"]> {
  return getSecurityAuditor().getRecentAudits(sessionId, limit);
}

// =============================================================================
// Security Middleware Factory
// =============================================================================

export interface SecurityMiddlewareOptions {
  sessionId: string;
  userId?: string;
  skipRateLimiting?: boolean;
  skipAuditLogging?: boolean;
  skipPathValidation?: boolean;
  pathFields?: string[];
}

/**
 * Create a security middleware function for tool execution.
 * This can be used to wrap tool calls with comprehensive security checks.
 */
export function createSecurityMiddleware(
  tool: Tool<unknown, unknown, unknown>,
  opts: SecurityMiddlewareOptions
) {
  const { sessionId, skipRateLimiting, skipAuditLogging: _skipAuditLogging, skipPathValidation, pathFields } = opts;
  
  return async function securityMiddleware(
    input: unknown
  ): Promise<{ canExecute: boolean; error?: string }> {
    const startTime = Date.now();
    const ctx: ToolSecurityContext = {
      sessionId,
      userId: opts.userId,
      toolName: tool.name,
      toolInput: input,
      permissionLevel: "ask", // Default until evaluated
      startTime,
    };

    // 1. Path Validation (if enabled)
    if (!skipPathValidation) {
      const pathResult = validateToolInputPaths(tool, input, pathFields);
      if (!pathResult.valid) {
        logToolExecution(ctx, "deny", { reason: pathResult.reason });
        return { canExecute: false, error: pathResult.reason };
      }
    }

    // 2. Rate Limiting (if enabled)
    if (!skipRateLimiting) {
      const rateLimitResult = preExecutionSecurityCheck(tool, input, {
        sessionId,
        userId: opts.userId,
        enableRateLimiting: true,
        enableAuditLogging: false, // Will log after decision
      });

      if (!rateLimitResult.allowed) {
        logToolExecution(ctx, "deny", { reason: rateLimitResult.reason });
        return { canExecute: false, error: rateLimitResult.reason };
      }
    }

    return { canExecute: true };
  };
}

// =============================================================================
// Export default security config
// =============================================================================

export const DEFAULT_SECURITY_CONFIG = {
  rateLimiting: {
    maxCallsPerMinute: 100,
    windowMs: 60000,
  },
  pathValidation: {
    denyPatterns: [
      "/etc/passwd",
      "/etc/shadow",
      "/.aws/credentials",
      "/.ssh/id_rsa",
      "/.env",
      "**/secrets/**",
      "**/.git/config",
    ],
  },
  auditLogging: {
    enabled: true,
    retentionDays: 90,
  },
};
