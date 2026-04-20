import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext } from "../shared.ts";
import { getEnabledBridges, searchAllBridges, listAllBridges } from "../../../skills/bridge-common/manager.ts";
import { listCommits, readCommit, searchCommits, getEvolutionTrends, explainCommit } from "../../../skills/bridge-git/index.ts";
import { listNotes, readNote, writeNote, searchNotes, ingestToKnowledgeGraph } from "../../../skills/bridge-obsidian/index.ts";
import { listPages, readPage, searchPages } from "../../../skills/bridge-notion/index.ts";

export async function handleBridges(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Bridge Registry
  // ================================================================
  if (path === "/api/bridges" && method === "GET") {
    const enabled = getEnabledBridges().map((b) => b.name);
    json(res, 200, { success: true, data: { enabled } }, ctx);
    return true;
  }

  if (path === "/api/bridges/search" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const query = q.searchParams.get("q") || "";
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const result = await searchAllBridges(query, limit);
    json(res, 200, { success: true, data: result }, ctx);
    return true;
  }

  if (path === "/api/bridges/items" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const result = await listAllBridges(limit);
    json(res, 200, { success: true, data: result }, ctx);
    return true;
  }

  // ================================================================
  // Git Bridge API
  // ================================================================
  if (path === "/api/bridges/git/commits" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const commits = listCommits(limit);
    json(res, 200, { success: true, data: commits }, ctx);
    return true;
  }

  const gitCommitMatch = path.match(/^\/api\/bridges\/git\/commits\/([^/]+)$/);
  if (gitCommitMatch && method === "GET") {
    const commit = readCommit(gitCommitMatch[1]);
    if (!commit) { json(res, 404, { success: false, error: { message: "Commit not found" } }, ctx); return true; }
    json(res, 200, { success: true, data: commit }, ctx);
    return true;
  }

  if (path === "/api/bridges/git/search" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const query = q.searchParams.get("q") || "";
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const result = searchCommits(query, limit);
    json(res, 200, { success: true, data: result }, ctx);
    return true;
  }

  if (path === "/api/bridges/git/trends" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const days = q.searchParams.has("days") ? parseInt(q.searchParams.get("days")!, 10) : 30;
    const trends = getEvolutionTrends(days);
    json(res, 200, { success: true, data: trends }, ctx);
    return true;
  }

  if (gitCommitMatch && path.endsWith("/explain") && method === "GET") {
    const explanation = explainCommit(gitCommitMatch[1]);
    json(res, 200, { success: true, data: explanation }, ctx);
    return true;
  }

  // ================================================================
  // Obsidian Bridge API
  // ================================================================
  if (path === "/api/bridges/obsidian/notes" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    const notes = listNotes(limit);
    json(res, 200, { success: true, data: notes }, ctx);
    return true;
  }

  if (path === "/api/bridges/obsidian/notes" && method === "POST") {
    const raw = await new Promise<string>((resolve, reject) => {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
    const parsed = JSON.parse(raw);
    const result = writeNote(parsed.path, parsed.title, parsed.content, parsed.tags || []);
    json(res, result.success ? 200 : 400, { success: result.success, data: result.id, error: result.error ? { message: result.error } : undefined }, ctx);
    return true;
  }

  const obsidianNoteMatch = path.match(/^\/api\/bridges\/obsidian\/notes\/(.+)$/);
  if (obsidianNoteMatch && method === "GET") {
    const note = readNote(decodeURIComponent(obsidianNoteMatch[1]));
    if (!note) { json(res, 404, { success: false, error: { message: "Note not found" } }, ctx); return true; }
    json(res, 200, { success: true, data: note }, ctx);
    return true;
  }

  if (path === "/api/bridges/obsidian/search" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const query = q.searchParams.get("q") || "";
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const result = searchNotes(query, limit);
    json(res, 200, { success: true, data: result }, ctx);
    return true;
  }

  if (path === "/api/bridges/obsidian/ingest" && method === "POST") {
    const result = ingestToKnowledgeGraph();
    json(res, 200, { success: true, data: result }, ctx);
    return true;
  }

  // ================================================================
  // Notion Bridge API
  // ================================================================
  if (path === "/api/bridges/notion/pages" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    const pages = await listPages(limit);
    json(res, 200, { success: true, data: pages }, ctx);
    return true;
  }

  const notionPageMatch = path.match(/^\/api\/bridges\/notion\/pages\/([^/]+)$/);
  if (notionPageMatch && method === "GET") {
    const page = await readPage(notionPageMatch[1]);
    if (!page) { json(res, 404, { success: false, error: { message: "Page not found" } }, ctx); return true; }
    json(res, 200, { success: true, data: page }, ctx);
    return true;
  }

  if (path === "/api/bridges/notion/search" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const query = q.searchParams.get("q") || "";
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 20;
    const result = await searchPages(query, limit);
    json(res, 200, { success: true, data: result }, ctx);
    return true;
  }

  return false;
}
