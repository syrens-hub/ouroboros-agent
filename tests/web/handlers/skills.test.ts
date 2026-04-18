import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import { handleSkills } from "../../../web/routes/handlers/skills.ts";
import { createMockRes } from "./mock-res.ts";
import { generateSkillPackage } from "../../../skills/skill-factory/index.ts";

const mockJson = vi.fn();
const mockReadBody = vi.fn();
const mockParseBody = vi.fn();
const mockGetCached = vi.fn();
const mockDiscoverSkills = vi.fn();
const mockInstallSkillToolCall = vi.fn();
const mockGlobalPoolAll = vi.fn();
const mockGlobalPoolReload = vi.fn();
const mockGlobalPoolRegister = vi.fn();

let mockLlmCfg: Record<string, unknown> | undefined = undefined;

vi.mock("../../../web/routes/shared.ts", () => ({
  json: (...args: unknown[]) => mockJson(...args),
  readBody: (...args: unknown[]) => mockReadBody(...args),
  parseBody: (...args: unknown[]) => mockParseBody(...args),
  getCached: (...args: unknown[]) => mockGetCached(...args),
  InstallSkillBodySchema: {},
  ReqContext: {},
}));

vi.mock("../../../web/runner-pool.ts", () => ({
  discoverSkills: (...args: unknown[]) => mockDiscoverSkills(...args),
  installSkillTool: { call: (...args: unknown[]) => mockInstallSkillToolCall(...args) },
  get llmCfg() { return mockLlmCfg; },
  get globalPool() {
    return {
      all: (...args: unknown[]) => mockGlobalPoolAll(...args),
      reload: (...args: unknown[]) => mockGlobalPoolReload(...args),
      register: (...args: unknown[]) => mockGlobalPoolRegister(...args),
    };
  },
}));

vi.mock("../../../skills/skill-factory/index.ts", () => ({
  generateSkillPackage: vi.fn(),
}));

function createMockReq(url = "/") {
  return { url } as IncomingMessage;
}

function ctx() {
  return { requestId: "req-1", startTime: Date.now() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLlmCfg = undefined;
  mockGetCached.mockImplementation((_key: string, _ttl: number, factory: () => unknown) => factory());
});

describe("handleSkills", () => {
  it("returns false for unmatched paths", async () => {
    const result = await handleSkills(createMockReq(), createMockRes(), "GET", "/api/unknown", ctx());
    expect(result).toBe(false);
  });

  it("GET /api/skills returns mapped skill list", async () => {
    mockDiscoverSkills.mockReturnValue([
      {
        name: "skill-a",
        frontmatter: { description: "desc-a", version: "1.0.0", tags: ["tag1"] },
        sourceCodeFiles: new Map([["a.ts", "code"]]),
      },
      {
        name: "skill-b",
        frontmatter: { description: "desc-b" },
        sourceCodeFiles: undefined,
      },
    ]);
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "GET", "/api/skills", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      {
        success: true,
        data: [
          { name: "skill-a", description: "desc-a", version: "1.0.0", tags: ["tag1"], hasCode: true },
          { name: "skill-b", description: "desc-b", version: undefined, tags: [], hasCode: false },
        ],
      },
      expect.any(Object)
    );
  });

  it("POST /api/skills/generate returns 200 success:false when LLM not configured", async () => {
    mockReadBody.mockResolvedValue(JSON.stringify({ skill_name: "test", description: "desc" }));
    mockParseBody.mockReturnValue({ success: true, data: { skill_name: "test", description: "desc" } });
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/generate", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false, error: { message: "LLM not configured" } },
      expect.any(Object)
    );
  });

  it("POST /api/skills/generate returns 400 when schema validation fails", async () => {
    mockReadBody.mockResolvedValue('{"skill_name":1}');
    mockParseBody.mockReturnValue({ success: false, error: "skill_name: must be string" });
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/generate", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      400,
      { success: false, error: { message: "skill_name: must be string" } },
      expect.any(Object)
    );
  });

  it("POST /api/skills/generate succeeds", async () => {
    mockLlmCfg = { model: "test-model" };
    mockReadBody.mockResolvedValue(JSON.stringify({ skill_name: "test", description: "desc" }));
    mockParseBody.mockReturnValue({ success: true, data: { skill_name: "test", description: "desc", force: false } });
    mockGlobalPoolAll.mockReturnValue([]);
    vi.mocked(generateSkillPackage).mockResolvedValue({ success: true, data: { skillName: "test", skillDir: "/tmp/skills/test", toolsLoaded: [] } });
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/generate", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { skillName: "test", skillDir: "/tmp/skills/test", toolsLoaded: [] } },
      expect.any(Object)
    );
    expect(generateSkillPackage).toHaveBeenCalledWith(
      {
        skill_name: "test",
        description: "desc",
        problem_statement: "Auto-generate executable code for skill test",
        example_usage: undefined,
      },
      expect.objectContaining({
        llmCfg: mockLlmCfg,
        existingTools: [],
        force: false,
        onToolsLoaded: expect.any(Function),
      })
    );
  });

  it("POST /api/skills/generate returns 200 with error when generateSkillPackage fails", async () => {
    mockLlmCfg = { model: "test-model" };
    mockReadBody.mockResolvedValue(JSON.stringify({ skill_name: "test", description: "desc" }));
    mockParseBody.mockReturnValue({ success: true, data: { skill_name: "test", description: "desc", force: false } });
    mockGlobalPoolAll.mockReturnValue([]);
    vi.mocked(generateSkillPackage).mockResolvedValue({ success: false, error: { code: "GENERATION_FAILED", message: "generation failed" } } as { success: false; error: { code: string; message: string } });
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/generate", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: false, error: { message: "generation failed" } },
      expect.any(Object)
    );
  });

  it("POST /api/skills/generate returns 500 on exception", async () => {
    mockLlmCfg = { model: "test-model" };
    mockReadBody.mockResolvedValue(JSON.stringify({ skill_name: "test", description: "desc" }));
    mockParseBody.mockReturnValue({ success: true, data: { skill_name: "test", description: "desc", force: false } });
    mockGlobalPoolAll.mockReturnValue([]);
    vi.mocked(generateSkillPackage).mockRejectedValue(new Error("boom"));
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/generate", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "Error: boom" } },
      expect.any(Object)
    );
  });

  it("POST /api/skills/install returns 400 when schema validation fails", async () => {
    mockReadBody.mockResolvedValue('{"source":1}');
    mockParseBody.mockReturnValue({ success: false, error: "source: must be string" });
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/install", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      400,
      { success: false, error: { message: "source: must be string" } },
      expect.any(Object)
    );
  });

  it("POST /api/skills/install succeeds", async () => {
    mockReadBody.mockResolvedValue('{"source":"skill code"}');
    mockParseBody.mockReturnValue({ success: true, data: { source: "skill code" } });
    mockInstallSkillToolCall.mockResolvedValue({ installed: true });
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/install", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      200,
      { success: true, data: { installed: true } },
      expect.any(Object)
    );
    expect(mockInstallSkillToolCall).toHaveBeenCalledWith(
      { source: "skill code" },
      expect.objectContaining({
        taskId: "web",
        abortSignal: expect.any(AbortSignal),
        reportProgress: expect.any(Function),
        invokeSubagent: expect.any(Function),
      })
    );
  });

  it("POST /api/skills/install returns 500 on exception", async () => {
    mockReadBody.mockResolvedValue('{"source":"skill code"}');
    mockParseBody.mockReturnValue({ success: true, data: { source: "skill code" } });
    mockInstallSkillToolCall.mockRejectedValue(new Error("install error"));
    const res = createMockRes();
    const result = await handleSkills(createMockReq(), res, "POST", "/api/skills/install", ctx());
    expect(result).toBe(true);
    expect(mockJson).toHaveBeenCalledWith(
      res,
      500,
      { success: false, error: { message: "Error: install error" } },
      expect.any(Object)
    );
  });
});
