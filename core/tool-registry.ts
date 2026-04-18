/**
 * Core Tool Registry
 * ==================
 * Decouples skill hot-reload notifications from the web-layer runner pool.
 * Skills publish tool reload events here; runner-pool (or any host) subscribes.
 */

import type { Tool } from "../types/index.ts";

type ReloadCallback = (tools: Tool<unknown, unknown, unknown>[]) => void;

const listeners: ReloadCallback[] = [];

export function onToolsReloaded(cb: ReloadCallback): () => void {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function notifyToolsReloaded(tools: Tool<unknown, unknown, unknown>[]): void {
  for (const cb of listeners) {
    try {
      cb(tools);
    } catch {
      // ignore listener errors to keep registry robust
    }
  }
}
