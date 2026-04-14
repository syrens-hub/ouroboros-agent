/**
 * Ouroboros Dreaming Memory Skill
 * ================================
 * Ported from OpenClaw ClaudeFusion.
 *
 * Three-phase memory consolidation:
 * - Light Phase: deduplicate and buffer recent interactions
 * - Deep Phase: weighted scoring promotion to long-term
 * - REM Phase: simple topic extraction and insight generation
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { getDb } from "../../core/db-manager.ts";
import { ok, type Tool } from "../../types/index.ts";

// ============================================================================
// Types
// ============================================================================

export interface DreamingWeights {
  relevance: number;
  frequency: number;
  queryDiversity: number;
  recency: number;
  consolidation: number;
  conceptualRichness: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  context: string;
  type: "interaction" | "fact" | "preference" | "pattern" | "insight";
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  queryDiversity: number;
  relevance: number;
  consolidation: number;
  score?: number;
  phase: "light" | "deep" | "rem" | "promoted";
}

export interface DreamingStats {
  enabled: boolean;
  lightPhaseEntries: number;
  deepPhaseEntries: number;
  promotedEntries: number;
  remBlocks: number;
  lastRun: number | null;
  totalConsolidations: number;
}

export interface DreamingConfig {
  enabled: boolean;
  storagePath: string;
  lightPhase: { maxPendingEntries: number; deduplicationWindow: number };
  deepPhase: { weights: DreamingWeights; promotionThreshold: number };
  remPhase: { topicExtractionCount: number; patternDepth: number };
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_WEIGHTS: DreamingWeights = {
  relevance: 0.3,
  frequency: 0.24,
  queryDiversity: 0.15,
  recency: 0.15,
  consolidation: 0.1,
  conceptualRichness: 0.06,
};

const DEFAULT_CONFIG: DreamingConfig = {
  enabled: false,
  storagePath: "~/.ouroboros/dreaming",
  lightPhase: { maxPendingEntries: 100, deduplicationWindow: 86400000 },
  deepPhase: { weights: DEFAULT_WEIGHTS, promotionThreshold: 0.65 },
  remPhase: { topicExtractionCount: 5, patternDepth: 3 },
};

// ============================================================================
// Row mapping
// ============================================================================

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: String(row.id),
    content: String(row.content),
    context: String(row.context ?? ""),
    type: String(row.type ?? "interaction") as MemoryEntry["type"],
    timestamp: Number(row.timestamp),
    accessCount: Number(row.access_count ?? 0),
    lastAccess: Number(row.last_access ?? row.timestamp ?? 0),
    queryDiversity: Number(row.query_diversity ?? 0),
    relevance: Number(row.relevance ?? 0),
    consolidation: Number(row.consolidation ?? 0),
    score: row.score === null || row.score === undefined ? undefined : Number(row.score),
    phase: String(row.phase ?? "light") as MemoryEntry["phase"],
  };
}

// ============================================================================
// DreamingMemory
// ============================================================================

export class DreamingMemory {
  private config: DreamingConfig;
  private sessionId: string | undefined;
  private totalConsolidations = 0;
  private lastRun: number | null = null;
  private lightPhaseEntries = 0;
  private deepPhaseEntries = 0;
  private promotedEntries = 0;
  private remBlocks = 0;

  constructor(sessionId?: string, config?: Partial<DreamingConfig>) {
    this.sessionId = sessionId;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      deepPhase: {
        ...DEFAULT_CONFIG.deepPhase,
        ...config?.deepPhase,
        weights: {
          ...DEFAULT_CONFIG.deepPhase.weights,
          ...config?.deepPhase?.weights,
        },
      },
      remPhase: {
        ...DEFAULT_CONFIG.remPhase,
        ...config?.remPhase,
      },
    };
    this.refreshCounts();
  }

  enable(): void {
    this.config.enabled = true;
  }

  disable(): void {
    this.config.enabled = false;
  }

  getStatus(): DreamingStats {
    return {
      enabled: this.config.enabled,
      lightPhaseEntries: this.lightPhaseEntries,
      deepPhaseEntries: this.deepPhaseEntries,
      promotedEntries: this.promotedEntries,
      remBlocks: this.remBlocks,
      lastRun: this.lastRun,
      totalConsolidations: this.totalConsolidations,
    };
  }

  addMemoryEntry(content: string, context: string, type: MemoryEntry["type"] = "interaction"): string {
    if (!this.config.enabled) return "";
    const db = getDb();
    const { sql: clause, params } = this.getSessionClause();

    // Deduplication against recent light entries
    const recentRows = db
      .prepare(`SELECT * FROM dreaming_entries WHERE phase = 'light' AND ${clause} ORDER BY timestamp DESC LIMIT 100`)
      .all(...params) as Record<string, unknown>[];

    for (const row of recentRows) {
      const existing = String(row.content);
      if (existing.includes(content) || content.includes(existing)) {
        const id = String(row.id);
        db.prepare(
          `UPDATE dreaming_entries SET access_count = access_count + 1, last_access = ?, consolidation = min(1.0, consolidation + 0.1) WHERE id = ?`
        ).run(Date.now(), id);
        this.refreshCounts();
        return "";
      }
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const relevance = this.calcRelevance(content, context);

    db.prepare(
      `INSERT INTO dreaming_entries (id, session_id, content, context, type, timestamp, access_count, last_access, query_diversity, relevance, consolidation, score, phase)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 0, NULL, 'light')`
    ).run(id, this.sessionId ?? null, content, context, type, now, now, relevance);

    this.lightPhaseEntries++;
    return id;
  }

  runConsolidation(): DreamingStats {
    if (!this.config.enabled) return this.getStatus();
    const db = getDb();
    const now = Date.now();
    const { sql: clause, params } = this.getSessionClause();

    // 1. Light -> Deep
    db.prepare(`UPDATE dreaming_entries SET phase = 'deep' WHERE phase = 'light' AND ${clause}`).run(...params);

    // 2. Deep phase scoring and promotion
    const deepRows = db
      .prepare(`SELECT * FROM dreaming_entries WHERE phase = 'deep' AND ${clause}`)
      .all(...params) as Record<string, unknown>[];

    const { weights, promotionThreshold } = this.config.deepPhase;
    const toPromote: Array<{ id: string; score: number }> = [];

    for (const row of deepRows) {
      const entry = rowToEntry(row);
      const recencyScore = this.calcRecency(entry.lastAccess, now);
      const conceptualRichness = this.calcConceptualRichness(entry.content);
      const frequencyScore = entry.accessCount / 10;
      const score =
        entry.relevance * weights.relevance +
        frequencyScore * weights.frequency +
        entry.queryDiversity * weights.queryDiversity +
        recencyScore * weights.recency +
        entry.consolidation * weights.consolidation +
        conceptualRichness * weights.conceptualRichness;

      db.prepare(`UPDATE dreaming_entries SET score = ? WHERE id = ?`).run(score, entry.id);

      if (score >= promotionThreshold) {
        toPromote.push({ id: entry.id, score });
      }
    }

    toPromote.sort((a, b) => b.score - a.score);
    for (const { id } of toPromote.slice(0, 20)) {
      db.prepare(`UPDATE dreaming_entries SET phase = 'promoted' WHERE id = ?`).run(id);
    }

    // 3. REM phase
    this.runRemPhase(db, now);

    this.lastRun = now;
    this.totalConsolidations++;
    this.refreshCounts();
    return this.getStatus();
  }

  getPromotedMemories(limit?: number): MemoryEntry[] {
    const db = getDb();
    const { sql: clause, params } = this.getSessionClause();
    const sql =
      `SELECT * FROM dreaming_entries WHERE phase IN ('promoted', 'rem') AND ${clause} ORDER BY score DESC, timestamp DESC` +
      (limit !== undefined && limit > 0 ? " LIMIT ?" : "");
    const queryParams = limit !== undefined && limit > 0 ? [...params, limit] : params;
    const rows = db.prepare(sql).all(...queryParams) as Record<string, unknown>[];
    return rows.map(rowToEntry);
  }

  reset(): void {
    const db = getDb();
    const { sql: clause, params } = this.getSessionClause();
    db.prepare(`DELETE FROM dreaming_entries WHERE ${clause}`).run(...params);
    this.refreshCounts();
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private getSessionClause(column = "session_id"): { sql: string; params: unknown[] } {
    if (this.sessionId !== undefined) {
      return { sql: `${column} = ?`, params: [this.sessionId] };
    }
    return { sql: "1 = 1", params: [] };
  }

  private refreshCounts(): void {
    const db = getDb();
    const { sql: clause, params } = this.getSessionClause();

    const light = db.prepare(`SELECT COUNT(*) as c FROM dreaming_entries WHERE phase = 'light' AND ${clause}`).get(...params) as { c: number } | undefined;
    const deep = db.prepare(`SELECT COUNT(*) as c FROM dreaming_entries WHERE phase = 'deep' AND ${clause}`).get(...params) as { c: number } | undefined;
    const promoted = db.prepare(`SELECT COUNT(*) as c FROM dreaming_entries WHERE phase = 'promoted' AND ${clause}`).get(...params) as { c: number } | undefined;
    const rem = db.prepare(`SELECT COUNT(*) as c FROM dreaming_entries WHERE phase = 'rem' AND ${clause}`).get(...params) as { c: number } | undefined;

    this.lightPhaseEntries = Number(light?.c ?? 0);
    this.deepPhaseEntries = Number(deep?.c ?? 0);
    this.promotedEntries = Number(promoted?.c ?? 0);
    this.remBlocks = Number(rem?.c ?? 0);
  }

  private runRemPhase(db: ReturnType<typeof getDb>, now: number): void {
    const { sql: clause, params } = this.getSessionClause();

    const promotedRows = db
      .prepare(`SELECT content FROM dreaming_entries WHERE phase = 'promoted' AND ${clause}`)
      .all(...params) as Array<{ content: string }>;

    const allContent = promotedRows.map((r) => String(r.content)).join(" ");
    const words = allContent
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const freq: Record<string, number> = {};
    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1;
    }

    const topWords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.remPhase.topicExtractionCount)
      .map(([w]) => w);

    for (const word of topWords) {
      const insightId = `rem_${now}_${Math.random().toString(36).slice(2, 9)}`;
      const content = `Insight: "${word}" appears frequently in consolidated memories.`;
      db.prepare(
        `INSERT INTO dreaming_entries (id, session_id, content, context, type, timestamp, access_count, last_access, query_diversity, relevance, consolidation, score, phase)
         VALUES (?, ?, ?, ?, 'insight', ?, 0, ?, 0, 0.8, 1, ?, 'rem')`
      ).run(insightId, this.sessionId ?? null, content, "REM Phase output", now, now, 0.8);
    }
  }

  private calcRelevance(content: string, context: string): number {
    const contentWords = new Set(content.toLowerCase().split(/\s+/));
    const contextWords = new Set(context.toLowerCase().split(/\s+/));
    let overlap = 0;
    for (const word of contentWords) {
      if (contextWords.has(word)) overlap++;
    }
    return overlap / Math.max(contentWords.size, 1);
  }

  private calcRecency(lastAccess: number, now: number): number {
    const age = now - lastAccess;
    const hour = 3600000;
    const day = 86400000;
    if (age < hour) return 1;
    if (age < day) return 0.8;
    if (age < 7 * day) return 0.5;
    if (age < 30 * day) return 0.2;
    return 0;
  }

  private calcConceptualRichness(content: string): number {
    const words = content.toLowerCase().split(/\s+/);
    return Math.min(1, new Set(words).size / Math.max(words.length, 1));
  }
}

// ============================================================================
// Agent Tools
// ============================================================================

const DreamingConsolidateInputSchema = z.object({
  sessionId: z.string().optional(),
});
type DreamingConsolidateInput = z.infer<typeof DreamingConsolidateInputSchema>;

const DreamingAddMemoryInputSchema = z.object({
  sessionId: z.string(),
  content: z.string(),
  context: z.string(),
  type: z.enum(["interaction", "fact", "preference", "pattern", "insight"]).optional(),
});
type DreamingAddMemoryInput = z.infer<typeof DreamingAddMemoryInputSchema>;

export const dreamingConsolidateTool: Tool<DreamingConsolidateInput, DreamingStats> = buildTool<DreamingConsolidateInput, DreamingStats>({
  name: "dreaming_consolidate",
  description: "Run dreaming memory consolidation (light -> deep -> REM) for a session and return current stats.",
  inputSchema: DreamingConsolidateInputSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  checkPermissions: () => ok("allow"),
  async call(input) {
    const memory = new DreamingMemory(input.sessionId);
    memory.enable();
    return memory.runConsolidation();
  },
});

export function createDreamingMemory(sessionId?: string, config?: Partial<DreamingConfig>): DreamingMemory {
  return new DreamingMemory(sessionId, config);
}

export const dreamingAddMemoryTool: Tool<DreamingAddMemoryInput, { id: string }> = buildTool<DreamingAddMemoryInput, { id: string }>({
  name: "dreaming_add_memory",
  description: "Add a memory entry to the dreaming system for a session.",
  inputSchema: DreamingAddMemoryInputSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  checkPermissions: () => ok("allow"),
  async call(input) {
    const memory = new DreamingMemory(input.sessionId);
    memory.enable();
    const id = memory.addMemoryEntry(input.content, input.context, input.type);
    return { id };
  },
});
