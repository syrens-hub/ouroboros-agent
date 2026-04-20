import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { readFileTool, writeFileTool } from "../../skills/file-tools.ts";

const TEST_DIR = join(process.cwd(), ".ouroboros", "test-file-tools-" + Date.now());

describe("file-tools", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("reads existing file", async () => {
    const path = join(TEST_DIR, "a.txt");
    writeFileTool.call({ path, content: "hello" }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] });
    const result = await readFileTool.call({ path }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] });
    expect((result as any).content).toContain("hello");
    expect((result as any).exists).toBe(true);
  });

  it("returns null for missing file", async () => {
    const result = await readFileTool.call({ path: join(TEST_DIR, "missing.txt") }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] });
    expect((result as any).content).toBeNull();
    expect((result as any).exists).toBe(false);
  });

  it("blocks path traversal on read", async () => {
    await expect(
      readFileTool.call({ path: "../etc/passwd" }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] })
    ).rejects.toThrow("Path traversal");
  });

  it("blocks path traversal on write", async () => {
    await expect(
      writeFileTool.call({ path: "../etc/passwd", content: "x" }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] })
    ).rejects.toThrow("Path traversal");
  });

  it("blocks write to protected paths", async () => {
    await expect(
      writeFileTool.call({ path: "package.json", content: "{}" }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] })
    ).rejects.toThrow("protected path");
  });

  it("blocks write to core/", async () => {
    await expect(
      writeFileTool.call({ path: "core/foo.ts", content: "x" }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] })
    ).rejects.toThrow("protected path");
  });

  it("creates directories on write", async () => {
    const path = join(TEST_DIR, "nested", "dir", "file.txt");
    const result = await writeFileTool.call({ path, content: "nested" }, { taskId: "test", abortSignal: new AbortController().signal, reportProgress: () => {}, invokeSubagent: (async () => ({})) as unknown as import("../../types/index.ts").ToolCallContext<unknown>["invokeSubagent"] });
    expect((result as any).success).toBe(true);
    expect(existsSync(path)).toBe(true);
  });
});
