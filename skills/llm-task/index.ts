/**
 * LLM Task Tool
 * =============
 * Structured LLM sub-task execution with optional JSON schema validation.
 * Inspired by OpenClaw's llm-task extension.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { callLLMWithResilience } from "../../core/llm-resilience.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import type { BaseMessage } from "../../types/index.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";

export const llmTaskTool = buildTool({
  name: "llm_task",
  description:
    "Run a structured LLM sub-task with optional JSON output validation. " +
    "Useful when you need a pure function-like LLM call without tool execution.",
  inputSchema: z.object({
    prompt: z.string().describe("The task instruction for the LLM"),
    input: z.record(z.unknown()).optional().describe("Optional structured input data"),
    outputSchema: z.record(z.unknown()).optional().describe("Optional JSON Schema object for output validation"),
    model: z.string().optional().describe("Override model name"),
    temperature: z.number().optional().describe("Override temperature"),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  costProfile: { latency: "variable", cpuIntensity: "low", externalCost: "medium", tokenEstimate: 2048 },
  async call({ prompt, input, outputSchema, model, temperature }) {
    const cfg: LLMConfig = {
      provider: (process.env.LLM_PROVIDER as LLMConfig["provider"]) || "local",
      model: model || process.env.LLM_MODEL || "mock",
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL,
      temperature: temperature ?? (process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0.2),
      maxTokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS, 10) : 4096,
    };

    const userContent = input ? `${prompt}\n\nInput:\n${JSON.stringify(input, null, 2)}` : prompt;
    const messages: BaseMessage[] = [
      {
        role: "system",
        content:
          "You are a precise task executor. " +
          (outputSchema
            ? "Respond with valid JSON that matches the expected schema. No extra commentary outside the JSON."
            : "Follow the instruction carefully."),
      },
      { role: "user", content: userContent },
    ];

    const result = await callLLMWithResilience(cfg, messages, []);
    if (!result.success) {
      return { success: false, error: result.error.message };
    }

    const text =
      typeof result.data.content === "string"
        ? result.data.content
        : Array.isArray(result.data.content)
          ? result.data.content
              .filter((b): b is { type: "text"; text: string } =>
                typeof b === "object" && b !== null && (b as { type?: string }).type === "text"
              )
              .map((b) => (b as { text: string }).text)
              .join("\n")
          : JSON.stringify(result.data.content);

    let parsed: unknown = null;
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    parsed = safeJsonParse(jsonStr, "llm task response") ?? null;

    if (outputSchema && parsed) {
      const requiredKeys = Object.keys(outputSchema);
      if (requiredKeys.length > 0 && typeof parsed === "object" && parsed !== null) {
        const missing = requiredKeys.filter((k) => !(k in (parsed as Record<string, unknown>)));
        if (missing.length > 0) {
          return { success: false, raw: text, error: `Missing keys: ${missing.join(", ")}` };
        }
      }
    }

    return { success: true, raw: text, parsed };
  },
});
