import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "http";
import { json, readJsonBody, ReqContext, apiBrowserController 
} from "../shared.ts";

export async function handleBrowser(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Browser API
  // ================================================================
  if (path === "/api/browser/launch" && method === "POST") {
    try {
      await apiBrowserController.launch();
      json(res, 200, { success: true, connected: apiBrowserController.isConnected() }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/browser/close" && method === "POST") {
    try {
      await apiBrowserController.close();
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/browser/page" && method === "POST") {
    try {
      const pageId = await apiBrowserController.newPage();
      json(res, 200, { success: true, data: { pageId } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/browser/navigate" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ pageId: z.string(), url: z.string() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const result = await apiBrowserController.navigate(parsed.data.pageId, parsed.data.url);
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/browser/click" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ pageId: z.string(), selector: z.string() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      await apiBrowserController.click(parsed.data.pageId, parsed.data.selector);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/browser/fill" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ pageId: z.string(), selector: z.string(), text: z.string() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      await apiBrowserController.fill(parsed.data.pageId, parsed.data.selector, parsed.data.text);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/browser/screenshot" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ pageId: z.string(), fullPage: z.boolean().optional() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const filePath = await apiBrowserController.screenshot(parsed.data.pageId, { fullPage: parsed.data.fullPage });
      json(res, 200, { success: true, data: { path: filePath } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (path === "/api/browser/extract" && method === "POST") {
    const parsed = await readJsonBody(req, z.object({ pageId: z.string() }));
    if (!parsed.success) {
      json(res, parsed.status, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const text = await apiBrowserController.evaluate<string>(parsed.data.pageId, "document.body.innerText");
      json(res, 200, { success: true, data: { text } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  return false;
}
