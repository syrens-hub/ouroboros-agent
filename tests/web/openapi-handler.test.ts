import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";

describe("OpenAPI handler", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function importHandler() {
    const mod = await import("../../web/routes/handlers/openapi.ts");
    return mod as {
      handleOpenApi: (
        req: IncomingMessage,
        res: ServerResponse,
        method: string,
        path: string,
        ctx: { requestId: string }
      ) => Promise<boolean>;
      invalidateOpenApiCache: () => void;
    };
  }

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

  it("caches the generated spec and rebuilds after invalidation", async () => {
    const { globalPool } = await import("../../web/runner-pool.ts");
    const allSpy = vi.spyOn(globalPool, "all").mockReturnValue([]);

    const { handleOpenApi, invalidateOpenApiCache } = await importHandler();
    const res1 = createRes();
    const matched1 = await handleOpenApi({} as IncomingMessage, res1, "GET", "/api/openapi.json", { requestId: "r1" });
    expect(matched1).toBe(true);
    expect(allSpy).toHaveBeenCalledTimes(1);
    const data1 = JSON.parse(res1._data!);
    expect(data1.success).toBe(true);
    expect(data1.data.openapi).toBe("3.0.3");

    // Second call should use cache (globalPool.all not called again)
    const res2 = createRes();
    await handleOpenApi({} as IncomingMessage, res2, "GET", "/api/openapi.json", { requestId: "r2" });
    expect(allSpy).toHaveBeenCalledTimes(1);
    const data2 = JSON.parse(res2._data!);
    expect(data2.data).toEqual(data1.data);

    // After invalidation, next call rebuilds
    invalidateOpenApiCache();
    const res3 = createRes();
    await handleOpenApi({} as IncomingMessage, res3, "GET", "/api/openapi.json", { requestId: "r3" });
    expect(allSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to { type: 'object' } when zodToJsonSchema throws", async () => {
    vi.doMock("zod-to-json-schema", () => ({
      zodToJsonSchema: vi.fn(() => {
        throw new Error("bad schema");
      }),
    }));

    const { globalPool } = await import("../../web/runner-pool.ts");
    const badTool = {
      name: "bad_tool",
      description: "A tool with an unserializable schema",
      inputSchema: { _def: {} },
      isReadOnly: true,
      isConcurrencySafe: true,
    };
    vi.spyOn(globalPool, "all").mockReturnValue([badTool as unknown as ReturnType<typeof globalPool.all>[number]]);

    const { handleOpenApi, invalidateOpenApiCache } = await importHandler();
    invalidateOpenApiCache();

    const res = createRes();
    await handleOpenApi({} as IncomingMessage, res, "GET", "/api/openapi.json", { requestId: "r4" });
    const data = JSON.parse(res._data!);
    expect(data.data.components.schemas.bad_tool).toEqual({ type: "object" });

    vi.doUnmock("zod-to-json-schema");
  });

  it("returns false for non-matching paths or methods", async () => {
    const { handleOpenApi } = await importHandler();
    const res = createRes();
    expect(await handleOpenApi({} as IncomingMessage, res, "POST", "/api/openapi.json", { requestId: "r5" })).toBe(false);
    expect(await handleOpenApi({} as IncomingMessage, res, "GET", "/api/other", { requestId: "r6" })).toBe(false);
  });
});
