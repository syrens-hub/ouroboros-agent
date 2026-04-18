import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync,   unlinkSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { selfModifyTool } from "../../skills/self-modify/index.ts";
import * as llmRouter from "../../core/llm-router.ts";
import * as selfHealing from "../../skills/self-healing/index.ts";
import { getDb, resetDbSingleton } from "../../core/db-manager.ts";

const GREET_TOOL_PATH = join(process.cwd(), "skills", "greet-tool", "index.ts");
const GREET_TOOL_DIR = join(process.cwd(), "skills", "greet-tool");

describe("self-evolution e2e", () => {
  let originalContent: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));

    originalContent = readFileSync(GREET_TOOL_PATH, "utf-8");

    // Clear previous modification fingerprints so duplicate patches aren't rejected
    resetDbSingleton();
    const db = getDb();
    db.exec("DELETE FROM modifications");

    // Canary tests spawn a plain Node process which cannot import .ts files.
    // Mock them to pass so the self-modify skill proceeds.
    vi.spyOn(selfHealing, "runCanaryTests").mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();

    // Restore original file content
    writeFileSync(GREET_TOOL_PATH, originalContent, "utf-8");

    // Clean up backup and temp files left by mutateFile
    try {
      for (const file of readdirSync(GREET_TOOL_DIR)) {
        if (file.startsWith("index.ts.bak.") || file.startsWith("index.ts.tmp.")) {
          unlinkSync(join(GREET_TOOL_DIR, file));
        }
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it("reads greet-tool, generates patch via mocked LLM, applies via self-modify, verifies on disk and re-import", async () => {
    // 1. Read current source
    const currentSource = readFileSync(GREET_TOOL_PATH, "utf-8");
    expect(currentSource).toContain("async call({ name, language })");

    // 2. Prepare predetermined patch (simulating LLM output)
    const timestamp = Date.now();
    const oldStr = "    const greetings = {";
    const newStr = `    // evolved-at-${timestamp}\n    const greetings = {`;

    const predeterminedPatch = {
      targetPath: "skills/greet-tool/index.ts",
      operation: "patch",
      old: oldStr,
      new: newStr,
    };

    vi.spyOn(llmRouter, "callLLM").mockResolvedValue({
      success: true,
      data: {
        role: "assistant",
        content: JSON.stringify(predeterminedPatch),
      },
    });

    // Simulate the LLM generating the patch
    const llmResult = await llmRouter.callLLM(
      { provider: "openai", model: "gpt-4o" } as any,
      [
        {
          role: "system",
          content: "You are a self-evolution agent that returns patches as JSON.",
        },
        {
          role: "user",
          content:
            `Current source:\n${currentSource}\n\n` +
            "Generate a patch to add an evolution comment inside the call() function.",
        },
      ],
      []
    );

    if (!llmResult.success) {
      throw new Error("LLM mock did not return success");
    }
    const patchPayload = JSON.parse(llmResult.data.content as string);
    expect(patchPayload.operation).toBe("patch");
    expect(patchPayload.targetPath).toBe("skills/greet-tool/index.ts");

    // 3. Apply via self-modify skill
    const result = await selfModifyTool.call(
      {
        type: "skill_patch",
        skillName: "greet-tool",
        description: "Add evolution timestamp comment",
        proposedChanges: patchPayload,
        rationale: "Testing self-evolution loop with harmless comment",
        estimatedRisk: "low",
      },
      {
        taskId: "test-e2e-self-evolution",
        abortSignal: new AbortController().signal,
        reportProgress: () => {},
        invokeSubagent: async () => ({} as any),
      }
    );

    expect(result.success).toBe(true);
    expect(result.modified).toBe("skills/greet-tool/index.ts");

    // 4. Verify file on disk contains the new comment
    const modifiedSource = readFileSync(GREET_TOOL_PATH, "utf-8");
    expect(modifiedSource).toContain(`// evolved-at-${timestamp}`);

    // 5. Re-import dynamically and verify comment is present in source
    const cacheBust = Date.now();
    const mod = await import(`file://${resolve(GREET_TOOL_PATH)}?cb=${cacheBust}`);
    expect(mod).toBeDefined();
    expect(mod.greetTool).toBeDefined();

    const sourceAfterReimport = readFileSync(GREET_TOOL_PATH, "utf-8");
    expect(sourceAfterReimport).toContain(`// evolved-at-${timestamp}`);

    // 6. Confirm the file actually changed
    expect(modifiedSource).not.toBe(originalContent);
  });
});
