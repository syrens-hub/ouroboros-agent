import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { appConfig } from "../../core/config.ts";
import { buildTool } from "../../core/tool-framework.ts";
import { z } from "zod";

const TEST_DB_DIR = join(process.cwd(), ".ouroboros", "test-agent-loop-" + Date.now());
appConfig.db.dir = TEST_DB_DIR;

import { createAgentLoopRunner, type LLMCaller } from "../../skills/agent-loop/index.ts";
import type { BaseMessage, ToolProgressEvent } from "../../types/index.ts";
import { resetDbSingleton } from "../../core/session-db.ts";

function isBaseMessage(
  ev: BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent
): ev is BaseMessage {
  return "role" in ev;
}

function isToolResult(
  ev: BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent
): ev is { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } {
  return !isBaseMessage(ev) && ev.type === "tool_result";
}


describe("Agent Loop", () => {
  beforeEach(() => {
    resetDbSingleton();
    appConfig.db.dir = join(process.cwd(), ".ouroboros", "test-agent-loop-" + Date.now());
    appConfig.skills.dir = join(process.cwd(), ".ouroboros", "test-skills-" + Date.now());
    if (!existsSync(appConfig.skills.dir)) mkdirSync(appConfig.skills.dir, { recursive: true });
  });

  afterEach(() => {
    try {
      [appConfig.db.dir, appConfig.skills.dir].forEach((dir) => {
        const d = dir.startsWith("/") ? dir : join(process.cwd(), dir);
        if (existsSync(d)) rmSync(d, { recursive: true, force: true });
      });
    } catch {
      // ignore
    }
  });

  it("hello flow returns greeting and stops", async () => {
    const mockCaller: LLMCaller = {
      async call(messages) {
        const last = messages.findLast((m) => m.role === "user")?.content as string;
        if (last.includes("hello")) {
          return { role: "assistant", content: "Hello from mock." };
        }
        return { role: "assistant", content: "?" };
      },
    };

    const runner = createAgentLoopRunner({
      sessionId: "sess_hello",
      tools: [],
      llmCaller: mockCaller,
      enableBackgroundReview: false,
    });

    const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
    for await (const ev of runner.run("hello")) events.push(ev);

    expect(events.length).toBe(1);
    expect("role" in events[0] ? events[0].role : undefined).toBe("assistant");
    expect(isBaseMessage(events[0]) ? events[0].content : undefined).toBe("Hello from mock.");
    expect(runner.getState().status).toBe("idle");
    expect(runner.getState().turnCount).toBe(1);
  });

  it("tool call flow executes mock tool and yields result", async () => {
    const echoTool = buildTool({
      name: "echo",
      description: "echo",
      inputSchema: z.object({ text: z.string() }),
      isReadOnly: true,
      isConcurrencySafe: true,
      async call({ text }) {
        return { echoed: text };
      },
    });

    const mockCaller: LLMCaller = {
      async call(messages) {
        const hadToolResult = messages.some((m) => m.role === "tool_result");
        if (hadToolResult) {
          return { role: "assistant", content: "Done." };
        }
        return {
          role: "assistant",
          content: [
            { type: "text", text: "Calling echo." },
            { type: "tool_use", id: "tu_echo", name: "echo", input: { text: "hi" } },
          ],
        };
      },
    };

    const runner = createAgentLoopRunner({
      sessionId: "sess_tool",
      tools: [echoTool],
      llmCaller: mockCaller,
      enableBackgroundReview: false,
      askConfirmCallback: async () => true,
    });

    const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
    for await (const ev of runner.run("use echo")) events.push(ev);

    // assistant + tool_result + final "Done." assistant
    expect(events.length).toBe(3);
    expect("role" in events[0] ? events[0].role : undefined).toBe("assistant");
    expect(isToolResult(events[1]) ? events[1].type : undefined).toBe("tool_result");
    expect(isToolResult(events[1]) ? events[1].toolUseId : undefined).toBe("tu_echo");
    expect(isToolResult(events[1]) ? events[1].isError : undefined).toBe(false);
    expect(JSON.parse(isToolResult(events[1]) ? events[1].content : "")).toEqual({ echoed: "hi" });
    expect("role" in events[2] ? events[2].role : undefined).toBe("assistant");
    expect("role" in events[2] ? events[2].content : undefined).toBe("Done.");
    expect(runner.getState().status).toBe("idle");
  });

  it("confirm callback denies dangerous tool", async () => {
    const dangerousTool = buildTool({
      name: "self_modify",
      description: "self modify",
      inputSchema: z.object({}),
      isReadOnly: false,
      isConcurrencySafe: false,
      async call() {
        return {};
      },
    });

    const mockCaller: LLMCaller = {
      async call(messages) {
        const hadToolResult = messages.some((m) => m.role === "tool_result");
        if (hadToolResult) {
          return { role: "assistant", content: "Done." };
        }
        return {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu_sm", name: "self_modify", input: {} }],
        };
      },
    };

    const runner = createAgentLoopRunner({
      sessionId: "sess_confirm",
      tools: [dangerousTool],
      llmCaller: mockCaller,
      enableBackgroundReview: false,
      askConfirmCallback: async () => false,
    });

    const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
    for await (const ev of runner.run("modify")) events.push(ev);

    // assistant + blocked tool_result + final "Done." assistant
    expect(events.length).toBe(3);
    expect(isBaseMessage(events[0]) ? events[0].role : undefined).toBe("assistant");
    expect(isToolResult(events[1]) ? events[1].type : undefined).toBe("tool_result");
    expect(isToolResult(events[1]) ? events[1].isError : undefined).toBe(true);
    expect(isToolResult(events[1]) ? events[1].content : "").toContain("denied");
    expect(isBaseMessage(events[2]) ? events[2].role : undefined).toBe("assistant");
    expect(isBaseMessage(events[2]) ? events[2].content : undefined).toBe("Done.");
  });

  it("max turns stops infinite loops", async () => {
    const infiniteTool = buildTool({
      name: "loop_tool",
      description: "loop",
      inputSchema: z.object({}),
      isReadOnly: true,
      isConcurrencySafe: true,
      async call() {
        return { ok: true };
      },
    });

    const mockCaller: LLMCaller = {
      async call() {
        return {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu_loop", name: "loop_tool", input: {} }],
        };
      },
    };

    const runner = createAgentLoopRunner({
      sessionId: "sess_max",
      tools: [infiniteTool],
      llmCaller: mockCaller,
      enableBackgroundReview: false,
    });

    const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
    for await (const ev of runner.run("loop")) events.push(ev);

    // 32 turns * 2 events (assistant + blocked tool_result) = 64
    expect(events.length).toBe(64);
    expect(runner.getState().turnCount).toBe(32);
    expect(runner.getState().status).toBe("idle");
  });

  it("learn flow triggers write_skill", async () => {
    // write_skill is auto-loaded via global pool in runner-pool, but here we
    // instantiate runner directly so we must supply a write_skill mock or real tool.
    const writeSkillMock = buildTool({
      name: "write_skill",
      description: "write skill",
      inputSchema: z.object({ name: z.string(), markdown: z.string() }),
      isReadOnly: false,
      isConcurrencySafe: false,
      async call({ name }) {
        return { success: true, name };
      },
    });

    const mockCaller: LLMCaller = {
      async call(messages) {
        const hadToolResult = messages.some((m) => m.role === "tool_result");
        if (hadToolResult) {
          return { role: "assistant", content: "Done." };
        }
        const last = messages.findLast((m) => m.role === "user")?.content as string;
        if (last.includes("learn this")) {
          return {
            role: "assistant",
            content: [
              { type: "text", text: "I will save this." },
              {
                type: "tool_use",
                id: "tu_ws",
                name: "write_skill",
                input: { name: "test-skill", markdown: "---\nname: test-skill\n---\n" + last },
              },
            ],
          };
        }
        return { role: "assistant", content: "?" };
      },
    };

    const runner = createAgentLoopRunner({
      sessionId: "sess_learn",
      tools: [writeSkillMock],
      llmCaller: mockCaller,
      enableBackgroundReview: false,
    });

    const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
    for await (const ev of runner.run("learn this: how to test")) events.push(ev);

    // assistant + tool_result + final "Done." assistant
    expect(events.length).toBe(3);
    expect(isBaseMessage(events[0]) ? events[0].role : undefined).toBe("assistant");
    expect(isToolResult(events[1]) ? events[1].type : undefined).toBe("tool_result");
    expect(JSON.parse(isToolResult(events[1]) ? events[1].content : "").success).toBe(true);
    expect(isBaseMessage(events[2]) ? events[2].role : undefined).toBe("assistant");
    expect(isBaseMessage(events[2]) ? events[2].content : undefined).toBe("Done.");
  });

  it("accepts ContentBlock[] as user input and persists it", async () => {
    const { getMessages } = await import("../../core/session-db.ts");
    const contentBlocks = [
      { type: "text", text: "what is this?" },
      { type: "image_url", image_url: { url: "/api/uploads/s1/test.png" } },
    ] as const;

    const mockCaller: LLMCaller = {
      async call(messages) {
        const last = messages.findLast((m) => m.role === "user")?.content;
        expect(Array.isArray(last)).toBe(true);
        expect(last).toEqual(contentBlocks);
        return { role: "assistant", content: "It is a test image." };
      },
    };

    const runner = createAgentLoopRunner({
      sessionId: "sess_multimodal",
      tools: [],
      llmCaller: mockCaller,
      enableBackgroundReview: false,
    });

    const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
    for await (const ev of runner.run(contentBlocks as unknown as string | import("../../types/index.ts").ContentBlock[])) events.push(ev);

    expect(events.length).toBe(1);
    expect(isBaseMessage(events[0]) ? events[0].role : undefined).toBe("assistant");
    expect(isBaseMessage(events[0]) ? events[0].content : undefined).toBe("It is a test image.");

    // Verify DB persistence
    const msgs = await getMessages("sess_multimodal");
    if (!msgs.success) throw new Error("getMessages failed");
    const userMsg = msgs.data.find((m) => m.role === "user");
    expect(userMsg).toBeTruthy();
    expect(Array.isArray(userMsg!.content)).toBe(true);
    expect(userMsg!.content).toEqual(contentBlocks);
  });

  it("auto-ingests computer_use trajectory into knowledge base", async () => {
    const computerUseTool = buildTool({
      name: "computer_use",
      description: "computer use",
      inputSchema: z.object({ goal: z.string(), startUrl: z.string() }),
      isReadOnly: false,
      isConcurrencySafe: false,
      async call({ goal }) {
        return {
          success: true,
          goal,
          summary: "Done",
          stepsTaken: 2,
          finalUrl: "https://example.com/done",
          finalScreenshotPath: "/tmp/sc.png",
          finalScreenshotUrl: "/api/gallery/screenshots/sc.png",
          history: ["navigate -> https://example.com/done", "click -> #btn"],
        };
      },
    });

    const mockCaller: LLMCaller = {
      async call(messages) {
        const hadToolResult = messages.some((m) => m.role === "tool_result");
        if (hadToolResult) {
          return { role: "assistant", content: "Done." };
        }
        return {
          role: "assistant",
          content: [
            { type: "text", text: "Using computer." },
            { type: "tool_use", id: "tu_cu", name: "computer_use", input: { goal: "test", startUrl: "https://example.com" } },
          ],
        };
      },
    };

    const ingested: { sessionId: string; content: string; opts: { isFile: boolean; filename: string; format: string } }[] = [];
    const mockKB = {
      async ingestDocument(sessionId: string, content: string, opts: { isFile: boolean; filename: string; format: string }) {
        ingested.push({ sessionId, content, opts });
        return { success: true, documentId: "doc-1", chunkCount: 1 };
      },
      async queryKnowledge() {
        return { results: [] };
      },
    };

    const runner = createAgentLoopRunner({
      sessionId: "sess_cu_kb",
      tools: [computerUseTool],
      llmCaller: mockCaller,
      enableBackgroundReview: false,
      askConfirmCallback: async () => true,
      knowledgeBase: mockKB as unknown as import("../../skills/knowledge-base/index.ts").KnowledgeBase,
    });

    const events: (BaseMessage | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean } | ToolProgressEvent)[] = [];
    for await (const ev of runner.run("use computer")) events.push(ev);

    expect(events.length).toBe(3);
    expect(ingested.length).toBe(1);
    expect(ingested[0].sessionId).toBe("sess_cu_kb");
    expect(ingested[0].opts.filename).toMatch(/computer-use-\d+\.md/);
    expect(ingested[0].content).toContain("Goal: test");
    expect(ingested[0].content).toContain("click -> #btn");
  });
});
