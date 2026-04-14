import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanvasWorkspace } from "../../../skills/canvas/index.ts";

const mockPage = {
  setContent: vi.fn(),
  evaluate: vi.fn().mockResolvedValue("data:image/png;base64,abc123"),
};

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
};

const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

describe("CanvasWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("draw returns a PNG data URL", async () => {
    const workspace = new CanvasWorkspace({ width: 400, height: 300 });
    const dataUrl = await workspace.draw([
      { type: "rect", x: 10, y: 10, width: 50, height: 50, fill: "#ff0000" },
    ]);

    expect(dataUrl).toBe("data:image/png;base64,abc123");
    expect(mockPage.evaluate).toHaveBeenCalledOnce();
    await workspace.close();
  });

  it("close shuts down the browser", async () => {
    const workspace = new CanvasWorkspace();
    await workspace.draw([]);
    await workspace.close();

    expect(mockBrowser.close).toHaveBeenCalledOnce();
  });

  it("applies default config values", async () => {
    const workspace = new CanvasWorkspace();
    await workspace.draw([]);

    const setContentCall = mockPage.setContent.mock.calls[0][0] as string;
    expect(setContentCall).toContain('width="800"');
    expect(setContentCall).toContain('height="600"');
    await workspace.close();
  });
});
