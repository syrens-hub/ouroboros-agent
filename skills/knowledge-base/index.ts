/**
 * Knowledge Base Skill
 * =====================
 * Ingest documents, generate embeddings, and query via vector + keyword hybrid search.
 */

import { getDb } from "../../core/db-manager.ts";
import { processDocument, extractText, type DocumentMetadata } from "./document-processor.ts";
import { EmbeddingService, type EmbeddingConfig } from "./embedding-service.ts";
import { VectorStore } from "./vector-store.ts";
import { buildTool } from "../../core/tool-framework.ts";
import { z } from "zod";
import { ok } from "../../types/index.ts";

export interface KnowledgeBaseConfig {
  embedding: EmbeddingConfig;
  maxDocumentsPerSession?: number;
  maxDocumentsGlobal?: number;
  documentMaxAgeMs?: number;
}

export interface IngestResult {
  success: boolean;
  documentId?: string;
  chunkCount?: number;
  error?: string;
}

export interface QueryResult {
  results: Array<{ content: string; score: number; metadata?: Record<string, unknown> }>;
}

export class KnowledgeBase {
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private config: Required<Pick<KnowledgeBaseConfig, "maxDocumentsPerSession" | "maxDocumentsGlobal" | "documentMaxAgeMs">>;

  constructor(config: KnowledgeBaseConfig) {
    this.embeddingService = new EmbeddingService(config.embedding);
    this.vectorStore = new VectorStore();
    this.config = {
      maxDocumentsPerSession: config.maxDocumentsPerSession ?? 100,
      maxDocumentsGlobal: config.maxDocumentsGlobal ?? 1000,
      documentMaxAgeMs: config.documentMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000,
    };
    this.ensureTables();
  }

  private ensureTables(): void {
    const db = getDb();
    db.prepare(
      `CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        format TEXT NOT NULL,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL
      )`
    ).run();
    db.prepare(
      `CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        created_at INTEGER NOT NULL
      )`
    ).run();
  }

  async ingestDocument(
    sessionId: string,
    filePathOrContent: string,
    options?: { isFile?: boolean; filename?: string; format?: string }
  ): Promise<IngestResult> {
    try {
      const isFile = options?.isFile ?? true;
      const content = isFile ? extractText(filePathOrContent) : filePathOrContent;
      const filename = options?.filename ?? (isFile ? filePathOrContent.split("/").pop() || "document.txt" : "inline.txt");
      const format = options?.format ?? filename.split(".").pop() ?? "txt";

      const { metadata, chunks } = processDocument(content, {
        filename,
        format,
        size: content.length,
        createdAt: Date.now(),
      });

      // Persist document and chunks
      const db = getDb();
      db.prepare(
        `INSERT INTO kb_documents (id, session_id, filename, format, size, hash, created_at, chunk_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(metadata.id, sessionId, metadata.filename, metadata.format, metadata.size, metadata.hash, metadata.createdAt, metadata.chunkCount);

      const insertChunk = db.prepare(
        `INSERT INTO kb_chunks (id, document_id, content, chunk_index, start_line, end_line, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of chunks) {
        insertChunk.run(c.id, c.documentId, c.content, c.chunkIndex, c.metadata.startLine ?? null, c.metadata.endLine ?? null, Date.now());
      }

      // Embed and store vectors
      const texts = chunks.map((c) => c.content);
      const embeddings = await this.embeddingService.embedBatch(texts);
      const now = Date.now();
      for (let i = 0; i < chunks.length; i++) {
        this.vectorStore.add({
          id: chunks[i].id,
          sessionId,
          content: chunks[i].content,
          embedding: embeddings[i].values,
          metadata: { documentId: metadata.id, chunkId: chunks[i].id, chunkIndex: chunks[i].chunkIndex },
          createdAt: now,
        });
      }

      this.cleanupDocuments(sessionId);
      return { success: true, documentId: metadata.id, chunkCount: chunks.length };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private cleanupDocuments(sessionId: string): void {
    const db = getDb();
    const now = Date.now();
    const { maxDocumentsPerSession, maxDocumentsGlobal, documentMaxAgeMs } = this.config;

    // 1) Delete documents older than max age
    const staleDocs = db.prepare(
      `SELECT id, session_id FROM kb_documents WHERE created_at < ?`
    ).all(now - documentMaxAgeMs) as Array<{ id: string; session_id: string }>;
    for (const doc of staleDocs) {
      this.deleteDocument(doc.session_id, doc.id);
    }

    // 2) Enforce per-session limit
    const sessionOverflow = db.prepare(
      `SELECT id FROM kb_documents WHERE session_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?`
    ).all(sessionId, maxDocumentsPerSession) as Array<{ id: string }>;
    for (const doc of sessionOverflow) {
      this.deleteDocument(sessionId, doc.id);
    }

    // 3) Enforce global limit
    const totalCount = (db.prepare(`SELECT COUNT(*) as c FROM kb_documents`).get() as { c: number }).c;
    if (totalCount > maxDocumentsGlobal) {
      const globalOverflow = db.prepare(
        `SELECT id, session_id FROM kb_documents ORDER BY created_at DESC LIMIT -1 OFFSET ?`
      ).all(maxDocumentsGlobal) as Array<{ id: string; session_id: string }>;
      for (const doc of globalOverflow) {
        this.deleteDocument(doc.session_id, doc.id);
      }
    }
  }

  async queryKnowledge(sessionId: string, query: string, topK = 5): Promise<QueryResult> {
    const queryVec = await this.embeddingService.embed(query);
    const vectorResults = this.vectorStore.search(sessionId, queryVec.values, topK);

    // Keyword boost for hybrid search
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const boosted = vectorResults.map((r) => {
      const contentLower = r.entry.content.toLowerCase();
      const keywordHits = keywords.filter((k) => contentLower.includes(k)).length;
      const boostedScore = r.score + keywordHits * 0.02;
      return { ...r, score: Math.min(1, boostedScore) };
    });

    boosted.sort((a, b) => b.score - a.score);
    const results = boosted.slice(0, topK).map((r) => ({
      content: r.entry.content,
      score: r.score,
      metadata: r.entry.metadata,
    }));

    // Track recall for promotion scoring
    try {
      const db = getDb();
      const details = JSON.stringify(
        results.map((r) => ({ chunkId: r.metadata?.chunkId ? String(r.metadata.chunkId) : null, score: r.score }))
      );
      db.prepare(
        `INSERT INTO memory_recalls (session_id, query, source, result_count, top_score, timestamp, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(sessionId, query, "knowledge_base", results.length, results[0]?.score ?? 0, Date.now(), details);
    } catch {
      // non-fatal tracking failure
    }

    return { results };
  }

  listDocuments(sessionId: string): DocumentMetadata[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, filename, format, size, hash, created_at, chunk_count
       FROM kb_documents
       WHERE session_id = ?
       ORDER BY created_at DESC`
    ).all(sessionId) as Array<{
      id: string;
      filename: string;
      format: string;
      size: number;
      hash: string;
      created_at: number;
      chunk_count: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      format: r.format,
      size: r.size,
      hash: r.hash,
      createdAt: r.created_at,
      chunkCount: r.chunk_count,
    }));
  }

  listAllDocuments(): Array<DocumentMetadata & { sessionId: string }> {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, session_id, filename, format, size, hash, created_at, chunk_count
       FROM kb_documents
       ORDER BY created_at DESC`
    ).all() as Array<{
      id: string;
      session_id: string;
      filename: string;
      format: string;
      size: number;
      hash: string;
      created_at: number;
      chunk_count: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      filename: r.filename,
      format: r.format,
      size: r.size,
      hash: r.hash,
      createdAt: r.created_at,
      chunkCount: r.chunk_count,
    }));
  }

  deleteDocument(sessionId: string, documentId: string): boolean {
    const db = getDb();
    // Delete chunks from vector store
    const chunkRows = db.prepare(`SELECT id FROM kb_chunks WHERE document_id = ?`).all(documentId) as Array<{ id: string }>;
    for (const row of chunkRows) {
      this.vectorStore.delete(sessionId, row.id);
    }
    // Delete from relational tables
    db.prepare(`DELETE FROM kb_chunks WHERE document_id = ?`).run(documentId);
    const docResult = db.prepare(`DELETE FROM kb_documents WHERE id = ? AND session_id = ?`).run(documentId, sessionId);
    return (docResult as { changes: number }).changes > 0;
  }
}

export function createKnowledgeBase(config: KnowledgeBaseConfig): KnowledgeBase {
  return new KnowledgeBase(config);
}

export const ingestDocumentTool = buildTool({
  name: "ingest_document",
  description: "Ingest a document (file path or raw text) into the knowledge base for RAG retrieval.",
  inputSchema: z.object({
    sessionId: z.string(),
    source: z.string(),
    isFile: z.boolean().default(true),
    filename: z.string().optional(),
    format: z.string().optional(),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  checkPermissions: () => ok("allow"),
  async call({ sessionId, source, isFile, filename, format }, _ctx) {
    const kb = new KnowledgeBase({ embedding: { provider: "xenova", model: "Xenova/all-MiniLM-L6-v2" } });
    const result = await kb.ingestDocument(sessionId, source, { isFile, filename, format });
    return result.success
      ? { success: true, documentId: result.documentId, chunkCount: result.chunkCount }
      : { success: false, error: result.error };
  },
});

export const queryKnowledgeTool = buildTool({
  name: "query_knowledge",
  description: "Query the knowledge base with a question and retrieve relevant text chunks.",
  inputSchema: z.object({
    sessionId: z.string(),
    query: z.string(),
    topK: z.number().default(5),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  checkPermissions: () => ok("allow"),
  async call({ sessionId, query, topK }, _ctx) {
    const kb = new KnowledgeBase({ embedding: { provider: "xenova", model: "Xenova/all-MiniLM-L6-v2" } });
    const result = await kb.queryKnowledge(sessionId, query, topK);
    return { success: true, results: result.results };
  },
});
