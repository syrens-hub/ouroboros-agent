import { randomBytes } from "crypto";
import type { TaskId } from "../types/index.ts";

/**
 * Generate a random hex task ID (12 chars).
 */
export function generateTaskId(): TaskId {
  return randomBytes(6).toString("hex") as TaskId;
}

/**
 * Create a child AbortController that aborts when the parent aborts.
 */
export function createChildAbortController(parent?: AbortController): AbortController {
  const child = new AbortController();
  if (parent) {
    parent.signal.addEventListener("abort", () => {
      child.abort("parent_aborted");
    });
  }
  return child;
}
