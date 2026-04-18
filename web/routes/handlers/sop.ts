import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { defaultSOPTemplates, run_sop_workflow, type SOPDefinition } from "../../../skills/sop/index.ts";
import { json, readJsonBody, ReqContext 
} from "../shared.ts";

export async function handleSOP(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // SOP API
  // ================================================================
  if (path === "/api/sop/run" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ definition: z.record(z.unknown()), initialState: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const result = await run_sop_workflow.call({ definition: parsed.data.definition as unknown as SOPDefinition, initialState: parsed.data.initialState }, {
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
  if (path === "/api/sop/templates" && method === "GET") {
    json(res, 200, { success: true, data: defaultSOPTemplates }, ctx);
    return true;
  }

  return false;
}
