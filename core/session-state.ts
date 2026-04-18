/**
 * Ouroboros Session State
 * =======================
 * Centralized per-session state to avoid scattered globals and
 * simplify test isolation.
 */

export interface SessionState {
  tokenCounters: {
    totalInput: number;
    totalOutput: number;
    totalCostUSD: number;
  };
  modelOverrides: {
    mainLoopModel?: string;
  };
  caches: {
    ouroborosMdContent?: string;
  };
  otel: {
    tracer?: unknown;
    meter?: unknown;
    spanMap?: Map<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Session State Map — TTL + LRU + Shutdown Cleanup
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX_ENTRIES = 1000;

interface SessionEntry {
  state: SessionState;
  lastAccessed: number;
}

const _sessionMap = new Map<string, SessionEntry>();
let _sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;

function _getOrCreateEntry(sessionId: string): SessionEntry {
  const now = Date.now();
  let entry = _sessionMap.get(sessionId);
  if (!entry) {
    // Evict oldest if at capacity
    if (_sessionMap.size >= SESSION_MAX_ENTRIES) {
      _evictLRUSession();
    }
    const state: SessionState = {
      tokenCounters: {
        totalInput: 0,
        totalOutput: 0,
        totalCostUSD: 0,
      },
      modelOverrides: {},
      caches: {},
      otel: {},
    };
    entry = { state, lastAccessed: now };
    _sessionMap.set(sessionId, entry);
  } else {
    entry.lastAccessed = now;
  }
  return entry;
}

function _evictLRUSession(): void {
  let oldest: string | undefined;
  let oldestTime = Infinity;
  for (const [id, entry] of _sessionMap) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldest = id;
    }
  }
  if (oldest !== undefined) {
    _sessionMap.delete(oldest);
    console.info(`[SessionStateMap] evicted oldest session id="${oldest}"`);
  }
}

function _cleanupExpiredSessions(): void {
  const now = Date.now();
  let evicted = 0;
  for (const [id, entry] of _sessionMap) {
    if (now - entry.lastAccessed > SESSION_TTL_MS) {
      _sessionMap.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.info(`[SessionStateMap] cleanup evicted ${evicted} expired sessions (remaining=${_sessionMap.size})`);
  }
}

function _ensureCleanupTimer(): void {
  if (_sessionCleanupTimer) return;
  _sessionCleanupTimer = setInterval(_cleanupExpiredSessions, SESSION_TTL_MS);
  if (typeof (_sessionCleanupTimer as unknown as NodeJS.Timeout).unref === "function") {
    (_sessionCleanupTimer as unknown as NodeJS.Timeout).unref();
  }
}

/**
 * Graceful shutdown — clears all sessions and stops the cleanup timer.
 * Call this on process exit.
 */
export function sessionStateShutdown(): void {
  if (_sessionCleanupTimer) {
    clearInterval(_sessionCleanupTimer);
    _sessionCleanupTimer = null;
  }
  _sessionMap.clear();
  console.info("[SessionStateMap] shutdown complete");
}

// Register shutdown handler automatically
if (typeof process !== "undefined") {
  process.on("cleanup", sessionStateShutdown);
  process.on("exit", sessionStateShutdown);
}

export function getSessionState(sessionId: string): SessionState {
  _ensureCleanupTimer();
  return _getOrCreateEntry(sessionId).state;
}

export function clearSessionState(sessionId: string): void {
  _sessionMap.delete(sessionId);
}

export function resetSessionStateForTests(): void {
  _sessionMap.clear();
}
