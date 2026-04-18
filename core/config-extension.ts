/**
 * Ouroboros Extended Configuration
 * ===============================
 * Extended configuration for tools, security, and self-healing.
 * This file adds structured config options beyond the base config.ts.
 */


// =============================================================================
// Tool Execution Configuration
// =============================================================================

export interface ToolExecutionConfig {
  /** Maximum number of tools to run concurrently */
  maxConcurrency: number;
  /** Default tool execution timeout in milliseconds */
  defaultTimeoutMs: number;
  /** Maximum retries for failed tools */
  maxRetries: number;
  /** Enable cascade abort on write tool errors */
  enableCascadeAbort: boolean;
  /** Enable sibling cancellation on errors */
  enableSiblingCancellation: boolean;
}

export const toolExecutionConfig: ToolExecutionConfig = {
  maxConcurrency: parseInt(process.env.OUROBOROS_MAX_CONCURRENCY || "10", 10),
  defaultTimeoutMs: parseInt(process.env.OUROBOROS_TOOL_TIMEOUT_MS || "30000", 10),
  maxRetries: parseInt(process.env.OUROBOROS_MAX_RETRIES || "2", 10),
  enableCascadeAbort: process.env.OUROBOROS_ENABLE_CASCADE_ABORT !== "false",
  enableSiblingCancellation: process.env.OUROBOROS_ENABLE_SIBLING_CANCEL !== "false",
};

// =============================================================================
// Security Configuration
// =============================================================================

export interface SecurityConfig {
  rateLimiting: {
    /** Maximum tool calls per session per minute */
    maxCallsPerMinute: number;
    /** Rate limit window in milliseconds */
    windowMs: number;
    /** Enable per-tool rate limiting */
    perTool: boolean;
    /** Enable per-user rate limiting */
    perUser: boolean;
  };
  pathValidation: {
    /** Path patterns that are denied by default */
    denyPatterns: string[];
    /** Enable real-time path validation */
    enabled: boolean;
    /** Custom safe path prefixes */
    safePathPrefixes: string[];
  };
  auditLogging: {
    /** Enable security audit logging */
    enabled: boolean;
    /** Audit log retention in days */
    retentionDays: number;
    /** Log failed attempts only */
    failedAttemptsOnly: boolean;
    /** Include tool input in logs (be careful with sensitive data) */
    includeToolInput: boolean;
  };
  bashClassification: {
    /** Enable bash command safety classification */
    enabled: boolean;
    /** Dangerous command patterns that require confirmation */
    dangerousPatterns: string[];
    /** Commands that are always allowed */
    safeCommands: string[];
  };
}

export const securityConfig: SecurityConfig = {
  rateLimiting: {
    maxCallsPerMinute: parseInt(process.env.OUROBOROS_RATE_LIMIT_MAX_CALLS || "100", 10),
    windowMs: parseInt(process.env.OUROBOROS_RATE_LIMIT_WINDOW_MS || "60000", 10),
    perTool: process.env.OUROBOROS_RATE_LIMIT_PER_TOOL !== "false",
    perUser: process.env.OUROBOROS_RATE_LIMIT_PER_USER === "true",
  },
  pathValidation: {
    denyPatterns: (process.env.OUROBOROS_PATH_DENY_PATTERNS || 
      "/etc/passwd,/etc/shadow,/.aws/credentials,/.ssh/id_rsa,/.env,**/secrets/**,**/.git/config"
    ).split(",").map(s => s.trim()),
    enabled: process.env.OUROBOROS_PATH_VALIDATION !== "false",
    safePathPrefixes: (process.env.OUROBOROS_SAFE_PATH_PREFIXES || 
      "/tmp,/var/tmp,./workspace,./projects"
    ).split(",").map(s => s.trim()),
  },
  auditLogging: {
    enabled: process.env.OUROBOROS_AUDIT_LOGGING !== "false",
    retentionDays: parseInt(process.env.OUROBOROS_AUDIT_RETENTION_DAYS || "90", 10),
    failedAttemptsOnly: process.env.OUROBOROS_AUDIT_FAILED_ONLY === "true",
    includeToolInput: process.env.OUROBOROS_AUDIT_INCLUDE_INPUT !== "true", // Default false for security
  },
  bashClassification: {
    enabled: process.env.OUROBOROS_BASH_CLASSIFICATION !== "false",
    dangerousPatterns: [
      "rm -rf",
      "rm -r /",
      "dd if=",
      ":(){:|:&};:", // Fork bomb
      "> /dev/sda",
      "mkfs",
      "chmod -R 777 /",
      "wget.*\\|sh",
      "curl.*\\|sh",
    ],
    safeCommands: [
      "ls",
      "cat",
      "pwd",
      "echo",
      "mkdir",
      "cd",
      "git status",
      "git log",
      "npm install",
      "npm run",
    ],
  },
};

// =============================================================================
// Self-Healing Configuration
// =============================================================================

export interface SelfHealingConfig {
  /** Enable automatic snapshots before tool execution */
  autoSnapshot: boolean;
  /** Maximum number of snapshots to retain */
  maxSnapshots: number;
  /** Enable automatic rollback on repeated failures */
  autoRollback: boolean;
  /** Number of consecutive failures before rollback */
  rollbackThreshold: number;
  /** Snapshot before repair attempt */
  snapshotBeforeRepair: boolean;
  /** Enable git checkpoint as backup */
  gitCheckpointEnabled: boolean;
  /** Auto-cleanup old snapshots older than this (ms) */
  snapshotMaxAgeMs: number | null;
}

export const selfHealingConfig: SelfHealingConfig = {
  autoSnapshot: process.env.OUROBOROS_AUTO_SNAPSHOT !== "false",
  maxSnapshots: parseInt(process.env.OUROBOROS_MAX_SNAPSHOTS || "50", 10),
  autoRollback: process.env.OUROBOROS_AUTO_ROLLBACK !== "false",
  rollbackThreshold: parseInt(process.env.OUROBOROS_ROLLBACK_THRESHOLD || "5", 10),
  snapshotBeforeRepair: process.env.OUROBOROS_SNAPSHOT_BEFORE_REPAIR !== "false",
  gitCheckpointEnabled: process.env.OUROBOROS_GIT_CHECKPOINT !== "false",
  snapshotMaxAgeMs: process.env.OUROBOROS_SNAPSHOT_MAX_AGE_MS 
    ? parseInt(process.env.OUROBOROS_SNAPSHOT_MAX_AGE_MS, 10) 
    : 7 * 24 * 60 * 60 * 1000, // 7 days default
};

// =============================================================================
// Skill Version Control Configuration
// =============================================================================

export interface SkillVersioningConfig {
  /** Enable automatic version snapshots on skill changes */
  autoSnapshot: boolean;
  /** Maximum versions to retain per skill */
  maxVersionsPerSkill: number;
  /** Maximum age of retained versions (ms) */
  maxVersionAgeMs: number | null;
  /** Enable version pruning on startup */
  pruneOnStartup: boolean;
  /** Create backup before applying changes */
  createBackup: boolean;
}

export const skillVersioningConfig: SkillVersioningConfig = {
  autoSnapshot: process.env.OUROBOROS_SKILL_AUTO_SNAPSHOT !== "false",
  maxVersionsPerSkill: parseInt(process.env.OUROBOROS_MAX_SKILL_VERSIONS || "20", 10),
  maxVersionAgeMs: process.env.OUROBOROS_SKILL_VERSION_AGE_MS
    ? parseInt(process.env.OUROBOROS_SKILL_VERSION_AGE_MS, 10)
    : 30 * 24 * 60 * 60 * 1000, // 30 days default
  pruneOnStartup: process.env.OUROBOROS_SKILL_PRUNE_ON_STARTUP === "true",
  createBackup: process.env.OUROBOROS_SKILL_CREATE_BACKUP !== "false",
};

// =============================================================================
// Backup Configuration
// =============================================================================

export interface BackupConfig {
  /** Enable automatic backups */
  enabled: boolean;
  /** Maximum backups to retain */
  maxBackups: number;
  /** Maximum age of backups in milliseconds */
  maxAgeMs: number | null;
  /** Backup directory path */
  backupDir: string;
  /** Include skill versions in backups */
  includeSkillVersions: boolean;
  /** Include database in backups */
  includeDatabase: boolean;
}

export const backupConfig: BackupConfig = {
  enabled: process.env.OUROBOROS_BACKUP_ENABLED !== "false",
  maxBackups: parseInt(process.env.OUROBOROS_MAX_BACKUPS || "10", 10),
  maxAgeMs: process.env.OUROBOROS_BACKUP_MAX_AGE_MS
    ? parseInt(process.env.OUROBOROS_BACKUP_MAX_AGE_MS, 10)
    : 30 * 24 * 60 * 60 * 1000, // 30 days default
  backupDir: process.env.OUROBOROS_BACKUP_DIR || ".ouroboros/backups",
  includeSkillVersions: process.env.OUROBOROS_BACKUP_INCLUDE_SKILLS !== "false",
  includeDatabase: process.env.OUROBOROS_BACKUP_INCLUDE_DB !== "false",
};

// =============================================================================
// Combined Extended Config
// =============================================================================

export interface ExtendedConfig {
  tools: ToolExecutionConfig;
  security: SecurityConfig;
  selfHealing: SelfHealingConfig;
  skillVersioning: SkillVersioningConfig;
  backup: BackupConfig;
}

export const extendedConfig: ExtendedConfig = {
  tools: toolExecutionConfig,
  security: securityConfig,
  selfHealing: selfHealingConfig,
  skillVersioning: skillVersioningConfig,
  backup: backupConfig,
};

// =============================================================================
// Environment Variable Reference (for documentation)
// =============================================================================

/**
 * All Ouroboros Agent environment variables:
 * 
 * TOOLS:
 *   OUROBOROS_MAX_CONCURRENCY=10           - Max concurrent tool executions
 *   OUROBOROS_TOOL_TIMEOUT_MS=30000         - Default tool timeout
 *   OUROBOROS_MAX_RETRIES=2                - Max tool retry attempts
 *   OUROBOROS_ENABLE_CASCADE_ABORT=false   - Enable cascade abort on errors
 *   OUROBOROS_ENABLE_SIBLING_CANCEL=false  - Enable sibling cancellation
 * 
 * SECURITY:
 *   OUROBOROS_RATE_LIMIT_MAX_CALLS=100     - Rate limit max calls per window
 *   OUROBOROS_RATE_LIMIT_WINDOW_MS=60000    - Rate limit window
 *   OUROBOROS_RATE_LIMIT_PER_TOOL=false     - Per-tool rate limiting
 *   OUROBOROS_RATE_LIMIT_PER_USER=true      - Per-user rate limiting
 *   OUROBOROS_PATH_DENY_PATTERNS=...        - Comma-separated denied path patterns
 *   OUROBOROS_PATH_VALIDATION=false         - Enable path validation
 *   OUROBOROS_AUDIT_LOGGING=false           - Enable audit logging
 *   OUROBOROS_AUDIT_RETENTION_DAYS=90       - Audit log retention
 *   OUROBOROS_AUDIT_INCLUDE_INPUT=true      - Include tool input in logs
 * 
 * SELF-HEALING:
 *   OUROBOROS_AUTO_SNAPSHOT=false           - Enable auto snapshots
 *   OUROBOROS_MAX_SNAPSHOTS=50              - Max snapshots to retain
 *   OUROBOROS_AUTO_ROLLBACK=false           - Enable auto rollback
 *   OUROBOROS_ROLLBACK_THRESHOLD=5           - Failures before rollback
 *   OUROBOROS_SNAPSHOT_BEFORE_REPAIR=false   - Snapshot before repair
 *   OUROBOROS_GIT_CHECKPOINT=false          - Enable git checkpoints
 * 
 * SKILL VERSIONING:
 *   OUROBOROS_SKILL_AUTO_SNAPSHOT=false     - Auto snapshot skills
 *   OUROBOROS_MAX_SKILL_VERSIONS=20         - Max versions per skill
 *   OUROBOROS_SKILL_PRUNE_ON_STARTUP=true   - Prune on startup
 * 
 * BACKUP:
 *   OUROBOROS_BACKUP_ENABLED=false          - Enable backups
 *   OUROBOROS_MAX_BACKUPS=10               - Max backups to retain
 *   OUROBOROS_BACKUP_DIR=...               - Backup directory
 */
