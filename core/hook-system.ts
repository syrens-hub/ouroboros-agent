/**
 * Event Hook System
 * =================
 * A lightweight event-driven system that fires handlers at key lifecycle points.
 * Hooks are discovered from ~/.ouroboros/hooks/ directories, each containing:
 *   - hook.yaml  (metadata: name, description, events list)
 *   - handler.ts (top-level async handle(eventType, context) function)
 *
 * Events:
 *   agent:turnStart, agent:turnEnd, agent:llmCall, agent:toolCall
 *   session:create, session:close
 *   skill:install, skill:execute
 *   checkpoint:create, checkpoint:restore
 *
 * Errors in hooks are caught and logged but never block the main pipeline.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { appConfig } from "./config.ts";
import { logger } from "./logger.ts";

export type HookEventType =
  | "agent:turnStart"
  | "agent:turnEnd"
  | "agent:llmCall"
  | "agent:toolCall"
  | "tool:batchStart"
  | "tool:batchEnd"
  | "tool:progress"
  | "session:create"
  | "session:close"
  | "skill:install"
  | "skill:execute"
  | "checkpoint:create"
  | "checkpoint:restore"
  | "notification"
  | "evolution:proposed"
  | "evolution:executed"
  | "evolution:failed"
  | "evolution:rolledBack"
  | "autonomous:sleep";

export interface HookContext {
  sessionId?: string;
  turn?: number;
  toolName?: string;
  skillName?: string;
  checkpointId?: string;
  latencyMs?: number;
  tokens?: number;
  success?: boolean;
  [key: string]: unknown;
}

type HandlerFn = (eventType: HookEventType, context: HookContext) => Promise<void> | void;

const HOOK_TIMEOUT_MS = 5000;
const HOOKS_DIR = resolve(
  appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir),
  "..",
  "hooks"
);

export class HookRegistry {
  private handlers: Map<HookEventType, HandlerFn[]> = new Map();
  private loadedHooks: Array<{ name: string; events: HookEventType[]; path: string }> = [];

  register(event: HookEventType, handler: HandlerFn): void {
    const list = this.handlers.get(event) || [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  getLoadedHooks() {
    return [...this.loadedHooks];
  }

  getHandlers(event: HookEventType): HandlerFn[] {
    return this.handlers.get(event) || [];
  }

  async emit(event: HookEventType, context: HookContext): Promise<void> {
    const list = this.handlers.get(event) || [];
    for (const handler of list) {
      try {
        let timerId: ReturnType<typeof setTimeout> | undefined;
        let timerRejected = false;
        const timer = new Promise<void>((_, reject) => {
          timerId = setTimeout(() => {
            timerRejected = true;
            reject(new Error("Hook timeout"));
          }, HOOK_TIMEOUT_MS);
        }).catch(() => {
          // Swallow timer rejection when exec wins the race
        });
        const exec = Promise.resolve(handler(event, context));
        const winner = await Promise.race([exec, timer]);
        if (!timerRejected && timerId) clearTimeout(timerId);
        await winner;
      } catch (e) {
        logger.warn("Hook handler failed", { event, error: String(e) });
      }
    }
  }

  registerBuiltins(): void {
    // Built-in audit-log hook
    try {
      // Dynamic import to avoid circular deps
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const auditModule = require("./hooks/audit-log.ts");
      const handler = auditModule?.handle || auditModule?.default;
      if (typeof handler === "function") {
        this.register("agent:turnEnd", handler);
        this.loadedHooks.push({ name: "audit-log", events: ["agent:turnEnd"], path: "(builtin)" });
      }
    } catch (e) {
      logger.warn("Could not load built-in audit-log hook", { error: String(e) });
    }
  }

  discoverAndLoad(customDir?: string): void {
    const dir = customDir ? resolve(customDir) : HOOKS_DIR;
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        return;
      }
    }

    for (const entry of readdirSync(dir)) {
      const hookDir = join(dir, entry);
      const stat = statSync(hookDir);
      if (!stat.isDirectory()) continue;

      const jsonPath = join(hookDir, "hook.json");
      const yamlPath = join(hookDir, "hook.yaml");
      const handlerPath = join(hookDir, "handler.ts");
      if (!existsSync(handlerPath)) continue;

      let manifest: { name?: string; events?: string[] } | undefined;
      try {
        if (existsSync(jsonPath)) {
          manifest = JSON.parse(readFileSync(jsonPath, "utf-8"));
        } else if (existsSync(yamlPath)) {
          logger.warn("YAML hook manifest found but yaml parser not installed; skipping", { path: yamlPath });
          continue;
        } else {
          continue;
        }
      } catch (e) {
        logger.warn("Failed to parse hook manifest", { path: jsonPath || yamlPath, error: String(e) });
        continue;
      }

      if (!manifest || !manifest.events || !Array.isArray(manifest.events)) continue;

      import(handlerPath).then((mod) => {
        const handler = mod?.handle || mod?.default;
        if (typeof handler !== "function") return;
        for (const ev of manifest.events as HookEventType[]) {
          this.register(ev, handler);
        }
        this.loadedHooks.push({
          name: manifest.name || entry,
          events: manifest.events as HookEventType[],
          path: handlerPath,
        });
      }).catch((e) => {
        logger.warn("Failed to load hook handler", { path: handlerPath, error: String(e) });
      });
    }
  }
}

export const hookRegistry = new HookRegistry();
