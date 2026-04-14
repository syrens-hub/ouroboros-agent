import type { IncomingMessage, ServerResponse } from "http";
import { callLLM } from "../../../core/llm-router.ts";
import { llmCfg } from "../../runner-pool.ts";
import { json, ReqContext } from "../shared.ts";

export async function handleLLM(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // LLM Test
  if (path === "/api/llm/test" && method === "POST") {
    if (!llmCfg || !llmCfg.apiKey) {
      json(res, 200, { success: false, error: { message: "LLM not configured. Set LLM_API_KEY and LLM_PROVIDER in .env" } }, ctx);
      return true;
    }
    try {
      const result = await callLLM(llmCfg, [{ role: "user", content: "Say 'PONG' and nothing else." }], []);
      if (!result.success) {
        json(res, 200, { success: false, error: result.error }, ctx);
        return true;
      }
      const text = typeof result.data.content === "string" ? result.data.content : JSON.stringify(result.data.content);
      json(res, 200, { success: true, data: { response: text } }, ctx);
    } catch (e) {
      json(res, 200, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
