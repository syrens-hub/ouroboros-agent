import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const mockPage = {
  goto: vi.fn(),
  title: vi.fn(),
  url: vi.fn(),
  click: vi.fn(),
  fill: vi.fn(),
  evaluate: vi.fn(),
  screenshot: vi.fn(),
  close: vi.fn(),
};

const mockContext = {
  newPage: vi.fn(() => mockPage),
};

const mockBrowser = {
  newContext: vi.fn(() => mockContext),
  close: vi.fn(),
  isConnected: vi.fn(() => true),
};

vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn(() => Promise.resolve(mockBrowser)),
  },
}));

import { BrowserController } from "../../../skills/browser/index.ts";

describe("BrowserController", () => {
  let controller: BrowserController;

  beforeEach(() => {
    controller = new BrowserController();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await controller.close();
  });

  it("launch", async () => {
    await controller.launch();
    expect(controller.isConnected()).toBe(true);
  });

  it("newPage", async () => {
    await controller.launch();
    const pageId = await controller.newPage();
    expect(typeof pageId).toBe("string");
    expect(mockContext.newPage).toHaveBeenCalled();
  });

  it("navigate", async () => {
    await controller.launch();
    mockPage.goto.mockResolvedValueOnce(undefined);
    mockPage.title.mockResolvedValueOnce("Test Title");
    mockPage.url.mockReturnValueOnce("https://example.com/");
    const pageId = await controller.newPage();
    const result = await controller.navigate(pageId, "https://example.com/");
    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "load",
    });
    expect(result).toEqual({ title: "Test Title", url: "https://example.com/" });
  });

  it("click", async () => {
    await controller.launch();
    mockPage.click.mockResolvedValueOnce(undefined);
    const pageId = await controller.newPage();
    await controller.click(pageId, "#btn");
    expect(mockPage.click).toHaveBeenCalledWith("#btn");
  });

  it("fill", async () => {
    await controller.launch();
    mockPage.fill.mockResolvedValueOnce(undefined);
    const pageId = await controller.newPage();
    await controller.fill(pageId, "#input", "hello");
    expect(mockPage.fill).toHaveBeenCalledWith("#input", "hello");
  });

  it("screenshot", async () => {
    await controller.launch();
    mockPage.screenshot.mockResolvedValueOnce(Buffer.from("png"));
    const pageId = await controller.newPage();
    const path = await controller.screenshot(pageId);
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      type: "png",
      fullPage: undefined,
    });
    expect(path).toContain(".ouroboros/browser-screenshots");
    expect(path).toContain(pageId);
    expect(path).toMatch(/\.png$/);
  });

  it("evaluate", async () => {
    await controller.launch();
    mockPage.evaluate.mockResolvedValueOnce(42);
    const pageId = await controller.newPage();
    const result = await controller.evaluate(pageId, "1+1");
    expect(mockPage.evaluate).toHaveBeenCalledWith("1+1");
    expect(result).toBe(42);
  });

  it("close", async () => {
    await controller.launch();
    await controller.close();
    expect(controller.isConnected()).toBe(false);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it("cleanupScreenshots removes old files over maxCount", async () => {
    const dir = join(homedir(), ".ouroboros", "browser-screenshots");
    mkdirSync(dir, { recursive: true });

    // Seed 5 old files with distinct mtimes
    for (let i = 0; i < 5; i++) {
      const p = join(dir, `old_${Date.now()}_${i}.png`);
      writeFileSync(p, Buffer.from("png"));
      // Touch mtime to be strictly increasing
      // We can't easily set mtime in a cross-platform way without extra dep,
      // but since files are written sequentially, their natural mtimes are increasing.
      // To ensure ordering, wait a tiny bit between writes.
      await new Promise((r) => setTimeout(r, 10));
    }

    const before = readdirSync(dir).filter((f) => f.endsWith(".png")).length;
    expect(before).toBeGreaterThanOrEqual(5);

    const cleanupController = new BrowserController({ screenshotMaxCount: 2 });
    await cleanupController.launch();
    mockPage.screenshot.mockResolvedValue(Buffer.from("png"));
    const pageId = await cleanupController.newPage();
    await cleanupController.screenshot(pageId);

    const after = readdirSync(dir).filter((f) => f.endsWith(".png")).length;
    // Should keep at most maxCount (2) newest files
    expect(after).toBeLessThanOrEqual(2);
    await cleanupController.close();
  });

  it("cleanupScreenshots removes files over maxAge", async () => {
    const dir = join(homedir(), ".ouroboros", "browser-screenshots");
    mkdirSync(dir, { recursive: true });

    const oldFile = join(dir, `stale_${Date.now()}.png`);
    writeFileSync(oldFile, Buffer.from("png"));

    // Manipulate mtime to be 2 hours old using shell touch
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const touchCmd = `touch -t ${twoHoursAgo.toISOString().replace(/[-:T]/g, "").slice(0, 12)} "${oldFile}"`;
    try {
      // Best-effort; if touch fails, test may pass vacuously on some systems
      await new Promise<void>((resolve) => {
        import("child_process").then(({ exec }) => {
          exec(touchCmd, () => resolve());
        });
      });
    } catch {
      // ignore
    }

    const cleanupController = new BrowserController({ screenshotMaxAgeMs: 30 * 60 * 1000 });
    await cleanupController.launch();
    mockPage.screenshot.mockResolvedValue(Buffer.from("png"));
    const pageId = await cleanupController.newPage();
    await cleanupController.screenshot(pageId);

    const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
    expect(files.some((f) => f.startsWith("stale_"))).toBe(false);
    await cleanupController.close();
  });
});
