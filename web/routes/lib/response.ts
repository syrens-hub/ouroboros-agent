/**
 * Response Helpers
 * ================
 */

import type { ServerResponse } from "http";
import type { ReqContext } from "./context.ts";

export function json(res: ServerResponse, status: number, data: unknown, ctx: ReqContext) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Request-ID": ctx.requestId,
  });
  res.end(JSON.stringify(data));
}

export function notFound(res: ServerResponse, ctx: ReqContext) {
  json(res, 404, { success: false, error: { message: "Not found" } }, ctx);
}
