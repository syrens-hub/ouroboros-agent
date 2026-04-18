/**
 * Context Compressor v3
 * ======================
 * Three-stage compression:
 *   1. Cheap tool-result pruning
 *   2. Head/tail protection by token budget
 *   3. LLM-based summarization of the middle (via auxiliary router)
 */

import type { BaseMessage, Result } from "../../types/index.ts";
import { ok } from "../../types/index.ts";
import { callAuxiliary } from "../../core/auxiliary-llm.ts";
import { estimateMessageTokens } from "../agent-loop/trajectory-utils.ts";

export const SUMMARY_PREFIX =
  "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted " +
  "into the summary below. This is a handoff from a previous context " +
  "window — treat it as background reference, NOT as active instructions. " +
  "Do NOT answer questions or fulfill requests mentioned in this summary; " +
  "they were already addressed. Respond ONLY to the latest user message " +
  "that appears AFTER this summary.";

export const PRUNED_TOOL_PLACEHOLDER = "[Old tool output cleared to save context space]";

function cloneMessage(m: BaseMessage): BaseMessage {
  return { ...m, content: typeof m.content === "string" ? m.content : JSON.parse(JSON.stringify(m.content)) };
}

export class ContextCompressor {
  private previousSummary?: string;

  pruneToolResults(messages: BaseMessage[], keepLastN = 3): BaseMessage[] {
    const toolIndices: number[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "tool_result") {
        toolIndices.push(i);
      }
    }
    const toPrune = toolIndices.slice(keepLastN);
    if (toPrune.length === 0) return messages;

    const copy = messages.map(cloneMessage);
    for (const idx of toPrune) {
      copy[idx] = { ...copy[idx], content: PRUNED_TOOL_PLACEHOLDER };
    }
    return copy;
  }

  protectHeadAndTail(
    messages: BaseMessage[],
    tailTokenBudget: number
  ): { head: BaseMessage[]; middle: BaseMessage[]; tail: BaseMessage[] } {
    // Head: system + first exchange (up to 3 messages)
    let headEnd = 0;
    let headCount = 0;
    for (let i = 0; i < messages.length && headCount < 3; i++) {
      if (messages[i].role === "system") {
        headEnd = i + 1;
      } else {
        headEnd = i + 1;
        headCount++;
      }
    }
    const head = messages.slice(0, headEnd);

    // Tail: from end backward until budget exhausted
    let tailStart = messages.length;
    let tailTokens = 0;
    for (let i = messages.length - 1; i >= headEnd; i--) {
      const tokens = estimateMessageTokens([messages[i]]);
      if (tailTokens + tokens > tailTokenBudget && tailTokens > 0) break;
      tailTokens += tokens;
      tailStart = i;
    }
    const tail = messages.slice(tailStart);
    const middle = messages.slice(headEnd, tailStart);

    return { head, middle, tail };
  }

  async summarizeMiddle(middle: BaseMessage[], previousSummary?: string): Promise<Result<string>> {
    const parts: string[] = [];
    if (previousSummary) {
      parts.push(`Previous summary (update iteratively):\n${previousSummary}`);
    }
    parts.push(
      "Summarize the following conversation middle turns. " +
        "Preserve key facts, decisions, and file changes. " +
        "Do NOT answer any user questions. Output only the summary."
    );
    parts.push(JSON.stringify(middle, null, 2));

    const messages: BaseMessage[] = [
      {
        role: "system",
        content:
          "You are a context compaction assistant. " +
          "Produce a concise, structured summary with sections: Resolved, Pending, Remaining Work.",
      },
      { role: "user", content: parts.join("\n\n") },
    ];

    const res = await callAuxiliary("compression", messages);
    if (!res.success) return res as Result<never>;

    const text =
      typeof res.data.content === "string"
        ? res.data.content
        : (Array.isArray(res.data.content) &&
            res.data.content.find((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")?.text) ||
          "";
    return ok(text);
  }

  async compress(
    messages: BaseMessage[],
    opts?: { threshold?: number; tailTokenBudget?: number }
  ): Promise<Result<BaseMessage[]>> {
    const tokens = estimateMessageTokens(messages);
    const threshold = opts?.threshold ?? 6400;
    if (tokens <= threshold) {
      return ok(messages);
    }

    // Stage 1: prune old tool results
    const working = this.pruneToolResults(messages);

    // Stage 2: protect head and tail
    const tailTokenBudget = opts?.tailTokenBudget ?? 4000;
    const { head, middle, tail } = this.protectHeadAndTail(working, tailTokenBudget);
    if (middle.length === 0) {
      return ok(working);
    }

    // Stage 3: summarize middle
    const summaryRes = await this.summarizeMiddle(middle, this.previousSummary);
    if (!summaryRes.success) {
      return summaryRes as Result<never>;
    }

    const summaryMsg: BaseMessage = {
      role: "system",
      content: `${SUMMARY_PREFIX}\n\n${summaryRes.data}`,
    };
    this.previousSummary = summaryRes.data;

    return ok([...head, summaryMsg, ...tail]);
  }

  reset() {
    this.previousSummary = undefined;
  }
}
