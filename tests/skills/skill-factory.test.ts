import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  generateSkillPackage,
  loadSkillModule,
  extractToolsFromModule,
} from "../../skills/skill-factory/index.ts";

const TEST_SKILL_NAME = `test-generated-skill-${Date.now()}`;
const TEST_SKILL_DIR = join(process.cwd(), "skills", TEST_SKILL_NAME);

vi.mock("../../core/llm-router.ts", async () => {
  return {
    callLLM: vi.fn(),
  };
});

import { callLLM } from "../../core/llm-router.ts";

function mockLLMResponse(text: string) {
  (callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    data: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  });
}

function cleanup() {
  if (existsSync(TEST_SKILL_DIR)) {
    rmSync(TEST_SKILL_DIR, { recursive: true, force: true });
  }
}

describe("Skill Factory", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("generates a skill package and writes files to disk", async () => {
    mockLLMResponse(
      `===SKILL_MD===\n---\nname: ${TEST_SKILL_NAME}\ndescription: A test skill\nversion: 0.1.0\ntags: [generated]\n---\n\nTest body\n===INDEX_TS===\nimport { z } from "zod";\nimport { buildTool } from "../../core/tool-framework.ts";\n\nexport const testTool = buildTool({\n  name: "test_tool",\n  description: "A test tool",\n  inputSchema: z.object({}),\n  isReadOnly: true,\n  isConcurrencySafe: true,\n  async call() {\n    return { ok: true };\n  },\n});\n\nexport default testTool;\n===END===`
    );

    const result = await generateSkillPackage(
      {
        skill_name: TEST_SKILL_NAME,
        description: "A test skill",
        problem_statement: "Need a test skill",
      },
      {
        llmCfg: { provider: "openai", model: "gpt-4o", apiKey: "sk-test" },
        existingTools: [],
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.skillName).toBe(TEST_SKILL_NAME);
    expect(existsSync(join(TEST_SKILL_DIR, "SKILL.md"))).toBe(true);
    expect(existsSync(join(TEST_SKILL_DIR, "index.ts"))).toBe(true);
    expect(result.data.toolsLoaded).toContain("test_tool");
  });

  it("rejects when LLM response format is invalid", async () => {
    mockLLMResponse("This is not a valid response format.");

    const result = await generateSkillPackage(
      {
        skill_name: TEST_SKILL_NAME,
        description: "A test skill",
        problem_statement: "Need a test skill",
      },
      {
        llmCfg: { provider: "openai", model: "gpt-4o", apiKey: "sk-test" },
        existingTools: [],
      }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PARSE_ERROR");
    }
    expect(existsSync(TEST_SKILL_DIR)).toBe(false);
  });

  it("rejects and cleans up when generated code has syntax errors", async () => {
    mockLLMResponse(
      `===SKILL_MD===\n---\nname: ${TEST_SKILL_NAME}\ndescription: Bad skill\nversion: 0.1.0\ntags: [generated]\n---\n\nBad body\n===INDEX_TS===\nthis is not valid typescript!!!\n===END===`
    );

    const result = await generateSkillPackage(
      {
        skill_name: TEST_SKILL_NAME,
        description: "Bad skill",
        problem_statement: "Need a bad skill",
      },
      {
        llmCfg: { provider: "openai", model: "gpt-4o", apiKey: "sk-test" },
        existingTools: [],
      }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("QUALITY_ERROR");
    }
    // Directory should not exist (cleanup or never written)
    expect(existsSync(TEST_SKILL_DIR)).toBe(false);
  });

  it("rejects when skill already exists and force is false", async () => {
    mkdirSync(TEST_SKILL_DIR, { recursive: true });

    const result = await generateSkillPackage(
      {
        skill_name: TEST_SKILL_NAME,
        description: "A test skill",
        problem_statement: "Need a test skill",
      },
      {
        llmCfg: { provider: "openai", model: "gpt-4o", apiKey: "sk-test" },
        existingTools: [],
        force: false,
      }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("ALREADY_EXISTS");
    }
  });

  it("extracts tools from a valid module", async () => {
    // Use a known existing skill for this test
    const mod = await loadSkillModule(join(process.cwd(), "skills", "greet-tool"));
    const tools = extractToolsFromModule(mod);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "greet")).toBe(true);
  });

  it("returns empty array for module with no tools", async () => {
    const tools = extractToolsFromModule({ foo: "bar", default: {} });
    expect(tools).toEqual([]);
  });
});
