import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleBackup } from "../../../web/routes/handlers/backup.ts";
import { createMockRes } from "./mock-res.ts";

const mockJson = vi.fn();
const mockReadBody = vi.fn();
const mockParseBody = vi.fn();
const mockExportTrajectories = vi.fn();
const mockCreateBackup = vi.fn();
const mockListBackups = vi.fn();
const mockRestoreBackup = vi.fn();
const mockGracefulShutdown = vi.fn();

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: any[]) => mockJson(...args),
  readBody: (...args: any[]) => mockReadBody(...args),
  parseBody: (...args: any[]) => mockParseBody(...args),
  RestoreBackupBodySchema: {},
  ReqContext: {},
  OUT_PATH: "/tmp/out.jsonl",
  exportTrajectories: (...args: any[]) => mockExportTrajectories(...args),
}));

vi.mock("../../../core/backup.ts", () => ({
  createBackup: (...args: any[]) => mockCreateBackup(...args),
  listBackups: (...args: any[]) => mockListBackups(...args),
  restoreBackup: (...args: any[]) => mockRestoreBackup(...args),
}));

vi.mock("../../../web/server.ts", () => ({
  gracefulShutdown: (...args: any[]) => mockGracefulShutdown(...args),
}));

let mockExistsSync = (p: string) => p === "/tmp/out.jsonl";
let mockReadFileSync = (p: string) => "backup-data";

vi.mock("fs", () => ({
  existsSync: (p: string) => mockExistsSync(p),
  readFileSync: (p: string) => mockReadFileSync(p),
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

describe("handleBackup", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleBackup(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("POST /api/backup/export succeeds", async () => {
    mockExportTrajectories.mockResolvedValue({ count: 5, path: "/tmp/out.jsonl" });
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/export", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { count: 5, path: "/tmp/out.jsonl" } },
      expect.any(Object)
    );
  });

  it("POST /api/backup/export handles error", async () => {
    mockExportTrajectories.mockRejectedValue(new Error("disk full"));
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/export", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "Error: disk full" } },
      expect.any(Object)
    );
  });

  it("GET /api/backup/download returns 404 when missing", async () => {
    mockExistsSync = () => false;
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "GET", "/api/backup/download", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      404,
      { success: false, error: { message: "No backup file found" } },
      expect.any(Object)
    );
  });

  it("GET /api/backup/download returns file when present", async () => {
    mockExistsSync = () => true;
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "GET", "/api/backup/download", ctx());
    expect(result).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/jsonl");
    expect(res._data).toBe("backup-data");
  });

  it("GET /api/backup/db/list", async () => {
    mockListBackups.mockReturnValue([{ filename: "b1.db", sizeBytes: 1024 }]);
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "GET", "/api/backup/db/list", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: [{ filename: "b1.db", sizeBytes: 1024 }] },
      expect.any(Object)
    );
  });

  it("POST /api/backup/db/create succeeds", async () => {
    mockCreateBackup.mockResolvedValue({ success: true, filename: "new.db", path: "/tmp/new.db" });
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/db/create", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { filename: "new.db", path: "/tmp/new.db" } },
      expect.any(Object)
    );
  });

  it("POST /api/backup/db/create fails", async () => {
    mockCreateBackup.mockResolvedValue({ success: false, error: "locked" });
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/db/create", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "locked" } },
      expect.any(Object)
    );
  });

  it("POST /api/backup/db/restore handles payload too large", async () => {
    mockReadBody.mockRejectedValue(new Error("PAYLOAD_TOO_LARGE"));
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/db/restore", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      413,
      { success: false, error: { message: "Payload too large" } },
      expect.any(Object)
    );
  });

  it("POST /api/backup/db/restore validates schema", async () => {
    mockReadBody.mockResolvedValue('{"filename":1}');
    mockParseBody.mockReturnValue({ success: false, error: "filename: must be string" });
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/db/restore", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      400,
      { success: false, error: { message: "filename: must be string" } },
      expect.any(Object)
    );
  });

  it("POST /api/backup/db/restore succeeds and triggers gracefulShutdown", async () => {
    mockReadBody.mockResolvedValue('{"filename":"old.db"}');
    mockParseBody.mockReturnValue({ success: true, data: { filename: "old.db" } });
    mockRestoreBackup.mockReturnValue({ success: true });
    vi.useFakeTimers();
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/db/restore", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true },
      expect.any(Object)
    );
    vi.runAllTimers();
    expect(mockGracefulShutdown).toHaveBeenCalledWith("RESTORE", 0);
    vi.useRealTimers();
  });

  it("POST /api/backup/db/restore fails", async () => {
    mockReadBody.mockResolvedValue('{"filename":"bad.db"}');
    mockParseBody.mockReturnValue({ success: true, data: { filename: "bad.db" } });
    mockRestoreBackup.mockReturnValue({ success: false, error: "not found" });
    const res = createMockRes();
    const result = await handleBackup(createMockReq(), res, "POST", "/api/backup/db/restore", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "not found" } },
      expect.any(Object)
    );
  });
});
