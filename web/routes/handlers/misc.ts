import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import type { Locale } from "../../../skills/i18n/index.ts";
import {
  json,
  readJsonBody,
  ReqContext,
  mediaGenerator,
  i18n,
} from "../shared.ts";

export async function handleMisc(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Multimedia API
  // ================================================================
  if (path === "/api/media/generate" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ type: z.enum(["image", "video", "music"]), prompt: z.string(), options: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      let result;
      if (parsed.data.type === "image") {
        result = await mediaGenerator.generateImage(parsed.data.prompt, parsed.data.options);
      } else if (parsed.data.type === "video") {
        result = await mediaGenerator.generateVideo(parsed.data.prompt, parsed.data.options);
      } else {
        result = await mediaGenerator.generateMusic(parsed.data.prompt, parsed.data.options);
      }
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  const mediaStatusMatch = path.match(/^\/api\/media\/tasks\/([^/]+)$/);
  if (mediaStatusMatch && method === "GET") {
    const taskId = mediaStatusMatch[1];
    const status = mediaGenerator.getTask(taskId);
    if (!status) {
      json(res, 404, { success: false, error: { message: "Task not found" } }, ctx);
      return true;
    }
    json(res, 200, { success: true, data: status }, ctx);
    return true;
  }

  // ================================================================
  // Providers API
  // ================================================================
  if (path === "/api/providers" && method === "GET") {
    const providers = [
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
      { id: "gemini", name: "Google Gemini" },
      { id: "minimax", name: "MiniMax" },
      { id: "qwen", name: "Alibaba Qwen" },
    ];
    json(res, 200, { success: true, data: providers }, ctx);
    return true;
  }

  // ================================================================
  // Locale / i18n API
  // ================================================================
  if (path === "/api/locale" && method === "GET") {
    json(res, 200, { success: true, data: { locale: i18n.getLocale(), supported: i18n.getSupportedLocales() } }, ctx);
    return true;
  }
  if (path === "/api/locale" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ locale: z.string() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    i18n.setLocale(parsed.data.locale as Locale);
    json(res, 200, { success: true, data: { locale: i18n.getLocale() } }, ctx);
    return true;
  }

  return false;
}
