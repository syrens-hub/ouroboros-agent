import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectOllama,
  ensureModel,
  getLocalModelUrl,
  listRecommendedModels,
  switchToLocalMode,
} from "../../../skills/local-llm/index.ts";

// Mock child_process so we never spawn real Ollama commands in tests
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn } from "child_process";

function createMockProc(options: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
}) {
  const handlers: Record<string, Array<(data?: unknown) => void>> = {};
  const proc = {
    stdout: {
      on: (event: string, cb: (data: unknown) => void) => {
        handlers[`stdout:${event}`] = handlers[`stdout:${event}`] || [];
        handlers[`stdout:${event}`].push(cb);
      },
    },
    stderr: {
      on: (event: string, cb: (data: unknown) => void) => {
        handlers[`stderr:${event}`] = handlers[`stderr:${event}`] || [];
        handlers[`stderr:${event}`].push(cb);
      },
    },
    on: (event: string, cb: (data?: unknown) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
    },
    emit: (event: string, data?: unknown) => {
      (handlers[event] || []).forEach((cb) => cb(data));
    },
  };

  // Defer emission so callers can attach listeners first
  setTimeout(() => {
    if (options.error) {
      proc.emit("error", options.error);
      return;
    }
    if (options.stdout) {
      (handlers["stdout:data"] || []).forEach((cb) => cb(options.stdout));
    }
    if (options.stderr) {
      (handlers["stderr:data"] || []).forEach((cb) => cb(options.stderr));
    }
    proc.emit("close", options.exitCode);
  }, 0);

  return proc;
}

describe("local-llm skill", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("detectOllama", () => {
    it("returns true when ollama list exits 0", async () => {
      (spawn as any).mockReturnValue(
        createMockProc({ exitCode: 0, stdout: "NAME\tqwen2.5:7b\n" })
      );
      const result = await detectOllama();
      expect(result).toBe(true);
      expect(spawn).toHaveBeenCalledWith("ollama", ["list"], { stdio: "pipe" });
    });

    it("returns false when ollama list exits non-zero", async () => {
      (spawn as any).mockReturnValue(createMockProc({ exitCode: 1 }));
      const result = await detectOllama();
      expect(result).toBe(false);
    });

    it("returns false when spawn throws", async () => {
      (spawn as any).mockImplementation(() => {
        throw new Error("spawn ENOENT");
      });
      const result = await detectOllama();
      expect(result).toBe(false);
    });
  });

  describe("ensureModel", () => {
    it("returns true immediately if model already exists", async () => {
      (spawn as any).mockReturnValue(
        createMockProc({
          exitCode: 0,
          stdout: "qwen2.5:7b\t1234\t4.7 GB\n",
        })
      );
      const result = await ensureModel("qwen2.5:7b");
      expect(result).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith("ollama", ["list"], { stdio: "pipe" });
    });

    it("pulls model if not present and returns true on success", async () => {
      (spawn as any)
        .mockReturnValueOnce(
          createMockProc({ exitCode: 0, stdout: "other-model\t1234\t4.7 GB\n" })
        )
        .mockReturnValueOnce(createMockProc({ exitCode: 0 }));
      const result = await ensureModel("qwen2.5:7b");
      expect(result).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(spawn).toHaveBeenLastCalledWith(
        "ollama",
        ["pull", "qwen2.5:7b"],
        { stdio: "pipe" }
      );
    });

    it("returns false when pull fails", async () => {
      (spawn as any)
        .mockReturnValueOnce(
          createMockProc({ exitCode: 0, stdout: "other-model\t1234\t4.7 GB\n" })
        )
        .mockReturnValueOnce(createMockProc({ exitCode: 1 }));
      const result = await ensureModel("qwen2.5:7b");
      expect(result).toBe(false);
    });
  });

  describe("getLocalModelUrl", () => {
    it("returns localhost:11434", () => {
      expect(getLocalModelUrl()).toBe("http://localhost:11434");
    });
  });

  describe("listRecommendedModels", () => {
    it("returns four recommended models", () => {
      const models = listRecommendedModels();
      expect(models).toHaveLength(4);
      expect(models.map((m) => m.name)).toEqual([
        "qwen2.5:7b",
        "codeqwen:14b",
        "llama3.1:8b",
        "llama3.1:70b",
      ]);
    });
  });

  describe("switchToLocalMode", () => {
    it("returns error when Ollama is not detected", async () => {
      (spawn as any).mockReturnValue(createMockProc({ exitCode: 1 }));
      const result = await switchToLocalMode();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("OLLAMA_NOT_FOUND");
      }
    });

    it("switches config to local mode when Ollama and model are ready", async () => {
      (spawn as any).mockImplementation(() =>
        createMockProc({ exitCode: 0, stdout: "qwen2.5:7b\t1234\t4.7 GB\n" })
      );
      const result = await switchToLocalMode("qwen2.5:7b");
      expect(result.success).toBe(true);
      expect(process.env.LLM_PROVIDER).toBe("local");
      expect(process.env.LLM_BASE_URL).toBe("http://localhost:11434");
      expect(process.env.LLM_MODEL).toBe("qwen2.5:7b");
    });
  });
});
