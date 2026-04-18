/**
 * Context Injection Utilities
 * ===========================
 * Active memory and knowledge-base injection helpers for the agent loop.
 */

import { createHash } from "crypto";
import type { InjectionItem } from "../context-management/index.ts";

export function simpleHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

export function adaptiveMemoryBudget(contextBudget: number): { topK: number; maxTokens: number } {
  if (contextBudget < 4000) return { topK: 1, maxTokens: 256 };
  if (contextBudget < 8000) return { topK: 3, maxTokens: 512 };
  return { topK: 5, maxTokens: 1024 };
}

export function estimateInjectionTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 2 + rest / 4);
}

export interface MemoryHit {
  id: string;
  content: string;
  tokenCount: number;
  priority: number;
  point: "system";
  maxFrequency: number;
}

export function buildMemoryLayerInjection(
  hits: { layer: string; summary: string | null; content: string }[]
): InjectionItem {
  const content = "Relevant historical memory:\n" +
    hits.map((r, i) => `${i + 1}. [${r.layer}] ${r.summary || r.content.slice(0, 200)}`).join("\n---\n");
  return {
    id: `memory-layers-${simpleHash(content)}`,
    content,
    tokenCount: estimateInjectionTokens(content),
    priority: 0.7,
    enabled: true,
    point: "system",
    maxFrequency: 1,
  };
}

export function buildKbInjection(
  hits: { content: string }[]
): InjectionItem {
  const content = "Relevant knowledge base context:\n" +
    hits.map((r, i) => `${i + 1}. ${r.content}`).join("\n---\n");
  return {
    id: `kb-context-${simpleHash(content)}`,
    content,
    tokenCount: estimateInjectionTokens(content),
    priority: 0.6,
    enabled: true,
    point: "system",
    maxFrequency: 1,
  };
}
