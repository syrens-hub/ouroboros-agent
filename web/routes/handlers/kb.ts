import { z } from "zod";
import { PAYLOAD_TOO_LARGE } from "../constants.ts";
import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../../core/session-db.ts";
import { KnowledgeBase } from "../../../skills/knowledge-base/index.ts";
import { json, readBody, parseBody, ReqContext 
} from "../shared.ts";

export async function handleKB(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Knowledge Base API
  // ================================================================
  if (path === "/api/kb/ingest" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ sessionId: z.string(), source: z.string(), isFile: z.boolean().default(true), filename: z.string().optional(), format: z.string().optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      const result = await kb.ingestDocument(parsed.data.sessionId, parsed.data.source, {
        isFile: parsed.data.isFile,
        filename: parsed.data.filename,
        format: parsed.data.format,
      });
      json(res, result.success ? 200 : 500, { success: result.success, data: result.success ? { documentId: result.documentId, chunkCount: result.chunkCount } : undefined, error: result.error ? { message: result.error } : undefined }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/kb/query" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ sessionId: z.string(), query: z.string(), topK: z.number().default(5) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      const result = await kb.queryKnowledge(parsed.data.sessionId, parsed.data.query, parsed.data.topK);
      json(res, 200, { success: true, data: result.results }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // ================================================================
  // Knowledge Base Documents API (global list)
  // ================================================================
  if (path === "/api/kb/documents" && method === "GET") {
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      json(res, 200, { success: true, data: kb.listAllDocuments() }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // ================================================================
  // Knowledge Base Stats API
  // ================================================================
  if (path === "/api/kb/stats" && method === "GET") {
    try {
      const db = getDb();
      const docRow = db.prepare("SELECT COUNT(*) as count FROM kb_documents").get() as { count: number } | undefined;
      const chunkRow = db.prepare("SELECT COUNT(*) as count FROM kb_chunks").get() as { count: number } | undefined;
      const scoreRow = db.prepare("SELECT AVG(promotion_score) as avg FROM kb_chunks").get() as { avg: number | null } | undefined;
      json(res, 200, {
        success: true,
        data: {
          totalDocuments: Number(docRow?.count ?? 0),
          totalChunks: Number(chunkRow?.count ?? 0),
          avgPromotionScore: scoreRow?.avg ?? 0,
        },
      }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  const kbDocsMatch = path.match(/^\/api\/kb\/documents\/([^/]+)$/);
  if (kbDocsMatch && method === "GET") {
    const sessionId = kbDocsMatch[1];
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      json(res, 200, { success: true, data: kb.listDocuments(sessionId) }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (kbDocsMatch && method === "DELETE") {
    const sessionId = kbDocsMatch[1];
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === PAYLOAD_TOO_LARGE) {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ documentId: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      const ok = kb.deleteDocument(sessionId, parsed.data.documentId);
      json(res, ok ? 200 : 404, { success: ok, error: ok ? undefined : { message: "Document not found" } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
