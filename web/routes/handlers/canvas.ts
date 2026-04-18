import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { CanvasWorkspace } from "../../../skills/canvas/index.ts";
import { json, readJsonBody, ReqContext 
} from "../shared.ts";

export async function handleCanvas(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Canvas API
  // ================================================================
  if (path === "/api/canvas/draw" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({
      width: z.number().optional(),
      height: z.number().optional(),
      commands: z.array(z.object({
        type: z.enum(["rect", "circle", "text", "image"]),
        x: z.number(),
        y: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        text: z.string().optional(),
        fill: z.string().optional(),
        src: z.string().optional(),
      })),
    }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    const workspace = new CanvasWorkspace({ width: parsed.data.width, height: parsed.data.height });
    try {
      const dataUrl = await workspace.draw(parsed.data.commands);
      json(res, 200, { success: true, data: { dataUrl } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/canvas/export" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ width: z.number().optional(), height: z.number().optional() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    const workspace = new CanvasWorkspace({ width: parsed.data.width, height: parsed.data.height });
    try {
      const dataUrl = await workspace.export("png");
      json(res, 200, { success: true, data: { dataUrl } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
