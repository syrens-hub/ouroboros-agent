import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeBase } from "../../../skills/knowledge-base/index.ts";
import { getDb } from "../../../core/db-manager.ts";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("KnowledgeBase", () => {
  let kb: KnowledgeBase;
  const sessionId = "kb_test_session";

  beforeEach(() => {
    kb = new KnowledgeBase({ embedding: { provider: "local" } });
    const store = (kb as unknown as { vectorStore: { clear: (sid: string) => void } }).vectorStore;
    store.clear(sessionId);
    const db = getDb();
    db.prepare("DELETE FROM kb_documents WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM kb_chunks WHERE document_id IN (SELECT id FROM kb_documents WHERE session_id = ?)").run(sessionId);
  });

  it("ingests a markdown file and queries it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ouroboros-kb-"));
    const filePath = join(dir, "test.md");
    writeFileSync(filePath, "# Project Goals\n\nBuild a self-modifying agent.\n\n## Stack\n\nTypeScript and React.");

    const ingest = await kb.ingestDocument(sessionId, filePath, { isFile: true, filename: "test.md", format: "markdown" });
    expect(ingest.success).toBe(true);
    expect(ingest.chunkCount).toBeGreaterThan(0);

    const query = await kb.queryKnowledge(sessionId, "self-modifying agent", 3);
    expect(query.results.length).toBeGreaterThan(0);
    expect(query.results.some((r) => r.content.includes("self-modifying"))).toBe(true);

    rmSync(dir, { recursive: true });
  });

  it("ingests raw text inline", async () => {
    const ingest = await kb.ingestDocument(sessionId, "The quick brown fox jumps over the lazy dog.", {
      isFile: false,
      filename: "inline.txt",
      format: "txt",
    });
    expect(ingest.success).toBe(true);

    const query = await kb.queryKnowledge(sessionId, "fox", 2);
    expect(query.results.some((r) => r.content.includes("fox"))).toBe(true);
  });

  it("lists and deletes documents", async () => {
    await kb.ingestDocument(sessionId, "Document A content", { isFile: false, filename: "a.txt" });
    await kb.ingestDocument(sessionId, "Document B content", { isFile: false, filename: "b.txt" });

    const docs = kb.listDocuments(sessionId);
    expect(docs.length).toBe(2);

    const deleted = kb.deleteDocument(sessionId, docs[0].id);
    expect(deleted).toBe(true);
    expect(kb.listDocuments(sessionId).length).toBe(1);
  });

  it("auto-cleans up old documents over per-session limit", async () => {
    const cleanupKb = new KnowledgeBase({
      embedding: { provider: "local" },
      maxDocumentsPerSession: 2,
      maxDocumentsGlobal: 100,
      documentMaxAgeMs: 24 * 60 * 60 * 1000,
    });
    const store = (cleanupKb as unknown as { vectorStore: { clear: (sid: string) => void } }).vectorStore;
    store.clear("cleanup_session");
    const db = getDb();
    db.prepare("DELETE FROM kb_documents WHERE session_id = ?").run("cleanup_session");

    await cleanupKb.ingestDocument("cleanup_session", "doc 1", { isFile: false, filename: "1.txt" });
    await cleanupKb.ingestDocument("cleanup_session", "doc 2", { isFile: false, filename: "2.txt" });
    await cleanupKb.ingestDocument("cleanup_session", "doc 3", { isFile: false, filename: "3.txt" });

    const docs = cleanupKb.listDocuments("cleanup_session");
    expect(docs.length).toBeLessThanOrEqual(2);
  });
});
