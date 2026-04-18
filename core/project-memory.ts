/**
 * Ouroboros Project Memory Loader
 * ================================
 * Auto-inject OUROBOROS.md or .ouroboros/prompt.md into the system prompt.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getSessionState } from "./session-state.ts";

const PROJECT_MEMORY_FILES = ["OUROBOROS.md", ".ouroboros/prompt.md"];

export function loadProjectMemorySync(projectRoot: string): string | null {
  for (const filename of PROJECT_MEMORY_FILES) {
    const filepath = join(projectRoot, filename);
    if (existsSync(filepath)) {
      try {
        return readFileSync(filepath, "utf-8");
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function getCachedProjectMemory(sessionId: string, projectRoot: string): string | null {
  const state = getSessionState(sessionId);
  if (state.caches.ouroborosMdContent !== undefined) {
    return state.caches.ouroborosMdContent ?? null;
  }
  const content = loadProjectMemorySync(projectRoot);
  state.caches.ouroborosMdContent = content ?? undefined;
  return content;
}

export function invalidateProjectMemoryCache(sessionId: string): void {
  const state = getSessionState(sessionId);
  state.caches.ouroborosMdContent = undefined;
}
