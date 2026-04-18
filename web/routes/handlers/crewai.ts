import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { runCrewTaskTool, type CrewAgentRole } from "../../../skills/crewai/index.ts";
import { json, readJsonBody, ReqContext 
} from "../shared.ts";

export async function handleCrewAI(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // CrewAI API
  // ================================================================
  if (path === "/api/crew/run" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ task: z.string(), roles: z.array(z.record(z.unknown())), process: z.enum(["sequential", "hierarchical", "parallel"]).optional() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const result = await runCrewTaskTool.call({ task: parsed.data.task, roles: parsed.data.roles as unknown as CrewAgentRole[], process: parsed.data.process }, {
        taskId: "web",
        abortSignal: new AbortController().signal,
        reportProgress: () => {},
        invokeSubagent: async <_I, O>() => ({ success: true } as O),
      });
      json(res, 200, result as unknown, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
