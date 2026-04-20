import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { ok } from "../../types/index.ts";
import { callLLM } from "../../core/llm-router.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import type { BaseMessage } from "../../types/index.ts";
import type { KnowledgeBase } from "../knowledge-base/index.ts";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { BROWSER_VISION_TIMEOUT_MS } from "../../web/routes/constants.ts";

export interface BrowserConfig {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  args?: string[];
  screenshotMaxCount?: number;
  screenshotMaxAgeMs?: number;
}

type PlaywrightPage = {
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  title(): Promise<string>;
  url(): string;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
  screenshot(options?: { type?: string; fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
};

type PlaywrightContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

type PlaywrightBrowser = {
  newContext(options?: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
  isConnected(): boolean;
};

export class BrowserController {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;
  private pages = new Map<string, PlaywrightPage>();
  private config: BrowserConfig;

  constructor(config: BrowserConfig = {}) {
    this.config = config;
  }

  async launch(): Promise<void> {
    let playwright;
    try {
      playwright = await import("playwright-core");
    } catch {
      throw new Error(
        "playwright-core is not available. Please install it to use the browser skill."
      );
    }

    const args = ["--no-sandbox", ...(this.config.args || [])];
    this.browser = (await playwright.chromium.launch({
      headless: this.config.headless ?? true,
      args,
    })) as unknown as PlaywrightBrowser;

    const contextOptions: Record<string, unknown> = {};
    if (this.config.userAgent) {
      contextOptions.userAgent = this.config.userAgent;
    }
    this.context = await this.browser.newContext(contextOptions);
  }

  async newPage(): Promise<string> {
    if (!this.context) throw new Error("Browser not launched");
    const page = await this.context.newPage();
    if (this.config.viewport) {
      await page.setViewportSize(this.config.viewport);
    }
    const id = crypto.randomUUID();
    this.pages.set(id, page);
    return id;
  }

  async closePage(pageId: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    await page.close();
    this.pages.delete(pageId);
  }

  async navigate(
    pageId: string,
    url: string
  ): Promise<{ title: string; url: string }> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    await page.goto(url, { waitUntil: "load" });
    const title = await page.title();
    return { title, url: page.url() };
  }

  async click(pageId: string, selector: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    await page.click(selector);
  }

  async fill(pageId: string, selector: string, text: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    await page.fill(selector, text);
  }

  async scroll(pageId: string, x: number, y: number): Promise<void> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    await page.evaluate(`window.scrollBy(${x}, ${y})`);
  }

  async screenshot(
    pageId: string,
    options?: { fullPage?: boolean }
  ): Promise<string> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    const buffer = await page.screenshot({
      type: "png",
      fullPage: options?.fullPage,
    });
    const dir = join(homedir(), ".ouroboros", "browser-screenshots");
    mkdirSync(dir, { recursive: true });
    const timestamp = Date.now();
    const filePath = join(dir, `${pageId}_${timestamp}.png`);
    writeFileSync(filePath, buffer);
    this.cleanupScreenshots(dir);
    return filePath;
  }

  private cleanupScreenshots(dir: string): void {
    const maxCount = this.config.screenshotMaxCount ?? 200;
    const maxAgeMs = this.config.screenshotMaxAgeMs ?? 24 * 60 * 60 * 1000;
    const now = Date.now();

    let entries: { name: string; path: string; mtimeMs: number }[] = [];
    try {
      entries = readdirSync(dir)
        .filter((f) => f.endsWith(".png"))
        .map((f) => {
          const p = join(dir, f);
          const stat = statSync(p);
          return { name: f, path: p, mtimeMs: stat.mtimeMs };
        });
    } catch {
      return;
    }

    // Sort by modification time descending (newest first)
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const overCount = i >= maxCount;
      const overAge = now - entry.mtimeMs > maxAgeMs;
      if (overCount || overAge) {
        try {
          unlinkSync(entry.path);
        } catch {
          // ignore
        }
      }
    }
  }

  async screenshotBase64(
    pageId: string,
    options?: { fullPage?: boolean }
  ): Promise<{ dataUrl: string; mimeType: string }> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    const buffer = await page.screenshot({
      type: "png",
      fullPage: options?.fullPage,
    });
    const base64 = buffer.toString("base64");
    return { dataUrl: `data:image/png;base64,${base64}`, mimeType: "image/png" };
  }

  async evaluate<T = unknown>(pageId: string, script: string): Promise<T> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page ${pageId} not found`);
    return page.evaluate<T>(script);
  }

  async getPageInfo(
    pageId: string
  ): Promise<{ id: string; url: string; title: string; isActive: boolean }> {
    const page = this.pages.get(pageId);
    if (!page) {
      return { id: pageId, url: "", title: "", isActive: false };
    }
    return {
      id: pageId,
      url: page.url(),
      title: await page.title(),
      isActive: true,
    };
  }

  async close(): Promise<void> {
    for (const [id, page] of this.pages) {
      try {
        await page.close();
      } catch {
        // ignore
      }
      this.pages.delete(id);
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
      this.context = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore
      }
      this.browser = null;
    }
  }

  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }
}

const COMPUTER_USE_PROMPT = `You are a web browsing assistant. You are looking at a screenshot of a webpage.
Your task is to accomplish the user's goal by interacting with the page.

Rules:
- You are also given a list of interactive elements on the page (index, tag, text, selector).
- Prefer using the provided selector for precision.
- If a field needs text input, use the "type" action.
- If you need to click a button or link, use the "click" action.
- If the page content is below the fold, use the "scroll" action.
- If you need to go to a different URL, use the "navigate" action.
- When the task is complete, respond with "done".

Respond in EXACTLY ONE of these formats (no extra text):

ACTION: click | selector: <css-selector>
ACTION: type | selector: <css-selector> | value: <text>
ACTION: scroll | direction: down | amount: <pixels>
ACTION: navigate | url: <url>
ACTION: done | summary: <what was accomplished>`;

export function parseComputerAction(text: string): {
  action: "click" | "type" | "scroll" | "navigate" | "done" | "unknown";
  params: Record<string, string>;
} {
  const normalized = text.trim();
  const actionMatch = normalized.match(/^ACTION:\s*(\w+)/i);
  if (!actionMatch) return { action: "unknown", params: {} };
  const action = actionMatch[1].toLowerCase() as ReturnType<typeof parseComputerAction>["action"];
  const params: Record<string, string> = {};
  const parts = normalized.split("|").slice(1);
  for (const part of parts) {
    const [key, ...rest] = part.split(":");
    if (key && rest.length > 0) {
      params[key.trim()] = rest.join(":").trim();
    }
  }
  return { action, params };
}

export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return false;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname === "[::1]") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function createBrowserTools(
  controller: BrowserController,
  llmCfg?: LLMConfig,
  _deps?: { knowledgeBase?: KnowledgeBase }
) {
  return [
    buildTool({
      name: "browser_launch",
      description: "Launch the browser controller.",
      inputSchema: z.object({ headless: z.boolean().optional() }),
      isReadOnly: false,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call({ headless }) {
        if (headless !== undefined) {
          (controller as unknown as { config: BrowserConfig }).config.headless = headless;
        }
        await controller.launch();
        return { success: true, connected: controller.isConnected() };
      },
    }),
    buildTool({
      name: "browser_close",
      description: "Close the browser controller.",
      inputSchema: z.object({}),
      isReadOnly: false,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call() {
        await controller.close();
        return { success: true };
      },
    }),
    buildTool({
      name: "browser_navigate",
      description: "Navigate a browser page to a URL.",
      inputSchema: z.object({ pageId: z.string(), url: z.string() }),
      isReadOnly: false,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call({ pageId, url }) {
        return controller.navigate(pageId, url);
      },
    }),
    buildTool({
      name: "browser_click",
      description: "Click an element on a browser page by CSS selector.",
      inputSchema: z.object({ pageId: z.string(), selector: z.string() }),
      isReadOnly: false,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call({ pageId, selector }) {
        await controller.click(pageId, selector);
        return { success: true };
      },
    }),
    buildTool({
      name: "browser_fill",
      description: "Fill an input element on a browser page by CSS selector.",
      inputSchema: z.object({
        pageId: z.string(),
        selector: z.string(),
        text: z.string(),
      }),
      isReadOnly: false,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call({ pageId, selector, text }) {
        await controller.fill(pageId, selector, text);
        return { success: true };
      },
    }),
    buildTool({
      name: "browser_screenshot",
      description: "Take a screenshot of a browser page and save it to disk.",
      inputSchema: z.object({
        pageId: z.string(),
        fullPage: z.boolean().optional(),
      }),
      isReadOnly: true,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call({ pageId, fullPage }) {
        const path = await controller.screenshot(pageId, { fullPage });
        return { success: true, path };
      },
    }),
    buildTool({
      name: "browser_screenshot_base64",
      description:
        "Take a screenshot of a browser page and return it as a base64 data URL suitable for vision LLMs.",
      inputSchema: z.object({
        pageId: z.string(),
        fullPage: z.boolean().optional(),
      }),
      isReadOnly: true,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call({ pageId, fullPage }) {
        return controller.screenshotBase64(pageId, { fullPage });
      },
    }),
    buildTool({
      name: "browser_get_elements",
      description:
        "Extract a list of interactive elements (buttons, links, inputs) from the current page with index, tag, text, and CSS selector hints.",
      inputSchema: z.object({ pageId: z.string() }),
      isReadOnly: true,
      isConcurrencySafe: true,
      checkPermissions: () => ok("allow"),
      async call({ pageId }) {
        const elements = await controller.evaluate<
          Array<{
            index: number;
            tag: string;
            type?: string;
            text?: string;
            placeholder?: string;
            id?: string;
            class?: string;
            selector: string;
          }>
        >(
          pageId,
          `(() => {
            const elements = Array.from(document.querySelectorAll('button, a, input, textarea, select'));
            return elements.map((el, idx) => {
              const tag = el.tagName.toLowerCase();
              const id = el.id ? '#' + el.id : '';
              const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '';
              return {
                index: idx,
                tag: el.tagName,
                type: el.type || undefined,
                text: el.innerText?.slice(0, 50) || undefined,
                placeholder: el.placeholder || undefined,
                id: el.id || undefined,
                class: el.className || undefined,
                selector: tag + id + cls
              };
            });
          })()`
        );
        return { success: true, elements };
      },
    }),
    buildTool({
      name: "browser_extract",
      description: "Extract the visible text content from a browser page.",
      inputSchema: z.object({ pageId: z.string() }),
      isReadOnly: true,
      isConcurrencySafe: true,
      checkPermissions: () => ok("allow"),
      async call({ pageId }) {
        const text = await controller.evaluate<string>(
          pageId,
          "document.body.innerText"
        );
        return { success: true, text };
      },
    }),
    buildTool({
      name: "computer_use",
      description:
        "Autonomously operate a web browser to accomplish a goal. Uses vision LLM to analyze screenshots and decide actions (click, type, scroll, navigate).",
      inputSchema: z.object({
        goal: z.string().describe("The task to accomplish"),
        startUrl: z.string().describe("The starting URL"),
        maxSteps: z.number().default(10).describe("Maximum screenshot-action iterations"),
      }),
      isReadOnly: false,
      isConcurrencySafe: false,
      checkPermissions: () => ok("allow"),
      async call({ goal, startUrl, maxSteps = 10 }, ctx) {
        if (!llmCfg || !llmCfg.apiKey) {
          throw new Error("LLM not configured. computer_use requires a vision-capable LLM.");
        }
        if (!isAllowedUrl(startUrl)) {
          throw new Error(`Start URL not allowed: ${startUrl}`);
        }

        if (!controller.isConnected()) {
          await controller.launch();
        }
        const pageId = await controller.newPage();
        let finalScreenshotPath = "";
        const history: string[] = [];

        try {
          const navInfo = await controller.navigate(pageId, startUrl);
          history.push(`navigate -> ${navInfo.url}`);

          for (let step = 0; step < maxSteps; step++) {
            // 1) Screenshot
            const { dataUrl } = await controller.screenshotBase64(pageId);

            // 2) Get interactive elements for context
            const elements = await controller.evaluate<
              Array<{
                index: number;
                tag: string;
                type?: string;
                text?: string;
                placeholder?: string;
                id?: string;
                class?: string;
                selector: string;
              }>
            >(
              pageId,
              `(() => {
                const elements = Array.from(document.querySelectorAll('button, a, input, textarea, select'));
                return elements.map((el, idx) => {
                  const tag = el.tagName.toLowerCase();
                  const id = el.id ? '#' + el.id : '';
                  const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '';
                  return {
                    index: idx,
                    tag: el.tagName,
                    type: el.type || undefined,
                    text: el.innerText?.slice(0, 50) || undefined,
                    placeholder: el.placeholder || undefined,
                    id: el.id || undefined,
                    class: el.className || undefined,
                    selector: tag + id + cls
                  };
                });
              })()`
            );
            const elementsText = elements.length > 0
              ? `Interactive elements on the page:\n` + elements.map((el) => `[${el.index}] ${el.tag}${el.type ? `(${el.type})` : ""} "${el.text || el.placeholder || ""}" selector="${el.selector}"`).join("\n")
              : "No interactive elements detected.";

            // Save intermediate screenshot for UI
            const midScreenshotPath = await controller.screenshot(pageId);
            const midScreenshotUrl = `/api/gallery/screenshots/${basename(midScreenshotPath)}`;

            ctx.reportProgress({
              type: "progress",
              toolName: "computer_use",
              step: step + 1,
              totalSteps: maxSteps,
              message: `Analyzing screenshot and ${elements.length} interactive elements`,
              detail: { url: (await controller.getPageInfo(pageId)).url, screenshotUrl: midScreenshotUrl },
            });

            // 3) Build vision prompt
            const historyText = history.length > 0 ? `Previous actions:\n${history.join("\n")}` : "No previous actions yet.";
            const promptText = `Goal: ${goal}\n\n${historyText}\n\n${elementsText}\n\nCurrent page screenshot:`;
            const messages: BaseMessage[] = [
              { role: "system", content: COMPUTER_USE_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: promptText },
                  { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
                ],
              },
            ];

            // 3) Call LLM with timeout
            let visionTimeoutId: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<never>((_, reject) => {
              visionTimeoutId = setTimeout(
                () => reject(new Error("LLM vision call timed out")),
                BROWSER_VISION_TIMEOUT_MS
              );
            });
            const llmRes = await Promise.race([
              callLLM(llmCfg, messages, []).finally(() => clearTimeout(visionTimeoutId)),
              timeoutPromise,
            ]);

            if (!llmRes.success) {
              throw new Error(`Vision LLM error: ${llmRes.error.message}`);
            }

            let llmText = "";
            if (typeof llmRes.data.content === "string") {
              llmText = llmRes.data.content;
            } else {
              llmText = llmRes.data.content
                .filter((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
                .map((b) => b.text)
                .join("\n");
            }

            // 4) Parse action
            const parsed = parseComputerAction(llmText);

            if (parsed.action === "done") {
              finalScreenshotPath = await controller.screenshot(pageId);
              history.push(`done -> ${parsed.params.summary || "task complete"}`);
              ctx.reportProgress({
                type: "progress",
                toolName: "computer_use",
                step: step + 1,
                totalSteps: maxSteps,
                message: `Task complete: ${parsed.params.summary || "done"}`,
                detail: { action: "done" },
              });
              return {
                success: true,
                goal,
                summary: parsed.params.summary || "Task completed.",
                stepsTaken: step + 1,
                finalUrl: (await controller.getPageInfo(pageId)).url,
                finalScreenshotPath,
                finalScreenshotUrl: finalScreenshotPath ? `/api/gallery/screenshots/${basename(finalScreenshotPath)}` : "",
                history,
              };
            }

            if (parsed.action === "unknown") {
              history.push(`unknown -> ${llmText.slice(0, 200)}`);
              ctx.reportProgress({
                type: "progress",
                toolName: "computer_use",
                step: step + 1,
                totalSteps: maxSteps,
                message: `Unrecognized LLM response, retrying`,
                detail: { raw: llmText.slice(0, 200) },
              });
              // Retry once by continuing loop
              continue;
            }

            // 5) Execute action
            let actionMessage = "";
            switch (parsed.action) {
              case "click": {
                const selector = parsed.params.selector;
                if (!selector) throw new Error("Missing selector for click action");
                await controller.click(pageId, selector);
                history.push(`click -> ${selector}`);
                actionMessage = `Click ${selector}`;
                break;
              }
              case "type": {
                const selector = parsed.params.selector;
                const value = parsed.params.value;
                if (!selector) throw new Error("Missing selector for type action");
                await controller.fill(pageId, selector, value || "");
                history.push(`type -> ${selector}: ${value || ""}`);
                actionMessage = `Type "${value || ""}" into ${selector}`;
                break;
              }
              case "scroll": {
                const direction = parsed.params.direction || "down";
                const amount = parseInt(parsed.params.amount || "500", 10);
                const y = direction === "up" ? -amount : amount;
                await controller.scroll(pageId, 0, y);
                history.push(`scroll -> ${direction} ${amount}`);
                actionMessage = `Scroll ${direction} ${amount}px`;
                break;
              }
              case "navigate": {
                const url = parsed.params.url;
                if (!url) throw new Error("Missing url for navigate action");
                if (!isAllowedUrl(url)) throw new Error(`Navigation to ${url} is not allowed.`);
                const info = await controller.navigate(pageId, url);
                history.push(`navigate -> ${info.url}`);
                actionMessage = `Navigate to ${info.url}`;
                break;
              }
              default:
                history.push(`unhandled -> ${llmText.slice(0, 200)}`);
                actionMessage = `Unhandled action`;
            }

            ctx.reportProgress({
              type: "progress",
              toolName: "computer_use",
              step: step + 1,
              totalSteps: maxSteps,
              message: actionMessage,
              detail: { action: parsed.action, params: parsed.params },
            });

            // Small wait for page to settle
            await new Promise((r) => setTimeout(r, 500));
          }

          finalScreenshotPath = await controller.screenshot(pageId);
          return {
            success: true,
            goal,
            summary: "Reached max steps without explicit completion.",
            stepsTaken: maxSteps,
            finalUrl: (await controller.getPageInfo(pageId)).url,
            finalScreenshotPath,
            finalScreenshotUrl: finalScreenshotPath ? `/api/gallery/screenshots/${basename(finalScreenshotPath)}` : "",
            history,
          };
        } catch (e) {
          try {
            await controller.closePage(pageId);
          } catch {
            // ignore
          }
          throw e;
        }
      },
    }),
  ];
}
