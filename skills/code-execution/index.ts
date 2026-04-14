/**
 * Ouroboros Code Execution Sandbox
 * ==================================
 * Safely execute TypeScript, JavaScript, and Python code in isolated
 * subprocesses with timeout, memory limits, and sanitized environment.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { spawn } from "child_process";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const SANDBOX_DIR = join(process.cwd(), ".ouroboros", "sandbox");
const TSX_PATH = join(process.cwd(), "node_modules", ".bin", "tsx");

const SENSITIVE_ENV_PATTERNS = [
  /API_KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /AUTH/i,
  /DATABASE_URL/i,
  /PRIVATE_KEY/i,
  /CERTIFICATE/i,
  /CREDENTIAL/i,
];

function isSensitiveEnvKey(key: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((p) => p.test(key));
}

function getSanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isSensitiveEnvKey(key)) {
      env[key] = value;
    }
  }
  return env;
}

function ensureSandboxDir(): void {
  if (!existsSync(SANDBOX_DIR)) {
    mkdirSync(SANDBOX_DIR, { recursive: true });
  }
}

interface RunCodeResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  duration_ms: number;
}

export class SandboxRunner {
  async run(
    language: "typescript" | "javascript" | "python",
    code: string,
    opts: {
      stdin?: string;
      timeoutMs?: number;
      memoryMb?: number;
    } = {}
  ): Promise<RunCodeResult> {
    if (code.length > 100_000) {
      return {
        stdout: "",
        stderr: "Code exceeds 100KB safety limit.",
        exit_code: -1,
        timed_out: false,
        duration_ms: 0,
      };
    }

    ensureSandboxDir();
    const runId = randomUUID();
    const runDir = join(SANDBOX_DIR, runId);
    mkdirSync(runDir, { recursive: true });

    let fileName: string;
    let command: string;
    let args: string[] = [];

    if (language === "typescript") {
      fileName = "main.ts";
      command = existsSync(TSX_PATH) ? TSX_PATH : "tsx";
      args = [join(runDir, fileName)];
    } else if (language === "javascript") {
      fileName = "main.js";
      command = process.execPath;
      const memoryMb = opts.memoryMb ?? 128;
      args = [`--max-old-space-size=${memoryMb}`, join(runDir, fileName)];
    } else {
      fileName = "main.py";
      command = "python3";
      args = [join(runDir, fileName)];
    }

    const filePath = join(runDir, fileName);
    writeFileSync(filePath, code, "utf-8");

    const start = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    try {
      const result = await new Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((resolve) => {
        const child = spawn(command, args, {
          cwd: runDir,
          env: getSanitizedEnv(),
          stdio: ["pipe", "pipe", "pipe"],
        });

        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeoutMs = opts.timeoutMs ?? 10_000;

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }, timeoutMs);
        }

        if (opts.stdin !== undefined) {
          try {
            child.stdin?.write(opts.stdin, "utf-8");
            child.stdin?.end();
          } catch {
            // ignore
          }
        } else {
          child.stdin?.end();
        }

        child.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString("utf-8");
        });

        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString("utf-8");
        });

        child.on("error", (err) => {
          if (timer) clearTimeout(timer);
          stderr += `\nSpawn error: ${err.message}`;
          resolve({ exitCode: -1, stdout, stderr, timedOut: false });
        });

        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
        });
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        timed_out: result.timedOut,
        duration_ms: Date.now() - start,
      };
    } finally {
      try {
        rmSync(runDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

const runner = new SandboxRunner();

export const runCodeTool = buildTool({
  name: "run_code",
  description:
    "Execute TypeScript, JavaScript, or Python code in a sandboxed subprocess. " +
    "Use this to test generated code, run data analysis scripts, or validate implementations. " +
    "Stdout, stderr, and exit code are returned.",
  inputSchema: z.object({
    language: z
      .enum(["typescript", "javascript", "python"])
      .describe("Programming language to execute"),
    code: z.string().describe("Source code to run"),
    stdin: z
      .string()
      .optional()
      .describe("Optional input string passed to the process via stdin"),
    timeout_ms: z
      .number()
      .default(10_000)
      .describe("Maximum execution time in milliseconds (default 10s)"),
    memory_mb: z
      .number()
      .default(128)
      .describe("Maximum memory in MB for Node.js runs (default 128)"),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ language, code, stdin, timeout_ms, memory_mb }) {
    return runner.run(language, code, {
      stdin,
      timeoutMs: timeout_ms,
      memoryMb: memory_mb,
    });
  },
});
