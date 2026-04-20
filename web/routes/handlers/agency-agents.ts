import type { IncomingMessage, ServerResponse } from "http";
import { json, ReqContext } from "../shared.ts";
import {
  getAgentRegistry,
  reloadAgentRegistry,
  buildSystemPrompt,
} from "../../../skills/agency-agents/index.ts";

export async function handleAgencyAgents(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // GET /api/agents — list all agents
  if (path === "/api/agents" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const division = q.searchParams.get("division") || undefined;
    try {
      const registry = getAgentRegistry();
      const agents = division ? registry.listByDivision(division) : registry.listAll();
      json(res, 200, {
        success: true,
        data: agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          division: a.division,
          color: a.color,
          emoji: a.emoji,
          vibe: a.vibe,
        })),
        stats: registry.getStats(),
      }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/agents/divisions — list divisions
  if (path === "/api/agents/divisions" && method === "GET") {
    try {
      const registry = getAgentRegistry();
      json(res, 200, { success: true, data: registry.listDivisions() }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // GET /api/agents/:id — get single agent
  const agentDetailMatch = path.match(/^\/api\/agents\/([^/]+)$/);
  if (agentDetailMatch && method === "GET") {
    const id = decodeURIComponent(agentDetailMatch[1]);
    try {
      const registry = getAgentRegistry();
      const agent = registry.get(id) || registry.getByName(id);
      if (!agent) {
        json(res, 404, { success: false, error: { message: `Agent not found: ${id}` } }, ctx);
        return true;
      }
      json(res, 200, {
        success: true,
        data: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          division: agent.division,
          color: agent.color,
          emoji: agent.emoji,
          vibe: agent.vibe,
          content: agent.content,
        },
      }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // POST /api/agents/search — search agents
  if (path === "/api/agents/search" && method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const { query, division } = body as { query?: string; division?: string };
      if (!query) {
        json(res, 400, { success: false, error: { message: "query is required" } }, ctx);
        return true;
      }
      const registry = getAgentRegistry();
      const results = registry.search(query, division);
      json(res, 200, {
        success: true,
        data: results.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          division: a.division,
          color: a.color,
          emoji: a.emoji,
        })),
      }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // POST /api/agents/match — match agent for task
  if (path === "/api/agents/match" && method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const { taskDescription } = body as { taskDescription?: string };
      if (!taskDescription) {
        json(res, 400, { success: false, error: { message: "taskDescription is required" } }, ctx);
        return true;
      }
      const registry = getAgentRegistry();
      const matched = registry.matchForTask(taskDescription);
      if (!matched) {
        json(res, 404, { success: false, error: { message: "No matching agent found" } }, ctx);
        return true;
      }
      const prompt = buildSystemPrompt(matched);
      json(res, 200, {
        success: true,
        data: {
          agent: {
            id: matched.id,
            name: matched.name,
            description: matched.description,
            division: matched.division,
            color: matched.color,
            emoji: matched.emoji,
          },
          systemPrompt: prompt.content,
        },
      }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // POST /api/agents/reload — reload registry from disk
  if (path === "/api/agents/reload" && method === "POST") {
    try {
      const registry = reloadAgentRegistry();
      json(res, 200, { success: true, data: registry.getStats() }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
