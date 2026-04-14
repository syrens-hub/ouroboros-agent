#!/usr/bin/env tsx
/**
 * Quick connectivity test for the LLM router.
 */

import "dotenv/config";
import { callLLM } from "../core/llm-router.ts";
import type { LLMConfig } from "../core/llm-router.ts";

async function main() {
  const provider = (process.env.LLM_PROVIDER || "local") as LLMConfig["provider"];
  const model = process.env.LLM_MODEL || "mock";
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;

  if (!apiKey && provider !== "local") {
    console.error("❌ No LLM_API_KEY set. Please copy .env.example to .env and fill in your key.");
    process.exit(1);
  }

  const cfg: LLMConfig = {
    provider,
    model,
    apiKey,
    baseUrl,
    temperature: 0.2,
    maxTokens: 256,
  };

  console.log(`Testing LLM: ${provider} / ${model} ...\n`);

  const result = await callLLM(cfg, [
    { role: "system", content: "You are a helpful assistant. Reply in one sentence." },
    { role: "user", content: "Say 'Ouroboros is alive' and nothing else." },
  ], []);

  if (!result.success) {
    console.error("❌ LLM call failed:", result.error);
    process.exit(1);
  }

  const text = typeof result.data.content === "string"
    ? result.data.content
    : (Array.isArray(result.data.content) && result.data.content.find((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")?.text) || "";

  console.log("✅ LLM response:", text.trim());
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
