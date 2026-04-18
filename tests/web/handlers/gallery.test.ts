import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleGallery } from "../../../web/routes/handlers/gallery.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();
const mockServeStatic = vi.fn();
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: unknown[]) => mockJson(...args),
  serveStatic: (...args: unknown[]) => mockServeStatic(...args),
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

function createMockReq(url = "/") {
  return { url } as IncomingMessage;
}

function ctx() {
  return { requestId: "req-1", startTime: Date.now() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleGallery", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleGallery(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("GET /api/gallery/screenshots returns empty array when screenshots dir does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const res = createMockRes();
    const result = await handleGallery(createMockReq(), res, "GET", "/api/gallery/screenshots", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(res, 200, { success: true, data: [] }, expect.any(Object));
  });

  it("GET /api/gallery/screenshots returns sorted PNG entries when dir exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["b.png", "a.png", "c.txt"]);
    mockStatSync.mockImplementation((p: string) => {
      if (p.endsWith("a.png")) return { mtimeMs: 1000 };
      if (p.endsWith("b.png")) return { mtimeMs: 2000 };
      return { mtimeMs: 0 };
    });
    const res = createMockRes();
    const result = await handleGallery(createMockReq(), res, "GET", "/api/gallery/screenshots", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      {
        success: true,
        data: [
          { filename: "b.png", url: "/api/gallery/screenshots/b.png", createdAt: 2000 },
          { filename: "a.png", url: "/api/gallery/screenshots/a.png", createdAt: 1000 },
        ],
      },
      expect.any(Object)
    );
  });

  it("GET /api/gallery/screenshots returns 500 when readdirSync throws", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation(() => {
      throw new Error("disk error");
    });
    const res = createMockRes();
    const result = await handleGallery(createMockReq(), res, "GET", "/api/gallery/screenshots", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "Error: disk error" } },
      expect.any(Object)
    );
  });

  it("GET /api/gallery/screenshots/:filename serves the file via serveStatic for a valid .png filename", async () => {
    const res = createMockRes();
    const result = await handleGallery(createMockReq(), res, "GET", "/api/gallery/screenshots/test.png", ctx());
    expect(result).toBe(true);
    expect(mockServeStatic).toHaveBeenCalledWith(res, expect.stringContaining("test.png"), expect.any(Object));
  });

  it("GET /api/gallery/screenshots/:filename returns false for invalid filenames (empty or non-png)", async () => {
    expect(await handleGallery(createMockReq(), createMockRes(), "GET", "/api/gallery/screenshots/", ctx())).toBe(false);
    expect(await handleGallery(createMockReq(), createMockRes(), "GET", "/api/gallery/screenshots/test.jpg", ctx())).toBe(false);
    expect(mockServeStatic).not.toHaveBeenCalled();
  });
});
