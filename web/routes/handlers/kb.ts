import { z } from "zod";
import { PAYLOAD_TOO_LARGE } from "../constants.ts";
import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../../core/session-db.ts";
import { KnowledgeBase } from "../../../skills/knowledge-base/index.ts";
import {
  addNode,
  addEdge,
  getNode,
  queryNeighbors,
  findPaths,
  searchNodes,
  visualizeDOT,
  getGraphStats,
  mergeNodes,
  findDuplicateNodes,
} from "../../../skills/engraph/kg-api.ts";
import { retrieveMemory } from "../../../core/memory-tiered.ts";
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

  // ================================================================
  // Knowledge Graph v1.1 API
  // ================================================================
  if (path === "/api/kg/nodes" && method === "POST") {
    const raw = await readBody(req);
    const parsed = parseBody(raw, z.object({ label: z.string(), type: z.enum(["concept", "entity", "event", "document", "skill", "session"]), meta: z.record(z.unknown()).optional() }));
    if (!parsed.success) { json(res, 400, { success: false, error: { message: parsed.error } }, ctx); return true; }
    try {
      const node = addNode(parsed.data.label, parsed.data.type, parsed.data.meta ? { meta: parsed.data.meta } : undefined);
      json(res, 200, { success: true, data: node }, ctx);
    } catch (e) { json(res, 500, { success: false, error: { message: String(e) } }, ctx); }
    return true;
  }

  if (path === "/api/kg/nodes/search" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const query = q.searchParams.get("q") || "";
    const type = q.searchParams.get("type") as import("../../../skills/engraph/kg-api.ts").NodeType | undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const nodes = searchNodes(query, type, limit);
    json(res, 200, { success: true, data: nodes }, ctx);
    return true;
  }

  const kgNodeMatch = path.match(/^\/api\/kg\/nodes\/([^/]+)$/);
  if (kgNodeMatch && method === "GET") {
    const node = getNode(kgNodeMatch[1]);
    if (!node) { json(res, 404, { success: false, error: { message: "Node not found" } }, ctx); return true; }
    json(res, 200, { success: true, data: node }, ctx);
    return true;
  }

  if (path === "/api/kg/edges" && method === "POST") {
    const raw = await readBody(req);
    const parsed = parseBody(raw, z.object({ fromId: z.string(), toId: z.string(), relType: z.enum(["relates_to", "causes", "part_of", "author_of", "uses", "depends_on", "similar_to", "instance_of"]), weight: z.number().optional() }));
    if (!parsed.success) { json(res, 400, { success: false, error: { message: parsed.error } }, ctx); return true; }
    try {
      const edge = addEdge(parsed.data.fromId, parsed.data.toId, parsed.data.relType, parsed.data.weight);
      json(res, 200, { success: true, data: edge }, ctx);
    } catch (e) { json(res, 500, { success: false, error: { message: String(e) } }, ctx); }
    return true;
  }

  if (kgNodeMatch && path.endsWith("/neighbors") && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const depth = q.searchParams.has("depth") ? parseInt(q.searchParams.get("depth")!, 10) : 1;
    const relFilter = q.searchParams.get("rel") as import("../../../skills/engraph/kg-api.ts").RelType | undefined;
    const neighbors = queryNeighbors(kgNodeMatch[1], depth, relFilter ?? undefined);
    json(res, 200, { success: true, data: neighbors }, ctx);
    return true;
  }

  if (path === "/api/kg/paths" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const fromId = q.searchParams.get("from") || "";
    const toId = q.searchParams.get("to") || "";
    const maxDepth = q.searchParams.has("maxDepth") ? parseInt(q.searchParams.get("maxDepth")!, 10) : 4;
    const paths = findPaths(fromId, toId, maxDepth);
    json(res, 200, { success: true, data: paths }, ctx);
    return true;
  }

  if (path === "/api/kg/stats" && method === "GET") {
    const stats = getGraphStats();
    json(res, 200, { success: true, data: stats }, ctx);
    return true;
  }

  if (path === "/api/kg/visualize" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const center = q.searchParams.get("center") ?? undefined;
    const maxDepth = q.searchParams.has("depth") ? parseInt(q.searchParams.get("depth")!, 10) : 2;
    const dot = visualizeDOT(center, maxDepth);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(dot);
    return true;
  }

  if (path === "/api/kg/duplicates" && method === "GET") {
    const dups = findDuplicateNodes();
    json(res, 200, { success: true, data: dups.map((d) => ({ canonical: d.canonical, duplicateIds: d.duplicates.map((x) => x.id) })) }, ctx);
    return true;
  }

  if (path === "/api/kg/merge" && method === "POST") {
    const raw = await readBody(req);
    const parsed = parseBody(raw, z.object({ targetId: z.string(), duplicateIds: z.array(z.string()) }));
    if (!parsed.success) { json(res, 400, { success: false, error: { message: parsed.error } }, ctx); return true; }
    const result = mergeNodes(parsed.data.targetId, parsed.data.duplicateIds);
    json(res, result.success ? 200 : 400, { success: result.success, message: result.message }, ctx);
    return true;
  }

  // ================================================================
  // Tiered Memory API
  // ================================================================
  if (path === "/api/memory/retrieve" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const sessionId = q.searchParams.get("sessionId") || "global";
    const query = q.searchParams.get("q") || "";
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 10;
    const result = retrieveMemory(sessionId, query, limit);
    json(res, 200, { success: true, data: result }, ctx);
    return true;
  }

  return false;
}
