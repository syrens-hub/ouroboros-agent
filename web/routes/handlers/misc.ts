import { z } from "zod";
import { randomUUID } from "crypto";
import { existsSync, writeFileSync, mkdirSync, createReadStream } from "fs";
import { join, extname } from "path";
import type { IncomingMessage, ServerResponse } from "http";
import type { WebhookRegistration } from "../../../core/webhook-manager.ts";
import { defaultSOPTemplates, run_sop_workflow, type SOPDefinition } from "../../../skills/sop/index.ts";
import { runCrewTaskTool, type CrewAgentRole } from "../../../skills/crewai/index.ts";
import { createDreamingMemory } from "../../../skills/dreaming/index.ts";
import { CanvasWorkspace } from "../../../skills/canvas/index.ts";
import { feishuPlugin } from "../../../extensions/im/feishu/index.ts";
import { mockChatPlugin } from "../../../extensions/im/mock-chat/index.ts";
import { telegramPlugin } from "../../../extensions/im/telegram/index.ts";
import { discordPlugin } from "../../../extensions/im/discord/index.ts";
import { slackPlugin } from "../../../extensions/im/slack/index.ts";
import { dingtalkPlugin } from "../../../extensions/im/dingtalk/index.ts";
import { wechatworkPlugin } from "../../../extensions/im/wechatwork/index.ts";
import { KnowledgeBase } from "../../../skills/knowledge-base/index.ts";
import { getDb } from "../../../core/session-db.ts";
import type { Locale } from "../../../core/i18n.ts";
import {
  json,
  readBody,
  parseBody,
  readBodyBuffer,
  parseMultipartFile,
  parseMultipartImage,

  ReqContext,
  mediaGenerator,
  i18n,
  apiBrowserController,
  securityFramework,
  webhookManager,
  learningEngine,
  channelRegistry,
} from "../shared.ts";

export async function handleMisc(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // File Upload API
  // ================================================================
  if (path === "/api/upload" && method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        json(res, 400, { success: false, error: { message: "Expected multipart/form-data" } }, ctx);
        return true;
      }
      const buffer = await readBodyBuffer(req, 5 * 1024 * 1024);
      const parsed = parseMultipartImage(buffer, contentType);
      if (!parsed) {
        json(res, 400, { success: false, error: { message: "No valid image file found" } }, ctx);
        return true;
      }
      const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
      if (!allowed.includes(parsed.mimeType)) {
        json(res, 400, { success: false, error: { message: `Unsupported image type: ${parsed.mimeType}` } }, ctx);
        return true;
      }
      const sessionId = new URL(req.url || "", "http://localhost").searchParams.get("sessionId") || "global";
      const ext = parsed.filename.split(".").pop() || "png";
      const safeName = `${randomUUID()}.${ext}`;
      const uploadDir = join(process.cwd(), ".ouroboros", "uploads", sessionId);
      mkdirSync(uploadDir, { recursive: true });
      const filePath = join(uploadDir, safeName);
      writeFileSync(filePath, parsed.data);
      json(res, 200, {
        success: true,
        data: { url: `/api/uploads/${sessionId}/${safeName}`, name: parsed.filename },
      }, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large (max 5MB)" } }, ctx);
        return true;
      }
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  if (path === "/api/upload/file" && method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        json(res, 400, { success: false, error: { message: "Expected multipart/form-data" } }, ctx);
        return true;
      }
      const buffer = await readBodyBuffer(req, 20 * 1024 * 1024);
      const parsed = parseMultipartFile(buffer, contentType);
      if (!parsed) {
        json(res, 400, { success: false, error: { message: "No valid file found" } }, ctx);
        return true;
      }
      const allowedExts = [".pdf", ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py", ".csv", ".docx", ".xlsx", ".pptx"];
      const ext = extname(parsed.filename).toLowerCase();
      if (!allowedExts.includes(ext)) {
        json(res, 400, { success: false, error: { message: `Unsupported file type: ${ext}` } }, ctx);
        return true;
      }
      const sessionId = new URL(req.url || "", "http://localhost").searchParams.get("sessionId") || "global";
      const safeName = `${randomUUID()}-${parsed.filename}`;
      const uploadDir = join(process.cwd(), ".ouroboros", "uploads", sessionId);
      mkdirSync(uploadDir, { recursive: true });
      const filePath = join(uploadDir, safeName);
      writeFileSync(filePath, parsed.data);
      json(res, 200, {
        success: true,
        data: { url: `/api/uploads/${sessionId}/${safeName}`, name: parsed.filename },
      }, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { success: false, error: { message: "Payload too large (max 20MB)" } }, ctx);
        return true;
      }
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  const uploadMatch = path.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/);
  if (uploadMatch && method === "GET") {
    const [, sessionId, filename] = uploadMatch;
    const filePath = join(process.cwd(), ".ouroboros", "uploads", sessionId, filename);
    if (!existsSync(filePath)) {
      json(res, 404, { success: false, error: { message: "File not found" } }, ctx);
      return true;
    }
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      pdf: "application/pdf",
      txt: "text/plain",
      md: "text/markdown",
      json: "application/json",
      js: "application/javascript",
      ts: "application/typescript",
      jsx: "application/javascript",
      tsx: "application/typescript",
      py: "text/x-python",
      csv: "text/csv",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const mime = mimeMap[ext || ""] || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    createReadStream(filePath).pipe(res);
    return true;
  }

  // ================================================================
  // Multimedia API
  // ================================================================
  if (path === "/api/media/generate" && method === "POST") {
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
    const parsed = parseBody(body, z.object({ type: z.enum(["image", "video", "music"]), prompt: z.string(), options: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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
  // Channels API
  // ================================================================
  if (path === "/api/channels" && method === "GET") {
    const channels = [
      { id: "feishu", ...feishuPlugin.meta, running: feishuPlugin.isRunning() },
      { id: "slack", ...slackPlugin.meta, running: false },
      { id: "dingtalk", ...dingtalkPlugin.meta, running: false },
      { id: "wechatwork", ...wechatworkPlugin.meta, running: false },
      { id: "telegram", ...telegramPlugin.meta, running: false },
      { id: "discord", ...discordPlugin.meta, running: false },
      { id: "mock-chat", ...mockChatPlugin.meta, running: true },
    ];
    json(res, 200, { success: true, data: channels }, ctx);
    return true;
  }

  // ================================================================
  // Channel Registry API
  // ================================================================
  if (path === "/api/channels/bind" && method === "POST") {
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
    const parsed = parseBody(body, z.object({ sessionId: z.string(), channelId: z.string(), config: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      channelRegistry.bindSession(parsed.data.sessionId, parsed.data.channelId, parsed.data.config);
      json(res, 200, { success: true }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  const channelSessionMatch = path.match(/^\/api\/channels\/session\/([^/]+)$/);
  if (channelSessionMatch && method === "GET") {
    const sessionId = channelSessionMatch[1];
    const plugin = channelRegistry.getChannelForSession(sessionId);
    if (!plugin) {
      json(res, 404, { success: false, error: { message: "No channel bound" } }, ctx);
      return true;
    }
    json(res, 200, { success: true, data: { channelId: plugin.id, meta: plugin.meta } }, ctx);
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
    const parsed = parseBody(body, z.object({ locale: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    i18n.setLocale(parsed.data.locale as Locale);
    json(res, 200, { success: true, data: { locale: i18n.getLocale() } }, ctx);
    return true;
  }

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
    const parsed = parseBody(body, z.object({ pageId: z.string(), url: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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
    const parsed = parseBody(body, z.object({ pageId: z.string(), selector: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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
    const parsed = parseBody(body, z.object({ pageId: z.string(), selector: z.string(), text: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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
    const parsed = parseBody(body, z.object({ pageId: z.string(), fullPage: z.boolean().optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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
    const parsed = parseBody(body, z.object({ pageId: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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

  // ================================================================
  // Canvas API
  // ================================================================
  if (path === "/api/canvas/draw" && method === "POST") {
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
    const parsed = parseBody(body, z.object({
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
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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
    const parsed = parseBody(body, z.object({ width: z.number().optional(), height: z.number().optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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

  // ================================================================
  // Dreaming API
  // ================================================================
  const dreamingMatch = path.match(/^\/api\/dreaming\/([^/]+)$/);
  if (dreamingMatch && method === "GET") {
    const sessionId = dreamingMatch[1];
    const dm = createDreamingMemory(sessionId);
    const memories = await dm.getPromotedMemories(50);
    json(res, 200, { success: true, data: memories }, ctx);
    return true;
  }
  const dreamingConsolidateMatch = path.match(/^\/api\/dreaming\/([^/]+)\/consolidate$/);
  if (dreamingConsolidateMatch && method === "POST") {
    const sessionId = dreamingConsolidateMatch[1];
    const dm = createDreamingMemory(sessionId);
    const stats = await dm.runConsolidation();
    json(res, 200, { success: true, data: stats }, ctx);
    return true;
  }

  // ================================================================
  // CrewAI API
  // ================================================================
  if (path === "/api/crew/run" && method === "POST") {
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
    const parsed = parseBody(body, z.object({ task: z.string(), roles: z.array(z.record(z.unknown())), process: z.enum(["sequential", "hierarchical", "parallel"]).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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

  // ================================================================
  // Learning Engine API
  // ================================================================
  if (path === "/api/learning/patterns" && method === "GET") {
    const patterns = Array.from((learningEngine.patternRecognizer as unknown as { patterns?: Map<string, unknown> }).patterns?.values?.() || []).slice(0, 20);
    json(res, 200, { success: true, data: { patterns } }, ctx);
    return true;
  }
  const learningConfigMatch = path.match(/^\/api\/learning\/config\/([^/]+)$/);
  if (learningConfigMatch && method === "GET") {
    const sessionId = learningConfigMatch[1];
    const config = learningEngine.adaptiveOptimizer.suggestConfig(sessionId);
    json(res, 200, { success: true, data: { config } }, ctx);
    return true;
  }

  // ================================================================
  // Knowledge Base Documents API (global list)
  // ================================================================
  if (path === "/api/kb/documents" && method === "GET") {
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      json(res, 200, { success: true, data: kb.listAllDocuments() }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // ================================================================
  // Knowledge Base Stats API
  // ================================================================
  if (path === "/api/kb/stats" && method === "GET") {
    try {
      const db = getDb();
      const docRow = db.prepare("SELECT COUNT(*) as count FROM kb_documents").get() as { count: number } | undefined;
      const chunkRow = db.prepare("SELECT COUNT(*) as count FROM kb_chunks").get() as { count: number } | undefined;
      const scoreRow = db.prepare("SELECT AVG(promotion_score) as avg FROM kb_chunks").get() as { avg: number | null } | undefined;
      json(res, 200, {
        success: true,
        data: {
          totalDocuments: Number(docRow?.count ?? 0),
          totalChunks: Number(chunkRow?.count ?? 0),
          avgPromotionScore: scoreRow?.avg ?? 0,
        },
      }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  const kbDocsMatch = path.match(/^\/api\/kb\/documents\/([^/]+)$/);
  if (kbDocsMatch && method === "GET") {
    const sessionId = kbDocsMatch[1];
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      json(res, 200, { success: true, data: kb.listDocuments(sessionId) }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  if (kbDocsMatch && method === "DELETE") {
    const sessionId = kbDocsMatch[1];
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
    const parsed = parseBody(body, z.object({ documentId: z.string() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const kb = new KnowledgeBase({ embedding: { provider: "local" } });
      const ok = kb.deleteDocument(sessionId, parsed.data.documentId);
      json(res, ok ? 200 : 404, { success: ok, error: ok ? undefined : { message: "Document not found" } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // ================================================================
  // SOP API
  // ================================================================
  if (path === "/api/sop/run" && method === "POST") {
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
    const parsed = parseBody(body, z.object({ definition: z.record(z.unknown()), initialState: z.record(z.unknown()).optional() }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
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

  // ================================================================
  // Security Audit API
  // ================================================================
  if (path === "/api/security/audits" && method === "GET") {
    const q = new URL(req.url || "", "http://localhost");
    const sessionId = q.searchParams.get("sessionId") || undefined;
    const limit = q.searchParams.has("limit") ? parseInt(q.searchParams.get("limit")!, 10) : 50;
    try {
      const audits = securityFramework.securityAuditor.getRecentAudits(sessionId, Number.isFinite(limit) && limit > 0 ? limit : 50);
      json(res, 200, { success: true, data: audits }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }

  // ================================================================
  // Webhook Manager API
  // ================================================================
  if (path === "/api/webhooks" && method === "GET") {
    json(res, 200, { success: true, data: webhookManager.list() }, ctx);
    return true;
  }
  if (path === "/api/webhooks" && method === "POST") {
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
    const parsed = parseBody(body, z.object({ path: z.string(), secret: z.string(), eventType: z.string(), targetSessionId: z.string().optional(), enabled: z.boolean().default(true) }));
    if (!parsed.success) {
      json(res, 400, { success: false, error: { message: parsed.error } }, ctx);
      return true;
    }
    try {
      const webhook: WebhookRegistration = { id: randomUUID(), ...parsed.data, enabled: parsed.data.enabled ?? true };
      const id = webhookManager.register(webhook);
      json(res, 200, { success: true, data: { id } }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  const webhookDeleteMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
  if (webhookDeleteMatch && method === "DELETE") {
    const id = webhookDeleteMatch[1];
    webhookManager.unregister(id);
    json(res, 200, { success: true }, ctx);
    return true;
  }

  return false;
}
