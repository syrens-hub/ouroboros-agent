import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import type { ToolCallContext } from "../../../types/index.ts";
import { discoverSkills, installSkillTool, llmCfg, globalPool } from "../../runner-pool.ts";
import {
  json,
  readBody,
  parseBody,
  getCached,
  InstallSkillBodySchema,
  ReqContext,
} from "../shared.ts";

export async function handleSkills(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // Skills list
  if (path === "/api/skills" && method === "GET") {
    const skills = getCached("skills:list", 10_000, () =>
      discoverSkills().map((s) => ({
        name: s.name,
        description: s.frontmatter.description,
        version: s.frontmatter.version,
        tags: s.frontmatter.tags || [],
        hasCode: (s.sourceCodeFiles?.size ?? 0) > 0,
      }))
    );
    json(res, 200, { success: true, data: skills }, ctx);
    return true;
  }

  // Generate skill code
  if (path === "/api/skills/generate" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, z.object({ skill_name: z.string(), description: z.string(), problem_statement: z.string().optional(), example_usage: z.string().optional(), force: z.boolean().default(false) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    if (!llmCfg) {
      json(res, 200, { success: false, error: { message: "LLM not configured" } }, ctx);
      return true;
    }
    try {
      const { generateSkillPackage } = await import("../../../skills/skill-factory/index.ts");
      const result = await generateSkillPackage(
        {
          skill_name: parsed.data.skill_name,
          description: parsed.data.description,
          problem_statement: parsed.data.problem_statement || `Auto-generate executable code for skill ${parsed.data.skill_name}`,
          example_usage: parsed.data.example_usage,
        },
        {
          llmCfg,
          existingTools: globalPool.all(),
          force: parsed.data.force,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onToolsLoaded: (tools: any[]) => {
            for (const tool of tools) {
              if (globalPool.reload(tool.name, tool)) {
                // reloaded
              } else {
                globalPool.register(tool);
              }
            }
          },
        }
      );
      if (!result.success) {
        json(res, 200, { success: false, error: { message: result.error.message } }, ctx);
        return true;
      }
      json(res, 200, { success: true, data: result.data }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // Install skill
  if (path === "/api/skills/install" && method === "POST") {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large" } }, ctx);
        return true;
      }
      throw e;
    }
    const parsed = parseBody(body, InstallSkillBodySchema);
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const result = await installSkillTool.call(
        { source: parsed.data.source },
        { taskId: "web", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({ success: true })) as unknown as ToolCallContext<unknown>["invokeSubagent"] }
      );
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
