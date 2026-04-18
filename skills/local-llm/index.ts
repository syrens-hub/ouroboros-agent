/**
 * Local LLM Skill
 * ===============
 * One-click local mode with Ollama.
 * Detects, installs, and switches the agent to use a local Ollama endpoint.
 */

import { spawn } from "child_process";
import { appConfig } from "../../core/config.ts";
import type { Result } from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";

export interface RecommendedModel {
  name: string;
  size: string;
  description: string;
}

/**
 * Check whether the `ollama` binary is available and `ollama list` works.
 */
export function detectOllama(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn("ollama", ["list"], { stdio: "pipe" });
      let _stderr = "";
      proc.stderr?.on("data", (d) => {
        _stderr += String(d);
      });
      proc.on("error", () => {
        resolve(false);
      });
      proc.on("close", (code) => {
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Pull a model if it is not already present locally.
 */
export function ensureModel(modelName: string): Promise<boolean> {
  return new Promise((resolve) => {
    // First check if model already exists
    try {
      const listProc = spawn("ollama", ["list"], { stdio: "pipe" });
      let stdout = "";
      listProc.stdout?.on("data", (d) => {
        stdout += String(d);
      });
      listProc.on("error", () => {
        resolve(false);
      });
      listProc.on("close", (code) => {
        if (code !== 0) {
          resolve(false);
          return;
        }
        const lines = stdout.split("\n");
        const exists = lines.some((line) => line.trim().startsWith(modelName));
        if (exists) {
          resolve(true);
          return;
        }
        // Model not present — pull it
        try {
          const pullProc = spawn("ollama", ["pull", modelName], { stdio: "pipe" });
          let _pullErr = "";
          pullProc.stderr?.on("data", (d) => {
            _pullErr += String(d);
          });
          pullProc.on("error", () => {
            resolve(false);
          });
          pullProc.on("close", (pullCode) => {
            resolve(pullCode === 0);
          });
        } catch {
          resolve(false);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Return the default local Ollama API URL.
 */
export function getLocalModelUrl(): string {
  return "http://localhost:11434";
}

/**
 * Return a curated list of recommended Ollama models.
 */
export function listRecommendedModels(): RecommendedModel[] {
  return [
    {
      name: "qwen2.5:7b",
      size: "~4.7 GB",
      description: "General chat — fast, capable, good default",
    },
    {
      name: "codeqwen:14b",
      size: "~9.0 GB",
      description: "Coding — strong code generation and reasoning",
    },
    {
      name: "llama3.1:8b",
      size: "~4.7 GB",
      description: "Reasoning — balanced performance for most tasks",
    },
    {
      name: "llama3.1:70b",
      size: "~40 GB",
      description: "Complex tasks — best quality if you have the VRAM",
    },
  ];
}

/**
 * Switch the running configuration to local Ollama mode.
 * Optionally ensures the preferred model is pulled first.
 */
export async function switchToLocalMode(
  preferredModel?: string
): Promise<Result<void>> {
  const model = preferredModel || "qwen2.5:7b";

  const hasOllama = await detectOllama();
  if (!hasOllama) {
    return err({
      code: "OLLAMA_NOT_FOUND",
      message:
        "Ollama is not installed or not running. Install from https://ollama.com",
    });
  }

  const modelReady = await ensureModel(model);
  if (!modelReady) {
    return err({
      code: "MODEL_PULL_FAILED",
      message: `Failed to ensure model "${model}" is available.`,
    });
  }

  // Update environment for downstream processes
  process.env.LLM_PROVIDER = "local";
  process.env.LLM_BASE_URL = getLocalModelUrl();
  process.env.LLM_MODEL = model;

  // Update in-memory config so the current process picks it up immediately
  appConfig.llm.provider = "local";
  appConfig.llm.baseUrl = getLocalModelUrl();
  appConfig.llm.model = model;

  return ok(undefined);
}
