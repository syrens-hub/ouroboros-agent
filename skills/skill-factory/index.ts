/**
 * Ouroboros Skill Factory
 * =======================
 * Automatically generate executable skills (SKILL.md + index.ts),
 * write them to disk, hot-load the module, and extract tools.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { callLLM } from "../../core/llm-router.ts";
import type { Tool, Result, BaseMessage } from "../../types/index.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import { ok, err } from "../../types/index.ts";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join, resolve, basename, extname } from "path";
import { createHash } from "crypto";
import { appConfig } from "../../core/config.ts";
import { upsertSkillRegistry } from "../../core/session-db.ts";
import { parseSkillFrontmatter, clearSkillsCache } from "../learning/index.ts";

// =============================================================================
// Hot-Reload Helper (inline copy to avoid importing server-side modules)
// =============================================================================

const HOT_RELOAD_DIR = join(
  appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir),
  "hot-reload"
);

function ensureHotReloadDir() {
  if (!existsSync(HOT_RELOAD_DIR)) {
    mkdirSync(HOT_RELOAD_DIR, { recursive: true });
  }
}

function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function hotImport<T>(filePath: string): Promise<T> {
  ensureHotReloadDir();
  const resolved = resolve(filePath);
  const hash = computeFileHash(resolved);
  const ext = extname(resolved);
  const base = basename(resolved, ext);
  const tempPath = join(HOT_RELOAD_DIR, `${base}-${hash}${ext}`);
  copyFileSync(resolved, tempPath);

  // Best-effort cleanup of old temp files (keep last 20)
  try {
    const files = existsSync(HOT_RELOAD_DIR)
      ? readdirSync(HOT_RELOAD_DIR)
          .filter((f) => f.startsWith(base + "-"))
          .map((f) => ({ name: f, mtime: statSync(join(HOT_RELOAD_DIR, f)).mtime.getTime() }))
          .sort((a, b) => b.mtime - a.mtime)
      : [];
    for (const old of files.slice(20)) {
      try {
        rmSync(join(HOT_RELOAD_DIR, old.name));
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore cleanup errors
  }

  const mod = await import("file://" + tempPath);
  return mod as T;
}

// =============================================================================
// LLM Prompt for Skill Generation
// =============================================================================

const SKILL_GENERATION_PROMPT = `You are the Ouroboros Skill Factory.
Your task is to generate a complete, executable Ouroboros skill based on the user's specification.

A skill consists of:
1. SKILL.md — metadata frontmatter + human-readable documentation
2. index.ts — TypeScript code exporting one or more tools using buildTool

Rules:
- The tool MUST be self-contained. Use only Node.js built-ins, zod, and the provided framework.
- Do NOT invent tools that already exist (check the existing tools list below).
- Keep the implementation simple and robust. Handle errors gracefully.
- Export each tool as a named export. Optionally also export default.
- Use relative imports: import { buildTool } from "../../core/tool-framework.ts";

Example index.ts:
\`\`\`ts
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

export const myTool = buildTool({
  name: "my_tool",
  description: "Does something useful.",
  inputSchema: z.object({
    input: z.string(),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ input }) {
    return { result: input.toUpperCase() };
  },
});

export default myTool;
\`\`\`

Respond ONLY in the following format (no extra text before or after):

===SKILL_MD===
---
name: <skill-name>
description: <one-line description>
version: 0.1.0
tags: [generated, autonomous]
---

<markdown body describing the skill and its tools>
===INDEX_TS===
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

<typescript code>
===END===`;

function buildGenerationMessages(
  spec: SkillSpec,
  existingTools: Tool<unknown, unknown, unknown>[]
): BaseMessage[] {
  const toolList = existingTools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");
  return [
    { role: "system", content: SKILL_GENERATION_PROMPT },
    {
      role: "user",
      content:
        `Existing tools (do not duplicate):\n${toolList || "(none)"}\n\n` +
        `Skill name: ${spec.skill_name}\n` +
        `Description: ${spec.description}\n` +
        `Problem / gap: ${spec.problem_statement}\n` +
        (spec.example_usage ? `Example usage: ${spec.example_usage}\n` : ""),
    },
  ];
}

function parseGenerationResponse(text: string): { skillMd: string; indexTs: string } | null {
  const mdMatch = text.match(/===SKILL_MD===\n([\s\S]*?)\n===INDEX_TS===/);
  const tsMatch = text.match(/===INDEX_TS===\n([\s\S]*?)\n===END===/);
  if (!mdMatch || !tsMatch) return null;
  return { skillMd: mdMatch[1].trim(), indexTs: tsMatch[1].trim() };
}

// =============================================================================
// Types
// =============================================================================

export interface SkillSpec {
  skill_name: string;
  description: string;
  problem_statement: string;
  example_usage?: string;
}

export interface GenerateSkillOptions {
  llmCfg?: LLMConfig;
  existingTools?: Tool<unknown, unknown, unknown>[];
  force?: boolean;
  onToolsLoaded?: (tools: Tool<unknown, unknown, unknown>[]) => void;
}

export interface GenerateSkillResult {
  skillName: string;
  skillDir: string;
  toolsLoaded: string[];
}

// =============================================================================
// Module Loading & Tool Extraction
// =============================================================================

export async function loadSkillModule(skillDir: string): Promise<Record<string, unknown>> {
  const codePath = join(skillDir, "index.ts");
  if (!existsSync(codePath)) {
    throw new Error(`Skill code not found at ${codePath}`);
  }
  return hotImport<Record<string, unknown>>(codePath);
}

export function extractToolsFromModule(mod: Record<string, unknown>): Tool<unknown, unknown, unknown>[] {
  const tools: Tool<unknown, unknown, unknown>[] = [];
  for (const [key, value] of Object.entries(mod)) {
    if (key === "default") continue;
    if (
      value &&
      typeof value === "object" &&
      "name" in value &&
      typeof (value as { name?: unknown }).name === "string" &&
      "description" in value &&
      typeof (value as { description?: unknown }).description === "string" &&
      "inputSchema" in value &&
      "call" in value &&
      typeof (value as { call?: unknown }).call === "function"
    ) {
      tools.push(value as Tool<unknown, unknown, unknown>);
    }
  }
  return tools;
}

// =============================================================================
// Core Generation Flow
// =============================================================================

export async function generateSkillPackage(
  spec: SkillSpec,
  opts: GenerateSkillOptions = {}
): Promise<Result<GenerateSkillResult>> {
  const llmCfg = opts.llmCfg;
  if (!llmCfg || !llmCfg.apiKey) {
    return err({ code: "NO_LLM", message: "LLM not configured. Cannot generate skills." });
  }

  const skillName = spec.skill_name.replace(/\s+/g, "-").toLowerCase();
  const skillDir = join(process.cwd(), "skills", skillName);

  if (existsSync(skillDir) && !opts.force) {
    return err({ code: "ALREADY_EXISTS", message: `Skill ${skillName} already exists. Use force=true to overwrite.` });
  }

  // 1) Call LLM
  const messages = buildGenerationMessages(spec, opts.existingTools ?? []);
  const llmRes = await callLLM(llmCfg, messages, []);
  if (!llmRes.success) {
    return err({ code: "LLM_ERROR", message: llmRes.error.message });
  }

  let text = "";
  if (typeof llmRes.data.content === "string") {
    text = llmRes.data.content;
  } else {
    text = llmRes.data.content
      .filter((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
      .map((b) => b.text)
      .join("");
  }

  const parsed = parseGenerationResponse(text);
  if (!parsed) {
    return err({ code: "PARSE_ERROR", message: "LLM response did not follow the required format." });
  }

  // Validate frontmatter
  const fm = parseSkillFrontmatter(parsed.skillMd);
  if (!fm.success) {
    return err({ code: "INVALID_FRONTMATTER", message: fm.error.message });
  }

  // Validate size before writing
  if (parsed.indexTs.length > 50_000) {
    return err({ code: "SIZE_ERROR", message: "Generated index.ts exceeds 50KB safety limit." });
  }

  // 2) Write files
  try {
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }
    writeFileSync(join(skillDir, "SKILL.md"), parsed.skillMd, "utf-8");
    writeFileSync(join(skillDir, "index.ts"), parsed.indexTs, "utf-8");
  } catch (e) {
    // cleanup on failure
    try {
      rmSync(skillDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return err({ code: "WRITE_ERROR", message: String(e) });
  }

  // 3) Hot-load and extract tools
  let tools: Tool<unknown, unknown, unknown>[] = [];
  try {
    const mod = await loadSkillModule(skillDir);
    tools = extractToolsFromModule(mod);
  } catch (e) {
    // cleanup on load failure
    try {
      rmSync(skillDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return err({ code: "LOAD_ERROR", message: `Generated code failed to load: ${String(e)}` });
  }

  // 4) Register in DB and cache
  clearSkillsCache();
  await upsertSkillRegistry(skillName, skillDir, fm.data, fm.data.autoLoad ?? false);

  // 5) Notify caller
  if (opts.onToolsLoaded) {
    opts.onToolsLoaded(tools);
  }

  return ok({
    skillName,
    skillDir,
    toolsLoaded: tools.map((t) => t.name),
  });
}

// =============================================================================
// Tool Wrapper
// =============================================================================

export function createGenerateSkillTool(deps: {
  getLLMConfig: () => LLMConfig | undefined;
  getGlobalTools: () => Tool<unknown, unknown, unknown>[];
  onToolsLoaded: (tools: Tool<unknown, unknown, unknown>[]) => void;
}) {
  return buildTool({
    name: "generate_skill",
    description:
      "Generate a new executable skill (SKILL.md + index.ts) using the LLM, write it to disk, " +
      "hot-load the module, and register any exported tools into the global pool.",
    inputSchema: z.object({
      skill_name: z.string().describe("Lowercase kebab-case skill name."),
      description: z.string().describe("One-line description of what the skill does."),
      problem_statement: z.string().describe("The concrete task or capability gap this skill solves."),
      example_usage: z.string().optional().describe("An example input and expected output."),
      force: z.boolean().default(false).describe("Overwrite existing skill with the same name."),
    }),
    isReadOnly: false,
    isConcurrencySafe: false,
    async call({ skill_name, description, problem_statement, example_usage, force }, _ctx) {
      const result = await generateSkillPackage(
        { skill_name, description, problem_statement, example_usage },
        {
          llmCfg: deps.getLLMConfig(),
          existingTools: deps.getGlobalTools(),
          force,
          onToolsLoaded: deps.onToolsLoaded,
        }
      );
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}
