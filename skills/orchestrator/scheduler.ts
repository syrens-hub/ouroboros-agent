/**
 * Agent-Native Task Scheduler
 * ============================
 * Pure rule-based priority evaluation — no LLM required.
 * Determines priority level, target pool, and complexity from task text.
 */

export type TaskPriorityLevel = 1 | 2 | 3 | 4;
export type TaskPoolType = "cpu" | "io" | "llm" | "fallback";

export interface TaskPriorityResult {
  level: TaskPriorityLevel;
  targetPool: TaskPoolType;
  estimatedComplexity: number;
}

// Keyword → weight mapping for pool routing
const POOL_KEYWORDS: Record<TaskPoolType, string[]> = {
  cpu: [
    "compute", "calculation", "parse", "transform", "compile", "lint",
    "analyze code", "static analysis", "type check", "minify", "bundle",
    "search", "grep", "find", "index", "sort", "filter", "deduplicate",
    "format", "generate code", "refactor", "compress",
  ],
  io: [
    "read", "write", "delete", "list", "copy",
    "move", "fetch", "download", "upload", "browser", "screenshot",
    "navigate", "click", "scrape", "crawl", "request", "http", "api call",
    "database", "query", "insert", "update", "migrate", "backup",
    "git", "commit", "push", "pull", "clone", "branch", "file",
  ],
  llm: [
    "summarize", "explain", "translate", "draft", "brainstorm", "review",
    "reason", "plan", "design", "architect", "critique", "evaluate",
    "generate text", "creative", "write", "compose", "narrative",
    "semantic", "intent", "sentiment", "classify", "extract entities",
    "extract", "chat", "conversational", "roleplay", "persona",
  ],
  fallback: [], // default when no strong signal
};

const PRIORITY_KEYWORDS = {
  core: ["security", "auth", "permission", "integrity", "backup", "recovery", "health"],
  evolution: ["evolve", "adapt", "optimize", "tune", "calibrate", "self-improve", "auto-fix"],
  normal: ["implement", "create", "build", "update", "fix", "test", "debug", "deploy"],
  low: ["report", "log", "monitor", "metric", "cleanup", "housekeeping", "telemetry"],
};

function scorePool(taskText: string): { pool: TaskPoolType; score: number }[] {
  const lower = taskText.toLowerCase();
  const scores: { pool: TaskPoolType; score: number }[] = [];

  for (const [pool, keywords] of Object.entries(POOL_KEYWORDS) as [TaskPoolType, string[]][]) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    scores.push({ pool, score });
  }

  return scores.sort((a, b) => b.score - a.score);
}

function scorePriority(taskText: string): number {
  const lower = taskText.toLowerCase();
  let score = 2; // default = normal
  let hasLow = false;

  for (const kw of PRIORITY_KEYWORDS.core) {
    if (lower.includes(kw)) score = Math.max(score, 4);
  }
  for (const kw of PRIORITY_KEYWORDS.evolution) {
    if (lower.includes(kw)) score = Math.max(score, 3);
  }
  for (const kw of PRIORITY_KEYWORDS.normal) {
    if (lower.includes(kw)) score = Math.max(score, 2);
  }
  for (const kw of PRIORITY_KEYWORDS.low) {
    if (lower.includes(kw)) hasLow = true;
  }

  // If only low-priority keywords match, downgrade from default normal
  if (hasLow && score === 2) score = 1;

  return score;
}

function estimateComplexity(taskText: string): number {
  // Heuristic: word count + structural indicators
  const words = taskText.split(/\s+/).length;
  let complexity = Math.min(10, Math.ceil(words / 20));

  const lower = taskText.toLowerCase();
  if (lower.includes("multiple") || lower.includes("batch") || lower.includes("all files")) complexity += 2;
  if (lower.includes("recursive") || lower.includes("deep") || lower.includes("comprehensive")) complexity += 2;
  if (lower.includes("simple") || lower.includes("quick") || lower.includes("brief")) complexity = Math.max(1, complexity - 2);

  return Math.min(10, Math.max(1, complexity));
}

/**
 * Evaluate task priority and pool assignment from natural-language description.
 * Pure function — no side effects, no LLM calls.
 */
export function evaluateTaskPriority(
  taskDescription: string,
  taskName?: string
): TaskPriorityResult {
  const text = `${taskName ?? ""} ${taskDescription}`;
  const poolScores = scorePool(text);
  const bestPool = poolScores[0];

  // Only assign a specific pool if it has a clear signal (score > 0)
  const targetPool: TaskPoolType = bestPool.score > 0 ? bestPool.pool : "fallback";

  const priorityScore = scorePriority(text);
  const level = Math.min(4, Math.max(1, priorityScore)) as TaskPriorityLevel;

  return {
    level,
    targetPool,
    estimatedComplexity: estimateComplexity(taskDescription),
  };
}
