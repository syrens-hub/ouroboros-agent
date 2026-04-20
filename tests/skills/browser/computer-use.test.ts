import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type ToolLike = { call: (...args: unknown[]) => Promise<Record<string, unknown>> };

const mockPage = {
  goto: vi.fn(),
  title: vi.fn(),
  url: vi.fn(() => "https://example.com/page"),
  click: vi.fn(),
  fill: vi.fn(),
  evaluate: vi.fn(),
  screenshot: vi.fn(() => Promise.resolve(Buffer.from("png"))),
  close: vi.fn(),
  setViewportSize: vi.fn(),
};

const mockContext = {
  newPage: vi.fn(() => Promise.resolve(mockPage)),
};

const mockBrowser = {
  newContext: vi.fn(() => Promise.resolve(mockContext)),
  close: vi.fn(),
  isConnected: vi.fn(() => true),
};

vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn(() => Promise.resolve(mockBrowser)),
  },
}));

vi.mock("../../../core/llm-router.ts", async () => {
  const actual = await vi.importActual<typeof import("../../../core/llm-router.ts")>(
    "../../../core/llm-router.ts"
  );
  return {
    ...actual,
    callLLM: vi.fn(),
  };
});

import {
  BrowserController,
  createBrowserTools,
  parseComputerAction,
  isAllowedUrl,
} from "../../../skills/browser/index.ts";
import { callLLM } from "../../../core/llm-router.ts";
import type { ToolCallContext } from "../../../types/index.ts";

const ctx = {
  taskId: "task_1",
  abortSignal: new AbortController().signal,
  reportProgress: () => {},
  invokeSubagent: async () => ({}),
} as unknown as ToolCallContext<unknown>;

function mockLLMResponse(text: string) {
  (callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    data: {
      role: "assistant",
      content: [{ type: "text" as const, text }],
    },
  });
}

describe("parseComputerAction", () => {
  it("parses click", () => {
    const res = parseComputerAction("ACTION: click | selector: #btn");
    expect(res.action).toBe("click");
    expect(res.params.selector).toBe("#btn");
  });

  it("parses type", () => {
    const res = parseComputerAction("ACTION: type | selector: #input | value: hello world");
    expect(res.action).toBe("type");
    expect(res.params.selector).toBe("#input");
    expect(res.params.value).toBe("hello world");
  });

  it("parses scroll", () => {
    const res = parseComputerAction("ACTION: scroll | direction: up | amount: 300");
    expect(res.action).toBe("scroll");
    expect(res.params.direction).toBe("up");
    expect(res.params.amount).toBe("300");
  });

  it("parses navigate", () => {
    const res = parseComputerAction("ACTION: navigate | url: https://example.com");
    expect(res.action).toBe("navigate");
    expect(res.params.url).toBe("https://example.com");
  });

  it("parses done", () => {
    const res = parseComputerAction("ACTION: done | summary: Task finished successfully");
    expect(res.action).toBe("done");
    expect(res.params.summary).toBe("Task finished successfully");
  });

  it("returns unknown for malformed input", () => {
    const res = parseComputerAction("Just some random text");
    expect(res.action).toBe("unknown");
    expect(Object.keys(res.params).length).toBe(0);
  });
});

describe("isAllowedUrl", () => {
  it("allows regular https URLs", () => {
    expect(isAllowedUrl("https://example.com")).toBe(true);
  });

  it("rejects file protocol", () => {
    expect(isAllowedUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects localhost with blocked ports", () => {
    expect(isAllowedUrl("http://localhost:8080/api")).toBe(false);
    expect(isAllowedUrl("http://127.0.0.1:3000/")).toBe(false);
  });

  it("rejects localhost with standard ports", () => {
    expect(isAllowedUrl("http://localhost:80/")).toBe(false);
    expect(isAllowedUrl("https://localhost:443/")).toBe(false);
  });

  it("rejects ipv6 localhost", () => {
    expect(isAllowedUrl("http://[::1]:8080/")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(isAllowedUrl("not a url")).toBe(false);
  });
});

describe("computer_use tool", () => {
  let controller: BrowserController;
  const llmCfg = {
    provider: "openai" as const,
    model: "gpt-4o",
    apiKey: "sk-test",
  };

  beforeEach(() => {
    controller = new BrowserController();
    vi.clearAllMocks();
    mockPage.evaluate.mockReturnValue([]);
  });

  afterEach(async () => {
    await controller.close();
  });

  it("throws when LLM is not configured", async () => {
    const tools = createBrowserTools(controller, undefined);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    await expect(
      (computerUse as unknown as ToolLike).call({ goal: "test", startUrl: "https://example.com" }, ctx)
    ).rejects.toThrow("LLM not configured");
  });

  it("throws when startUrl is not allowed", async () => {
    const tools = createBrowserTools(controller, llmCfg);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    await expect(
      (computerUse as unknown as ToolLike).call({ goal: "test", startUrl: "file:///secret" }, ctx)
    ).rejects.toThrow("Start URL not allowed");
  });

  it("completes immediately when LLM returns done", async () => {
    const tools = createBrowserTools(controller, llmCfg);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    mockLLMResponse("ACTION: done | summary: Completed");

    const result = (await (computerUse as unknown as ToolLike).call(
      { goal: "test", startUrl: "https://example.com", maxSteps: 5 },
      ctx
    )) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Completed");
    expect(result.stepsTaken).toBe(1);
    expect(result.finalUrl).toBe("https://example.com/page");
    expect(result.history).toEqual([
      "navigate -> https://example.com/page",
      "done -> Completed",
    ]);
  });

  it("executes click action from LLM", async () => {
    const tools = createBrowserTools(controller, llmCfg);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    mockLLMResponse("ACTION: click | selector: #submit");

    const result = (await (computerUse as unknown as ToolLike).call(
      { goal: "click submit", startUrl: "https://example.com", maxSteps: 5 },
      ctx
    )) as Record<string, unknown>;

    expect(mockPage.click).toHaveBeenCalledWith("#submit");
    expect(result.success).toBe(true);
    expect(result.stepsTaken).toBe(5);
    expect(result.summary).toBe("Reached max steps without explicit completion.");
  });

  it("executes type action from LLM", async () => {
    const tools = createBrowserTools(controller, llmCfg);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    mockLLMResponse("ACTION: type | selector: #search | value: Ouroboros");

    const result = (await (computerUse as unknown as ToolLike).call(
      { goal: "search", startUrl: "https://example.com", maxSteps: 3 },
      ctx
    )) as Record<string, unknown>;

    expect(mockPage.fill).toHaveBeenCalledWith("#search", "Ouroboros");
    expect(result.success).toBe(true);
  });

  it("executes scroll action from LLM", async () => {
    const tools = createBrowserTools(controller, llmCfg);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    mockLLMResponse("ACTION: scroll | direction: down | amount: 200");

    const result = (await (computerUse as unknown as ToolLike).call(
      { goal: "scroll page", startUrl: "https://example.com", maxSteps: 2 },
      ctx
    )) as Record<string, unknown>;

    expect(mockPage.evaluate).toHaveBeenCalledWith("window.scrollBy(0, 200)");
    expect(result.success).toBe(true);
  });

  it("executes navigate action from LLM", async () => {
    const tools = createBrowserTools(controller, llmCfg);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    mockPage.goto.mockResolvedValueOnce(undefined);
    mockPage.title.mockResolvedValueOnce("Next Page");
    mockPage.url.mockReturnValueOnce("https://example.com/next");

    mockLLMResponse("ACTION: navigate | url: https://example.com/next");

    const result = (await (computerUse as unknown as ToolLike).call(
      { goal: "go next", startUrl: "https://example.com", maxSteps: 2 },
      ctx
    )) as Record<string, unknown>;

    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com/next", { waitUntil: "load" });
    expect(result.success).toBe(true);
    expect(result.history).toContain("navigate -> https://example.com/next");
  });

  it("blocks navigate to disallowed URL mid-loop", async () => {
    const tools = createBrowserTools(controller, llmCfg);
    const computerUse = tools.find((t) => t.name === "computer_use")!;
    mockLLMResponse("ACTION: navigate | url: file:///etc/passwd");

    await expect(
      (computerUse as unknown as ToolLike).call(
        { goal: "hack", startUrl: "https://example.com", maxSteps: 2 },
        ctx
      )
    ).rejects.toThrow("Navigation to file:///etc/passwd is not allowed.");
  });
});
