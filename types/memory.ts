import { z } from "zod";
import { BaseMessageSchema } from "./messages.ts";
import type { Result } from "./core.ts";

// ============================================================================
// Trajectory & Learning
// ============================================================================

export const TrajectoryEntrySchema = z.object({
  turn: z.number(),
  messages: z.array(BaseMessageSchema),
  toolCalls: z.array(z.unknown()),
  outcome: z.enum(["success", "failure", "cancelled", "compressed"]),
  summary: z.string().optional(),
});
export type TrajectoryEntry = z.infer<typeof TrajectoryEntrySchema>;

export interface TrajectoryCompressor {
  compress(entries: TrajectoryEntry[], targetTokens: number): Promise<Result<TrajectoryEntry[]>>;
}

// ============================================================================
// Vector Memory Types
// ============================================================================

export interface VectorMemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface VectorMemorySearchResult {
  entry: VectorMemoryEntry;
  score: number;
}

export interface VectorMemory {
  add(sessionId: string, content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(sessionId: string, query: string, topK?: number): Promise<VectorMemorySearchResult[]>;
  delete(sessionId: string, id: string): Promise<boolean>;
}
