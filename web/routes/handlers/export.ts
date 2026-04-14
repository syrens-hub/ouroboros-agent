import type { IncomingMessage, ServerResponse } from "http";
import { ReqContext } from "../shared.ts";

export async function handleExport(
  _req: IncomingMessage,
  _res: ServerResponse,
  _method: string,
  _path: string,
  _ctx: ReqContext,
): Promise<boolean> {
  return false;
}
