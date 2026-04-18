import { getDb } from "../../core/db-manager.ts";

export interface AnchorMemory {
  id: string;
  content: string;
  category: "preference" | "value" | "behavior" | "preference";
  importance: number; // 重要性 0-1
  createdAt: number;
  reinforcementCount: number;
  lastAccessedAt: number;
}

export function insertAnchor(
  sessionId: string,
  params: Omit<AnchorMemory, "id" | "createdAt" | "reinforcementCount" | "lastAccessedAt">
): AnchorMemory {
  const db = getDb();
  const id = `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  const stmt = db.prepare(
    `INSERT INTO personality_anchors (id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  void stmt.run(id, sessionId, params.content, params.category, params.importance, now, 1, now);

  return {
    id,
    content: params.content,
    category: params.category,
    importance: params.importance,
    createdAt: now,
    reinforcementCount: 1,
    lastAccessedAt: now,
  };
}

export function reinforceAnchor(sessionId: string, anchorId: string): AnchorMemory | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at
     FROM personality_anchors
     WHERE id = ? AND session_id = ?`
  ).get(anchorId, sessionId) as unknown;

  if (!row) return null;

  const anchor = rowToAnchorMemory(row);
  const newCount = anchor.reinforcementCount + 1;
  const now = Date.now();

  const stmt = db.prepare(
    `UPDATE personality_anchors
     SET reinforcement_count = ?, last_accessed_at = ?
     WHERE id = ? AND session_id = ?`
  );
  void stmt.run(newCount, now, anchorId, sessionId);

  return {
    ...anchor,
    reinforcementCount: newCount,
    lastAccessedAt: now,
  };
}

export function getAnchors(sessionId: string, category?: AnchorMemory["category"]): AnchorMemory[] {
  const db = getDb();
  let rows: unknown[];

  if (category) {
    rows = db.prepare(
      `SELECT id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at
       FROM personality_anchors
       WHERE session_id = ? AND category = ?`
    ).all(sessionId, category) as unknown[];
  } else {
    rows = db.prepare(
      `SELECT id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at
       FROM personality_anchors
       WHERE session_id = ?`
    ).all(sessionId) as unknown[];
  }

  return rows.map((r) => rowToAnchorMemory(r));
}

export function getRelevantAnchors(sessionId: string, query: string, limit = 5): AnchorMemory[] {
  const anchors = getAnchors(sessionId);
  const queryLower = query.toLowerCase();
  return anchors
    .filter((a) => a.content.toLowerCase().includes(queryLower))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}

export function deleteSessionAnchors(sessionId: string): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM personality_anchors WHERE session_id = ?`);
  void stmt.run(sessionId);
}

export function rowToAnchorMemory(row: unknown): AnchorMemory {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    content: String(r.content),
    category: String(r.category) as AnchorMemory["category"],
    importance: Number(r.importance),
    createdAt: Number(r.created_at),
    reinforcementCount: Number(r.reinforcement_count),
    lastAccessedAt: Number(r.last_accessed_at),
  };
}
