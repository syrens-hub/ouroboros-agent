/**
 * Web route constants
 */

export const PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

// Timeouts (ms)
export const LLM_TIMEOUT_MS = 120_000;
export const LLM_RESILIENCE_TIMEOUT_MS = 10_000;
export const WORKER_TIMEOUT_MS = 60_000;
export const WS_PING_INTERVAL_MS = 30_000;
export const WS_PONG_TIMEOUT_MS = 60_000;
export const CODE_EXEC_TIMEOUT_MS = 10_000;
export const CONFIRM_TIMEOUT_MS = 60_000;
export const SHUTDOWN_FORCE_EXIT_MS = 10_000;
export const SERVER_TIMEOUT_MS = 120_000;
export const SERVER_KEEP_ALIVE_TIMEOUT_MS = 30_000;
export const SERVER_HEADERS_TIMEOUT_MS = 60_000;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 60;
export const UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000;
export const UPLOAD_RATE_LIMIT_MAX_REQUESTS = 10;
export const BROWSER_VISION_TIMEOUT_MS = 30_000;
export const MARKETPLACE_CLONE_TIMEOUT_MS = 60_000;

// Cache limits
export const MAX_METRIC_HISTOGRAM_KEYS = 10_000;
export const SKILL_LIST_CACHE_TTL_MS = 10_000;
