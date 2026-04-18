/**
 * Auto-generated OpenAPI documentation based on the global tool pool.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { zodToJsonSchema } from "zod-to-json-schema";
import { globalPool } from "../../runner-pool.ts";
import { json, ReqContext } from "../shared.ts";

let cachedSpec: unknown | null = null;

export function invalidateOpenApiCache(): void {
  cachedSpec = null;
}

function buildOpenApiSpec(): unknown {
  if (cachedSpec) return cachedSpec;

  const paths: Record<string, unknown> = {
    "/api/health": { get: { summary: "Health check", responses: { "200": { description: "Healthy" } } } },
    "/api/ready": { get: { summary: "Readiness probe", responses: { "200": { description: "Ready" } } } },
    "/api/metrics": { get: { summary: "Prometheus metrics", responses: { "200": { description: "Metrics" } } } },
    "/api/status": { get: { summary: "System status", responses: { "200": { description: "Status" } } } },
    "/api/sessions": {
      get: { summary: "List sessions", responses: { "200": { description: "Session list" } } },
      post: { summary: "Create session", responses: { "200": { description: "Created" } } },
    },
    "/api/sessions/{id}/traces": {
      get: {
        summary: "List trace events for a session",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "turn", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "Trace events" } },
      },
    },
    "/api/skills": {
      get: { summary: "List skills", responses: { "200": { description: "Skill list" } } },
    },
    "/api/openapi.json": {
      get: { summary: "OpenAPI specification", responses: { "200": { description: "OpenAPI JSON" } } },
    },
  };

  const schemas: Record<string, unknown> = {};
  const tools = globalPool.all();
  for (const tool of tools) {
    try {
      schemas[tool.name] = zodToJsonSchema(tool.inputSchema as import("zod").ZodTypeAny, {
        name: tool.name,
        $refStrategy: "none",
      });
    } catch {
      schemas[tool.name] = { type: "object" };
    }
  }

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Ouroboros Agent API",
      version: "0.1.0",
      description: "Auto-generated OpenAPI spec from the global tool pool and API handlers.",
    },
    paths,
    components: {
      schemas: {
        ...schemas,
        Result: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "object" },
            error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          },
        },
      },
    },
    tags: [
      { name: "System", description: "Health, metrics, and status" },
      { name: "Sessions", description: "Session management" },
      { name: "Skills", description: "Skill registry and generation" },
      { name: "Tools", description: "Agent tools exposed via the global pool" },
    ],
    "x-tools": tools.map((t) => ({
      name: t.name,
      description: t.description,
      readOnly: t.isReadOnly,
      concurrencySafe: t.isConcurrencySafe === true || typeof t.isConcurrencySafe === "function",
    })),
  };
  cachedSpec = spec;
  return spec;
}

export async function handleOpenApi(
  _req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext
): Promise<boolean> {
  if (path === "/api/openapi.json" && method === "GET") {
    json(res, 200, { success: true, data: buildOpenApiSpec() }, ctx);
    return true;
  }
  return false;
}
