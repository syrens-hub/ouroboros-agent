import { describe, it, expect, vi } from "vitest";
import {
  MultimediaGenerator,
  MiniMaxProvider,
  createMultimediaTools,
} from "../../skills/multimedia/index.ts";

describe("MiniMaxProvider", () => {
  it("builds correct image request URL and body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://example.com/img.png" }] }),
    } as Response);

    const provider = new MiniMaxProvider("test-key");
    const url = await provider.generateImage("a cat", { style: "anime", resolution: "1024x1024" });

    expect(url).toBe("https://example.com/img.png");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.minimax.chat/v1/image_generation");
    const body = JSON.parse(init!.body as string);
    expect(body.prompt).toBe("a cat");
    expect(body.style_type).toBe("anime");

    fetchSpy.mockRestore();
  });
});

describe("MultimediaGenerator", () => {
  it("generates image task and emits events", async () => {
    const generator = new MultimediaGenerator();
    const started = vi.fn();
    const completed = vi.fn();
    generator.on("generation:start", started);
    generator.on("generation:complete", completed);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://example.com/img.png" }] }),
    } as Response);

    generator.addMiniMaxProvider("minimax", "test-key");
    const result = await generator.generateImage("a cat");

    expect(result.status).toBe("completed");
    expect(result.type).toBe("image");
    expect(result.outputUrl).toBe("https://example.com/img.png");
    expect(started).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledOnce();

    fetchSpy.mockRestore();
  });

  it("tracks failed tasks", async () => {
    const generator = new MultimediaGenerator();
    generator.addMiniMaxProvider("minimax", "test-key");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      text: async () => "Bad Request",
    } as Response);

    const result = await generator.generateImage("a cat");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Bad Request");

    fetchSpy.mockRestore();
  });

  it("lists tasks by type", async () => {
    const generator = new MultimediaGenerator();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://example.com/img.png" }] }),
    } as Response);

    generator.addMiniMaxProvider("minimax", "test-key");
    await generator.generateImage("a cat");
    await generator.generateMusic("happy tune");

    expect(generator.getTasksByType("image")).toHaveLength(1);
    expect(generator.getTasksByType("music")).toHaveLength(1);

    fetchSpy.mockRestore();
  });
});

describe("Multimedia Tools", () => {
  it("generate_image tool returns task info", async () => {
    const generator = new MultimediaGenerator();
    generator.addMiniMaxProvider("minimax", "test-key");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://example.com/img.png" }] }),
    } as Response);

    const tools = createMultimediaTools(generator);
    const tool = tools.find((t) => t.name === "generate_image")!;
    const result = await tool.call({ prompt: "a cat" }, {
      taskId: "test-task",
      abortSignal: new AbortController().signal,
      reportProgress: () => {},
      invokeSubagent: async <_I, O>() => ({} as unknown as O),
    });

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://example.com/img.png");

    fetchSpy.mockRestore();
  });
});
