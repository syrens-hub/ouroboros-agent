import { describe, it, expect, vi } from "vitest";
import { EmbeddingService } from "../../../skills/knowledge-base/embedding-service.ts";

describe("EmbeddingService", () => {
  it("local provider returns 256-dim normalized vector", async () => {
    const service = new EmbeddingService({ provider: "local" });
    const result = await service.embed("hello world");

    expect(result.dimensions).toBe(256);
    expect(result.values).toHaveLength(256);

    const magnitude = Math.sqrt(
      result.values.reduce((sum, v) => sum + v * v, 0)
    );
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("openai provider mocked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
      }),
    } as Response);

    const service = new EmbeddingService({
      provider: "openai",
      apiKey: "test-openai-key",
      model: "text-embedding-3-small",
    });

    const result = await service.embed("test prompt");

    expect(result.dimensions).toBe(4);
    expect(result.values).toHaveLength(4);

    const magnitude = Math.sqrt(
      result.values.reduce((sum, v) => sum + v * v, 0)
    );
    expect(magnitude).toBeCloseTo(1, 5);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(init!.body as string);
    expect(body.input).toBe("test prompt");
    expect(body.model).toBe("text-embedding-3-small");
    expect(init!.headers).toMatchObject({
      Authorization: "Bearer test-openai-key",
    });

    fetchSpy.mockRestore();
  });

  it("minimax provider mocked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.5, 0.5, 0.5, 0.5] }],
      }),
    } as Response);

    const service = new EmbeddingService({
      provider: "minimax",
      apiKey: "test-minimax-key",
      baseUrl: "https://api.minimax.chat/v1",
      model: "embo-01",
    });

    const result = await service.embed("another test");

    expect(result.dimensions).toBe(4);
    expect(result.values).toHaveLength(4);

    const magnitude = Math.sqrt(
      result.values.reduce((sum, v) => sum + v * v, 0)
    );
    expect(magnitude).toBeCloseTo(1, 5);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.minimax.chat/v1/embeddings");
    const body = JSON.parse(init!.body as string);
    expect(body.text).toBe("another test");
    expect(body.model).toBe("embo-01");
    expect(init!.headers).toMatchObject({
      Authorization: "Bearer test-minimax-key",
    });

    fetchSpy.mockRestore();
  });

  it("batch embedding returns array of same length", async () => {
    const service = new EmbeddingService({ provider: "local" });
    const results = await service.embedBatch([
      "first text",
      "second text",
      "third text",
    ]);

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.dimensions).toBe(256);
      expect(result.values).toHaveLength(256);
      const magnitude = Math.sqrt(
        result.values.reduce((sum, v) => sum + v * v, 0)
      );
      expect(magnitude).toBeCloseTo(1, 5);
    }
  });

  it("xenova provider returns embeddings via mocked pipeline", async () => {
    const mockPipeline = vi.fn(async (_texts: string | string[], _opts: { pooling: string; normalize: boolean }) => {
      const texts = Array.isArray(_texts) ? _texts : [_texts];
      return texts.map(() => ({
        data: new Float32Array([0.1, 0.2, 0.3, 0.4]),
        dims: [1, 4],
      }));
    });

    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn(() => Promise.resolve(mockPipeline)),
    }));

    // Force re-import by creating a fresh module reference
    const { EmbeddingService: XenovaEmbeddingService } = await import("../../../skills/knowledge-base/embedding-service.ts");
    const service = new XenovaEmbeddingService({ provider: "xenova", model: "Xenova/all-MiniLM-L6-v2" });

    const result = await service.embed("test prompt");
    expect(result.dimensions).toBe(4);
    expect(result.values).toHaveLength(4);

    const batch = await service.embedBatch(["a", "b"]);
    expect(batch).toHaveLength(2);
    expect(mockPipeline).toHaveBeenCalledWith(["a", "b"], { pooling: "mean", normalize: true });

    vi.doUnmock("@xenova/transformers");
  });
});
