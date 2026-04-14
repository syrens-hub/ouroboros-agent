/**
 * Context Management Skill
 * ========================
 * Combines pruning and injection to build an optimized message list for the LLM.
 */

import { ContextPruner, type ContextMessage, type PruningConfig } from "./pruner.ts";
import { ContextInjector, type InjectionItem, type InjectionResult } from "./injector.ts";
import type { BaseMessage } from "../../types/index.ts";

export * from "./pruner.ts";
export * from "./injector.ts";

export interface ContextBuildOptions {
  messages: BaseMessage[];
  pruning?: Partial<PruningConfig>;
  injections?: InjectionItem[];
  maxInjectionTokens?: number;
}

export interface ContextBuildResult {
  messages: BaseMessage[];
  pruningStats?: {
    originalCount: number;
    retainedCount: number;
    removedCount: number;
    originalTokens: number;
    retainedTokens: number;
    compressionRatio: number;
  };
  injectionResult?: InjectionResult;
}

export class ContextManager {
  private injector = new ContextInjector();

  /**
   * Build optimized context for LLM call.
   * 1. Prune messages to target token budget.
   * 2. Inject dynamic context items into the system message (or as user messages).
   */
  async buildContext(options: ContextBuildOptions): Promise<ContextBuildResult> {
    const { messages, pruning, injections, maxInjectionTokens = 1024 } = options;

    // Convert BaseMessages to ContextMessages for pruning
    const contextMessages: ContextMessage[] = messages.map((m, idx) => ({
      id: `msg_${idx}`,
      role: m.role as ContextMessage["role"],
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      tokenCount: estimateTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)),
      importanceScore: m.role === "user" ? 0.6 : m.role === "assistant" ? 0.5 : 0.8,
      preserved: m.role === "system",
    }));

    // Step 1: Prune
    const pruneResult = await ContextPruner.prune(contextMessages, pruning);
    const remainingIds = new Set(pruneResult.remainingMessages.map((m) => m.id));
    const prunedMessages = messages.filter((_, idx) => remainingIds.has(`msg_${idx}`));

    // Step 2: Injections
    let injectionResult: InjectionResult | undefined;
    if (injections && injections.length > 0) {
      this.injector.syncInjections(injections);
      injectionResult = this.injector.inject({}, maxInjectionTokens);

      // Merge injected messages: system items first, then prepend non-system items before the last user message
      const systemInjections = injectionResult.messages.filter((m) => m.role === "system");
      const otherInjections = injectionResult.messages.filter((m) => m.role !== "system");

      if (systemInjections.length > 0) {
        // Append to existing system message or create one
        const systemIdx = prunedMessages.findIndex((m) => m.role === "system");
        if (systemIdx >= 0) {
          const existing = prunedMessages[systemIdx];
          const injectedContent = systemInjections.map((m) => m.content).join("\n\n");
          prunedMessages[systemIdx] = {
            ...existing,
            content: `${typeof existing.content === "string" ? existing.content : JSON.stringify(existing.content)}\n\n${injectedContent}`,
          };
        } else {
          prunedMessages.unshift({ role: "system", content: systemInjections.map((m) => m.content).join("\n\n") });
        }
      }

      if (otherInjections.length > 0) {
        // Insert before the last user message, or at the end if no user message
        const lastUserIdx = prunedMessages.findLastIndex((m) => m.role === "user");
        if (lastUserIdx >= 0) {
          prunedMessages.splice(lastUserIdx, 0, ...otherInjections);
        } else {
          prunedMessages.push(...otherInjections);
        }
      }
    }

    return {
      messages: prunedMessages,
      pruningStats: {
        originalCount: contextMessages.length,
        retainedCount: pruneResult.remainingMessages.length,
        removedCount: pruneResult.removedMessages.length,
        originalTokens: contextMessages.reduce((s, m) => s + m.tokenCount, 0),
        retainedTokens: pruneResult.totalTokens,
        compressionRatio: contextMessages.reduce((s, m) => s + m.tokenCount, 0) > 0
          ? (contextMessages.reduce((s, m) => s + m.tokenCount, 0) - pruneResult.totalTokens) / contextMessages.reduce((s, m) => s + m.tokenCount, 0)
          : 0,
      },
      injectionResult,
    };
  }

  getInjector(): ContextInjector {
    return this.injector;
  }

  getPruner(): typeof ContextPruner {
    return ContextPruner;
  }
}

function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const otherChars = text.length - chineseChars - englishWords;
  return Math.ceil(chineseChars / 2) + Math.ceil(englishWords / 4) + Math.ceil(otherChars / 8);
}

export function createContextManager(): ContextManager {
  return new ContextManager();
}
