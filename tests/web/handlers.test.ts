import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";

// =============================================================================
// Mocks
// =============================================================================

vi.mock("../../web/routes/shared.ts", () => ({
  json: (res: ServerResponse, status: number, data: unknown, ctx: { requestId: string }) => {
    res.writeHead(status, { "Content-Type": "application/json", "X-Request-ID": ctx.requestId });
    res.end(JSON.stringify(data));
  },
  readBody: vi.fn((req: IncomingMessage & { _body?: string }) => {
    if (req._body === "PAYLOAD_TOO_LARGE") {
      return Promise.reject(new Error("PAYLOAD_TOO_LARGE"));
    }
    return Promise.resolve(req._body || "");
  }),
  parseBody: vi.fn((body: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> }; data?: unknown } }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { success: false, error: "Invalid JSON body" };
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return { success: false, error: result.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") };
    }
    return { success: true, data: result.data };
  }),
  readJsonBody: vi.fn(async (req: IncomingMessage & { _body?: string }, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> }; data?: unknown } }) => {
    let body: string;
    try {
      const readBodyFn = (r: IncomingMessage & { _body?: string }) => {
        if (r._body === "PAYLOAD_TOO_LARGE") {
          return Promise.reject(new Error("PAYLOAD_TOO_LARGE"));
        }
        return Promise.resolve(r._body || "");
      };
      body = await readBodyFn(req);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") {
        return { success: false, error: "Payload too large", status: 413 };
      }
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { success: false, error: "Invalid JSON body", status: 400 };
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return { success: false, error: result.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "), status: 400 };
    }
    return { success: true, data: result.data };
  }),
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  apiBrowserController: {
    launch: vi.fn(() => undefined),
    isConnected: vi.fn(() => true),
    close: vi.fn(() => undefined),
    newPage: vi.fn(() => "page-1"),
    navigate: vi.fn(() => Promise.resolve({ url: "https://example.com", title: "Example" })),
    click: vi.fn(() => Promise.resolve(undefined)),
    fill: vi.fn(() => Promise.resolve(undefined)),
    screenshot: vi.fn(() => Promise.resolve("/path/to.png")),
    evaluate: vi.fn(() => Promise.resolve("extracted text")),
  },
  taskScheduler: {
    getAllTasks: vi.fn(() => [
      { id: "t1", options: { enabled: true } },
      { id: "t2", options: { enabled: false } },
    ]),
    getQueueStats: vi.fn(() => Promise.resolve({ pending: 1, failed: 0 })),
    triggerTask: vi.fn(() => Promise.resolve({ triggered: true })),
    enableTask: vi.fn(() => undefined),
    disableTask: vi.fn(() => undefined),
    deleteTask: vi.fn(() => undefined),
  },
  mediaGenerator: {
    generateImage: vi.fn(() => Promise.resolve({ url: "img.png" })),
    generateVideo: vi.fn(() => Promise.resolve({ url: "vid.mp4" })),
    generateMusic: vi.fn(() => Promise.resolve({ url: "music.mp3" })),
    getTask: vi.fn(() => ({ status: "done" })),
  },
  i18n: {
    getLocale: vi.fn(() => "en"),
    getSupportedLocales: vi.fn(() => ["en", "zh"]),
    setLocale: vi.fn(() => undefined),
  },
  contextManager: (() => {
    const injector = {
      getAllInjections: vi.fn(() => [{ id: "i1" }]),
      addInjection: vi.fn(() => undefined),
    };
    return {
      getInjector: vi.fn(() => injector),
    };
  })(),
  webhookManager: {
    list: vi.fn(() => [{ id: "w1" }]),
    register: vi.fn(() => "w2"),
    unregister: vi.fn(() => undefined),
  },
  selfHealer: {
    getSnapshots: vi.fn(() => [{ id: "s1" }]),
    performRollback: vi.fn(() => Promise.resolve({ success: true, snapshot: { id: "s1" } })),
  },
  learningEngine: {
    patternRecognizer: { patterns: new Map([["p1", { id: "p1" }]]) },
    adaptiveOptimizer: { suggestConfig: vi.fn(() => ({ learningRate: 0.1 })) },
  },
  channelRegistry: {
    bindSession: vi.fn(() => undefined),
    getChannelForSession: vi.fn(() => ({ id: "mock-chat", meta: { name: "MockChat" } })),
  },
}));

vi.mock("../../skills/canvas/index.ts", () => ({
  CanvasWorkspace: vi.fn(() => ({
    draw: vi.fn(() => Promise.resolve("data:image/png;base64,abc")),
    export: vi.fn(() => Promise.resolve("data:image/png;base64,abc")),
  })),
}));

vi.mock("../../skills/crewai/index.ts", () => ({
  runCrewTaskTool: { call: vi.fn(() => Promise.resolve({ success: true, data: { result: "crew-done" } })) },
}));

vi.mock("../../skills/sop/index.ts", () => ({
  defaultSOPTemplates: [{ name: "template1" }],
  run_sop_workflow: { call: vi.fn(() => Promise.resolve({ success: true, data: { result: "sop-done" } })) },
}));

vi.mock("../../skills/personality/index.ts", () => ({
  createPersonalityEvolution: vi.fn(() => ({
    getState: vi.fn(() => ({ traits: ["kind"], values: ["honesty"] })),
    generatePersonalityDescription: vi.fn(() => "A kind soul."),
    getRelevantAnchors: vi.fn(() => [{ content: "anchor1" }]),
    addAnchorMemory: vi.fn(() => undefined),
  })),
  syncSoulMd: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("../../extensions/im/feishu/index.ts", () => ({
  feishuPlugin: { meta: { name: "Feishu" }, isRunning: vi.fn(() => false) },
}));
vi.mock("../../extensions/im/slack/index.ts", () => ({
  slackPlugin: { meta: { name: "Slack" } },
}));
vi.mock("../../extensions/im/dingtalk/index.ts", () => ({
  dingtalkPlugin: { meta: { name: "DingTalk" } },
}));
vi.mock("../../extensions/im/wechatwork/index.ts", () => ({
  wechatworkPlugin: { meta: { name: "WeChatWork" } },
}));
vi.mock("../../extensions/im/telegram/index.ts", () => ({
  telegramPlugin: { meta: { name: "Telegram" } },
}));
vi.mock("../../extensions/im/discord/index.ts", () => ({
  discordPlugin: { meta: { name: "Discord" } },
}));
vi.mock("../../extensions/im/mock-chat/index.ts", () => ({
  mockChatPlugin: { meta: { name: "MockChat" }, isRunning: vi.fn(() => true) },
}));

// =============================================================================
// Helpers
// =============================================================================

function createRes(): ServerResponse & { _status?: number; _data?: string } {
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    writeHead: vi.fn(function (this: typeof res, status: number) {
      res._status = status;
    }),
    end: vi.fn(function (this: typeof res, data: string) {
      res._data = data;
    }),
  } as unknown as ServerResponse & { _status?: number; _data?: string };
  return res;
}

function createReq(body?: string, url: string = "/"): IncomingMessage {
  return { url, _body: body } as unknown as IncomingMessage;
}

function ctx() {
  return { requestId: "r1", startTime: Date.now() };
}

async function importHandlers() {
  const [browser, canvas, tasks, channels, context, webhooks, crewai, selfHealing, sop, misc, personality, learning] = await Promise.all([
    import("../../web/routes/handlers/browser.ts"),
    import("../../web/routes/handlers/canvas.ts"),
    import("../../web/routes/handlers/tasks.ts"),
    import("../../web/routes/handlers/channels.ts"),
    import("../../web/routes/handlers/context.ts"),
    import("../../web/routes/handlers/webhooks.ts"),
    import("../../web/routes/handlers/crewai.ts"),
    import("../../web/routes/handlers/selfHealing.ts"),
    import("../../web/routes/handlers/sop.ts"),
    import("../../web/routes/handlers/misc.ts"),
    import("../../web/routes/handlers/personality.ts"),
    import("../../web/routes/handlers/learning.ts"),
  ]);
  return {
    handleBrowser: browser.handleBrowser,
    handleCanvas: canvas.handleCanvas,
    handleTasks: tasks.handleTasks,
    handleChannels: channels.handleChannels,
    handleContext: context.handleContext,
    handleWebhooks: webhooks.handleWebhooks,
    handleCrewAI: crewai.handleCrewAI,
    handleSelfHealing: selfHealing.handleSelfHealing,
    handleSOP: sop.handleSOP,
    handleMisc: misc.handleMisc,
    handlePersonality: personality.handlePersonality,
    handleLearning: learning.handleLearning,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// Browser
// =============================================================================

describe("handleBrowser", () => {
  it("POST /api/browser/launch", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleBrowser(createReq(), res, "POST", "/api/browser/launch", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.launch).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, connected: true });
  });

  it("POST /api/browser/close", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleBrowser(createReq(), res, "POST", "/api/browser/close", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.close).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });

  it("POST /api/browser/page", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleBrowser(createReq(), res, "POST", "/api/browser/page", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.newPage).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { pageId: "page-1" } });
  });

  it("POST /api/browser/navigate", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ pageId: "p1", url: "https://example.com" });
    const matched = await handleBrowser(createReq(body), res, "POST", "/api/browser/navigate", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.navigate).toHaveBeenCalledWith("p1", "https://example.com");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { url: "https://example.com", title: "Example" } });
  });

  it("POST /api/browser/click", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ pageId: "p1", selector: "#btn" });
    const matched = await handleBrowser(createReq(body), res, "POST", "/api/browser/click", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.click).toHaveBeenCalledWith("p1", "#btn");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });

  it("POST /api/browser/fill", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ pageId: "p1", selector: "#input", text: "hello" });
    const matched = await handleBrowser(createReq(body), res, "POST", "/api/browser/fill", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.fill).toHaveBeenCalledWith("p1", "#input", "hello");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });

  it("POST /api/browser/screenshot", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ pageId: "p1", fullPage: true });
    const matched = await handleBrowser(createReq(body), res, "POST", "/api/browser/screenshot", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.screenshot).toHaveBeenCalledWith("p1", { fullPage: true });
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { path: "/path/to.png" } });
  });

  it("POST /api/browser/extract", async () => {
    const { handleBrowser } = await importHandlers();
    const { apiBrowserController } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ pageId: "p1" });
    const matched = await handleBrowser(createReq(body), res, "POST", "/api/browser/extract", ctx());
    expect(matched).toBe(true);
    expect(apiBrowserController.evaluate).toHaveBeenCalledWith("p1", "document.body.innerText");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { text: "extracted text" } });
  });

  it("returns 400 for invalid navigate body", async () => {
    const { handleBrowser } = await importHandlers();
    const res = createRes();
    const body = JSON.stringify({ pageId: "p1" });
    const matched = await handleBrowser(createReq(body), res, "POST", "/api/browser/navigate", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(false);
    expect(data.error.message).toContain("url");
  });

  it("returns 413 for payload too large", async () => {
    const { handleBrowser } = await importHandlers();
    const res = createRes();
    const matched = await handleBrowser(createReq("PAYLOAD_TOO_LARGE"), res, "POST", "/api/browser/navigate", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(413);
    expect(JSON.parse(res._data!)).toEqual({ success: false, error: { message: "Payload too large" } });
  });

  it("returns false for unmatched paths", async () => {
    const { handleBrowser } = await importHandlers();
    const res = createRes();
    expect(await handleBrowser(createReq(), res, "GET", "/api/browser/launch", ctx())).toBe(false);
    expect(await handleBrowser(createReq(), res, "POST", "/api/browser/unknown", ctx())).toBe(false);
  });
});

// =============================================================================
// Canvas
// =============================================================================

describe("handleCanvas", () => {
  it("POST /api/canvas/draw", async () => {
    const { handleCanvas } = await importHandlers();
    const { CanvasWorkspace } = await import("../../skills/canvas/index.ts");
    const res = createRes();
    const body = JSON.stringify({ commands: [{ type: "rect", x: 0, y: 0 }] });
    const matched = await handleCanvas(createReq(body), res, "POST", "/api/canvas/draw", ctx());
    expect(matched).toBe(true);
    expect(CanvasWorkspace).toHaveBeenCalledWith({ width: undefined, height: undefined });
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { dataUrl: "data:image/png;base64,abc" } });
  });

  it("POST /api/canvas/export", async () => {
    const { handleCanvas } = await importHandlers();
    const { CanvasWorkspace } = await import("../../skills/canvas/index.ts");
    const res = createRes();
    const matched = await handleCanvas(createReq(JSON.stringify({})), res, "POST", "/api/canvas/export", ctx());
    expect(matched).toBe(true);
    expect(CanvasWorkspace).toHaveBeenCalledWith({ width: undefined, height: undefined });
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { dataUrl: "data:image/png;base64,abc" } });
  });

  it("returns 400 for invalid draw body", async () => {
    const { handleCanvas } = await importHandlers();
    const res = createRes();
    const matched = await handleCanvas(createReq(JSON.stringify({})), res, "POST", "/api/canvas/draw", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(false);
    expect(data.error.message).toContain("commands");
  });
});

// =============================================================================
// Tasks
// =============================================================================

describe("handleTasks", () => {
  it("GET /api/tasks", async () => {
    const { handleTasks } = await importHandlers();
    const { taskScheduler } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleTasks(createReq(), res, "GET", "/api/tasks", ctx());
    expect(matched).toBe(true);
    expect(taskScheduler.getAllTasks).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({
      success: true,
      data: [
        { id: "t1", options: { enabled: true } },
        { id: "t2", options: { enabled: false } },
      ],
    });
  });

  it("GET /api/tasks/queue-stats", async () => {
    const { handleTasks } = await importHandlers();
    const { taskScheduler } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleTasks(createReq(), res, "GET", "/api/tasks/queue-stats", ctx());
    expect(matched).toBe(true);
    expect(taskScheduler.getQueueStats).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { pending: 1, failed: 0 } });
  });

  it("POST /api/tasks/:id/trigger", async () => {
    const { handleTasks } = await importHandlers();
    const { taskScheduler } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleTasks(createReq(), res, "POST", "/api/tasks/t1/trigger", ctx());
    expect(matched).toBe(true);
    expect(taskScheduler.triggerTask).toHaveBeenCalledWith("t1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { triggered: true } });
  });

  it("POST /api/tasks/:id/toggle disables enabled task", async () => {
    const { handleTasks } = await importHandlers();
    const { taskScheduler } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleTasks(createReq(), res, "POST", "/api/tasks/t1/toggle", ctx());
    expect(matched).toBe(true);
    expect(taskScheduler.disableTask).toHaveBeenCalledWith("t1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { enabled: false } });
  });

  it("POST /api/tasks/:id/toggle enables disabled task", async () => {
    const { handleTasks } = await importHandlers();
    const { taskScheduler } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleTasks(createReq(), res, "POST", "/api/tasks/t2/toggle", ctx());
    expect(matched).toBe(true);
    expect(taskScheduler.enableTask).toHaveBeenCalledWith("t2");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { enabled: true } });
  });

  it("POST /api/tasks/:id/toggle returns 404 when task not found", async () => {
    const { handleTasks } = await importHandlers();
    const { taskScheduler } = await import("../../web/routes/shared.ts");
    vi.mocked(taskScheduler.getAllTasks).mockReturnValueOnce([{ id: "t1", options: { enabled: true } } as any]);
    const res = createRes();
    const matched = await handleTasks(createReq(), res, "POST", "/api/tasks/unknown/toggle", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(404);
    expect(JSON.parse(res._data!)).toEqual({ success: false, error: { message: "Task not found" } });
  });

  it("DELETE /api/tasks/:id", async () => {
    const { handleTasks } = await importHandlers();
    const { taskScheduler } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleTasks(createReq(), res, "DELETE", "/api/tasks/t1", ctx());
    expect(matched).toBe(true);
    expect(taskScheduler.deleteTask).toHaveBeenCalledWith("t1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });
});

// =============================================================================
// Channels
// =============================================================================

describe("handleChannels", () => {
  it("GET /api/channels", async () => {
    const { handleChannels } = await importHandlers();
    const res = createRes();
    const matched = await handleChannels(createReq(), res, "GET", "/api/channels", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(true);
    expect(data.data).toEqual([
      { id: "feishu", name: "Feishu", running: false },
      { id: "slack", name: "Slack", running: false },
      { id: "dingtalk", name: "DingTalk", running: false },
      { id: "wechatwork", name: "WeChatWork", running: false },
      { id: "telegram", name: "Telegram", running: false },
      { id: "discord", name: "Discord", running: false },
      { id: "mock-chat", name: "MockChat", running: true },
    ]);
  });

  it("POST /api/channels/bind", async () => {
    const { handleChannels } = await importHandlers();
    const { channelRegistry } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ sessionId: "s1", channelId: "feishu" });
    const matched = await handleChannels(createReq(body), res, "POST", "/api/channels/bind", ctx());
    expect(matched).toBe(true);
    expect(channelRegistry.bindSession).toHaveBeenCalledWith("s1", "feishu", undefined);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });

  it("GET /api/channels/session/:id", async () => {
    const { handleChannels } = await importHandlers();
    const { channelRegistry } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleChannels(createReq(), res, "GET", "/api/channels/session/s1", ctx());
    expect(matched).toBe(true);
    expect(channelRegistry.getChannelForSession).toHaveBeenCalledWith("s1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { channelId: "mock-chat", meta: { name: "MockChat" } } });
  });

  it("GET /api/channels/session/:id returns 404 when not bound", async () => {
    const { handleChannels } = await importHandlers();
    const { channelRegistry } = await import("../../web/routes/shared.ts");
    vi.mocked(channelRegistry.getChannelForSession).mockReturnValueOnce(null as any);
    const res = createRes();
    const matched = await handleChannels(createReq(), res, "GET", "/api/channels/session/s1", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(404);
    expect(JSON.parse(res._data!)).toEqual({ success: false, error: { message: "No channel bound" } });
  });

  it("returns 400 for invalid bind body", async () => {
    const { handleChannels } = await importHandlers();
    const res = createRes();
    const matched = await handleChannels(createReq(JSON.stringify({})), res, "POST", "/api/channels/bind", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(false);
    expect(data.error.message).toContain("sessionId");
  });
});

// =============================================================================
// Context
// =============================================================================

describe("handleContext", () => {
  it("GET /api/context/stats", async () => {
    const { handleContext } = await importHandlers();
    const { contextManager } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleContext(createReq(), res, "GET", "/api/context/stats", ctx());
    expect(matched).toBe(true);
    expect(contextManager.getInjector).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { injector: [{ id: "i1" }] } });
  });

  it("GET /api/context/injections", async () => {
    const { handleContext } = await importHandlers();
    const { contextManager } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleContext(createReq(), res, "GET", "/api/context/injections", ctx());
    expect(matched).toBe(true);
    expect(contextManager.getInjector).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: [{ id: "i1" }] });
  });

  it("POST /api/context/injections", async () => {
    const { handleContext } = await importHandlers();
    const { contextManager } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ id: "i2", content: "c", tokenCount: 10, priority: 1, enabled: true, point: "system" });
    const matched = await handleContext(createReq(body), res, "POST", "/api/context/injections", ctx());
    expect(matched).toBe(true);
    expect(contextManager.getInjector().addInjection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "i2", content: "c" })
    );
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });

  it("returns 400 for invalid injection body", async () => {
    const { handleContext } = await importHandlers();
    const res = createRes();
    const matched = await handleContext(createReq(JSON.stringify({ id: "i2" })), res, "POST", "/api/context/injections", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(false);
    expect(data.error.message).toContain("content");
  });
});

// =============================================================================
// Webhooks
// =============================================================================

describe("handleWebhooks", () => {
  it("GET /api/webhooks", async () => {
    const { handleWebhooks } = await importHandlers();
    const { webhookManager } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleWebhooks(createReq(), res, "GET", "/api/webhooks", ctx());
    expect(matched).toBe(true);
    expect(webhookManager.list).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: [{ id: "w1" }] });
  });

  it("POST /api/webhooks", async () => {
    const { handleWebhooks } = await importHandlers();
    const { webhookManager } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ path: "/hook", secret: "s", eventType: "push" });
    const matched = await handleWebhooks(createReq(body), res, "POST", "/api/webhooks", ctx());
    expect(matched).toBe(true);
    expect(webhookManager.register).toHaveBeenCalledWith(expect.objectContaining({ path: "/hook", secret: "s", eventType: "push" }));
    expect(res._status).toBe(200);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe("w2");
  });

  it("DELETE /api/webhooks/:id", async () => {
    const { handleWebhooks } = await importHandlers();
    const { webhookManager } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleWebhooks(createReq(), res, "DELETE", "/api/webhooks/w1", ctx());
    expect(matched).toBe(true);
    expect(webhookManager.unregister).toHaveBeenCalledWith("w1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });
});

// =============================================================================
// CrewAI
// =============================================================================

describe("handleCrewAI", () => {
  it("POST /api/crew/run", async () => {
    const { handleCrewAI } = await importHandlers();
    const { runCrewTaskTool } = await import("../../skills/crewai/index.ts");
    const res = createRes();
    const body = JSON.stringify({ task: "t", roles: [] });
    const matched = await handleCrewAI(createReq(body), res, "POST", "/api/crew/run", ctx());
    expect(matched).toBe(true);
    expect(runCrewTaskTool.call).toHaveBeenCalledWith(
      expect.objectContaining({ task: "t", roles: [] }),
      expect.any(Object)
    );
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { result: "crew-done" } });
  });

  it("returns 400 for invalid crew body", async () => {
    const { handleCrewAI } = await importHandlers();
    const res = createRes();
    const matched = await handleCrewAI(createReq(JSON.stringify({})), res, "POST", "/api/crew/run", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(false);
    expect(data.error.message).toContain("task");
  });
});

// =============================================================================
// SelfHealing
// =============================================================================

describe("handleSelfHealing", () => {
  it("GET /api/self-healing/status", async () => {
    const { handleSelfHealing } = await importHandlers();
    const { selfHealer } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleSelfHealing(createReq(), res, "GET", "/api/self-healing/status", ctx());
    expect(matched).toBe(true);
    expect(selfHealer.getSnapshots).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { active: true, snapshots: 1 } });
  });

  it("GET /api/self-healing/snapshots", async () => {
    const { handleSelfHealing } = await importHandlers();
    const { selfHealer } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleSelfHealing(createReq(), res, "GET", "/api/self-healing/snapshots", ctx());
    expect(matched).toBe(true);
    expect(selfHealer.getSnapshots).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: [{ id: "s1" }] });
  });

  it("POST /api/self-healing/rollback", async () => {
    const { handleSelfHealing } = await importHandlers();
    const { selfHealer } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ rollbackPointId: "r1" });
    const matched = await handleSelfHealing(createReq(body), res, "POST", "/api/self-healing/rollback", ctx());
    expect(matched).toBe(true);
    expect(selfHealer.performRollback).toHaveBeenCalledWith("r1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { id: "s1" } });
  });
});

// =============================================================================
// SOP
// =============================================================================

describe("handleSOP", () => {
  it("GET /api/sop/templates", async () => {
    const { handleSOP } = await importHandlers();
    const res = createRes();
    const matched = await handleSOP(createReq(), res, "GET", "/api/sop/templates", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: [{ name: "template1" }] });
  });

  it("POST /api/sop/run", async () => {
    const { handleSOP } = await importHandlers();
    const { run_sop_workflow } = await import("../../skills/sop/index.ts");
    const res = createRes();
    const body = JSON.stringify({ definition: { name: "sop" } });
    const matched = await handleSOP(createReq(body), res, "POST", "/api/sop/run", ctx());
    expect(matched).toBe(true);
    expect(run_sop_workflow.call).toHaveBeenCalledWith(
      expect.objectContaining({ definition: { name: "sop" } }),
      expect.any(Object)
    );
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { result: "sop-done" } });
  });

  it("returns 400 for invalid sop body", async () => {
    const { handleSOP } = await importHandlers();
    const res = createRes();
    const matched = await handleSOP(createReq(JSON.stringify({})), res, "POST", "/api/sop/run", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(false);
    expect(data.error.message).toContain("definition");
  });
});

// =============================================================================
// Misc
// =============================================================================

describe("handleMisc", () => {
  it("GET /api/providers", async () => {
    const { handleMisc } = await importHandlers();
    const res = createRes();
    const matched = await handleMisc(createReq(), res, "GET", "/api/providers", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(5);
  });

  it("GET /api/locale", async () => {
    const { handleMisc } = await importHandlers();
    const { i18n } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleMisc(createReq(), res, "GET", "/api/locale", ctx());
    expect(matched).toBe(true);
    expect(i18n.getLocale).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { locale: "en", supported: ["en", "zh"] } });
  });

  it("POST /api/locale", async () => {
    const { handleMisc } = await importHandlers();
    const { i18n } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ locale: "zh" });
    const matched = await handleMisc(createReq(body), res, "POST", "/api/locale", ctx());
    expect(matched).toBe(true);
    expect(i18n.setLocale).toHaveBeenCalledWith("zh");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { locale: "en" } });
  });

  it("GET /api/media/tasks/:id", async () => {
    const { handleMisc } = await importHandlers();
    const { mediaGenerator } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleMisc(createReq(), res, "GET", "/api/media/tasks/m1", ctx());
    expect(matched).toBe(true);
    expect(mediaGenerator.getTask).toHaveBeenCalledWith("m1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { status: "done" } });
  });

  it("GET /api/media/tasks/:id returns 404 when not found", async () => {
    const { handleMisc } = await importHandlers();
    const { mediaGenerator } = await import("../../web/routes/shared.ts");
    vi.mocked(mediaGenerator.getTask).mockReturnValueOnce(undefined as any);
    const res = createRes();
    const matched = await handleMisc(createReq(), res, "GET", "/api/media/tasks/m1", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(404);
    expect(JSON.parse(res._data!)).toEqual({ success: false, error: { message: "Task not found" } });
  });

  it("POST /api/media/generate image", async () => {
    const { handleMisc } = await importHandlers();
    const { mediaGenerator } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const body = JSON.stringify({ type: "image", prompt: "cat" });
    const matched = await handleMisc(createReq(body), res, "POST", "/api/media/generate", ctx());
    expect(matched).toBe(true);
    expect(mediaGenerator.generateImage).toHaveBeenCalledWith("cat", undefined);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { url: "img.png" } });
  });
});

// =============================================================================
// Personality
// =============================================================================

describe("handlePersonality", () => {
  it("GET /api/personality/:sessionId", async () => {
    const { handlePersonality } = await importHandlers();
    const { createPersonalityEvolution } = await import("../../skills/personality/index.ts");
    const res = createRes();
    const matched = await handlePersonality(createReq(), res, "GET", "/api/personality/s1", ctx());
    expect(matched).toBe(true);
    expect(createPersonalityEvolution).toHaveBeenCalledWith("s1");
    expect(res._status).toBe(200);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(true);
    expect(data.data.description).toBe("A kind soul.");
    expect(data.data.traits).toEqual(["kind"]);
  });

  it("GET /api/personality/:sessionId/anchors?q=test", async () => {
    const { handlePersonality } = await importHandlers();
    const { createPersonalityEvolution } = await import("../../skills/personality/index.ts");
    const res = createRes();
    const req = createReq("", "/api/personality/s1/anchors?q=test");
    const matched = await handlePersonality(req, res, "GET", "/api/personality/s1/anchors", ctx());
    expect(matched).toBe(true);
    expect(createPersonalityEvolution).toHaveBeenCalledWith("s1");
    expect(res._status).toBe(200);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(true);
    expect(data.data).toEqual([{ content: "anchor1" }]);
  });

  it("POST /api/personality/:sessionId/anchors", async () => {
    const { handlePersonality } = await importHandlers();
    const { createPersonalityEvolution } = await import("../../skills/personality/index.ts");
    const res = createRes();
    const body = JSON.stringify({ content: "c", category: "value", importance: 0.5 });
    const matched = await handlePersonality(createReq(body), res, "POST", "/api/personality/s1/anchors", ctx());
    expect(matched).toBe(true);
    expect(createPersonalityEvolution).toHaveBeenCalledWith("s1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });

  it("POST /api/personality/sync-soul", async () => {
    const { handlePersonality } = await importHandlers();
    const { syncSoulMd } = await import("../../skills/personality/index.ts");
    const res = createRes();
    const body = JSON.stringify({ sessionId: "s1" });
    const matched = await handlePersonality(createReq(body), res, "POST", "/api/personality/sync-soul", ctx());
    expect(matched).toBe(true);
    expect(syncSoulMd).toHaveBeenCalledWith("s1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true });
  });

  it("returns 400 for invalid anchor body", async () => {
    const { handlePersonality } = await importHandlers();
    const res = createRes();
    const matched = await handlePersonality(createReq(JSON.stringify({ content: "c" })), res, "POST", "/api/personality/s1/anchors", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(400);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(false);
    expect(data.error.message).toContain("category");
  });
});

// =============================================================================
// Learning
// =============================================================================

describe("handleLearning", () => {
  it("GET /api/learning/patterns", async () => {
    const { handleLearning } = await importHandlers();
    const res = createRes();
    const matched = await handleLearning(createReq(), res, "GET", "/api/learning/patterns", ctx());
    expect(matched).toBe(true);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._data!);
    expect(data.success).toBe(true);
    expect(data.data.patterns).toEqual([{ id: "p1" }]);
  });

  it("GET /api/learning/config/:sessionId", async () => {
    const { handleLearning } = await importHandlers();
    const { learningEngine } = await import("../../web/routes/shared.ts");
    const res = createRes();
    const matched = await handleLearning(createReq(), res, "GET", "/api/learning/config/s1", ctx());
    expect(matched).toBe(true);
    expect(learningEngine.adaptiveOptimizer.suggestConfig).toHaveBeenCalledWith("s1");
    expect(res._status).toBe(200);
    expect(JSON.parse(res._data!)).toEqual({ success: true, data: { config: { learningRate: 0.1 } } });
  });
});
