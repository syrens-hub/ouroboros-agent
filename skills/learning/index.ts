/**
 * Ouroboros Learning Skill
 * ========================
 * Hermes blood: trajectory compression, skill discovery, and background review.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import type {
  TrajectoryEntry,
  Skill,
  SkillFrontmatter,
  Result,
} from "../../types/index.ts";
import { ok, err } from "../../types/index.ts";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { appConfig } from "../../core/config.ts";
import { upsertSkillRegistry } from "../../core/session-db.ts";

let _skillsCache: { data: Skill[]; expiresAt: number } | null = null;
const SKILLS_CACHE_TTL_MS = 5_000;

function getCachedSkills(fn: () => Skill[]): Skill[] {
  const now = Date.now();
  if (_skillsCache && _skillsCache.expiresAt > now) {
    return _skillsCache.data;
  }
  const data = fn();
  _skillsCache = { data, expiresAt: now + SKILLS_CACHE_TTL_MS };
  return data;
}

export function clearSkillsCache(): void {
  _skillsCache = null;
}

// =============================================================================
// Trajectory Compressor (Head+Tail protection + middle summarization)
// =============================================================================

export function createTrajectoryCompressor(): {
  compress(entries: TrajectoryEntry[], targetTokens: number): Promise<Result<TrajectoryEntry[]>>;
} {
  return {
    async compress(entries, targetTokens) {
      if (entries.length <= 4) return ok(entries);

      const protectedHead = 2; // system + first user/assistant
      const protectedTail = 2; // last assistant + tool results
      const middle = entries.slice(protectedHead, entries.length - protectedTail);

      // CJK-aware token estimation
      const estimateTokens = (e: TrajectoryEntry) => {
        const text = JSON.stringify(e.messages);
        // CJK characters (Chinese, Japanese, Korean) are roughly 1 token each
        const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
        const otherCount = text.length - cjkCount;
        return cjkCount + otherCount / 4;
      };

      const currentTokens = entries.reduce((sum, e) => sum + estimateTokens(e), 0);
      if (currentTokens <= targetTokens) return ok(entries);

      // Greedy remove from middle until under budget
      const toCompress: TrajectoryEntry[] = [];
      const preserved: TrajectoryEntry[] = [
        ...entries.slice(0, protectedHead),
        ...entries.slice(entries.length - protectedTail),
      ];

      let budget = targetTokens - preserved.reduce((sum, e) => sum + estimateTokens(e), 0);

      for (const entry of middle) {
        const tokens = estimateTokens(entry);
        if (budget - tokens >= 0) {
          toCompress.push(entry);
          budget -= tokens;
        }
      }

      // Summarize the compressed middle section
      const summaryEntry: TrajectoryEntry = {
        turn: -1,
        messages: [
          {
            role: "system",
            content: `[CONTEXT SUMMARY]: ${toCompress.length} intermediate turns omitted. Key actions: ${toCompress
              .map((e) => e.outcome)
              .join(", ")}.`,
          },
        ],
        toolCalls: [],
        outcome: "compressed",
        summary: `Compressed ${toCompress.length} turns`,
      };

      return ok([...entries.slice(0, protectedHead), summaryEntry, ...entries.slice(entries.length - protectedTail)]);
    },
  };
}

// =============================================================================
// Skill File System (Hermes pattern)
// =============================================================================

const SKILL_DIR = appConfig.skills.dir.startsWith("/") ? appConfig.skills.dir : join(process.cwd(), appConfig.skills.dir);

export function ensureSkillDir(): void {
  if (!existsSync(SKILL_DIR)) {
    mkdirSync(SKILL_DIR, { recursive: true });
  }
}

export function parseSkillFrontmatter(markdown: string): Result<SkillFrontmatter> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return err({ code: "INVALID_SKILL", message: "Missing YAML frontmatter in SKILL.md" });
  }
  try {
    const yaml = match[1];
    const obj: Record<string, unknown> = {};
    for (const line of yaml.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        let val: unknown = line.slice(idx + 1).trim();
        if (val === "true") val = true;
        if (val === "false") val = false;
        if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
          val = val.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
        }
        if (key in obj) {
          if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
          (obj[key] as unknown[]).push(val);
        } else {
          obj[key] = val;
        }
      }
    }
    // zod validate
    const parsed = z.object({
      name: z.string(),
      description: z.string(),
      version: z.string().default("0.1.0"),
      allowedTools: z.array(z.string()).optional(),
      platforms: z.array(z.string()).optional(),
      autoLoad: z.boolean().default(false),
      tags: z.array(z.string()).optional(),
    }).parse(obj);
    return ok(parsed as SkillFrontmatter);
  } catch (e) {
    return err({ code: "YAML_ERROR", message: String(e) });
  }
}

export function discoverSkills(): Skill[] {
  return getCachedSkills(() => {
    ensureSkillDir();
    const skills: Skill[] = [];
    for (const entry of readdirSync(SKILL_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(SKILL_DIR, entry.name);
      const skillPath = join(skillDir, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const content = readFileSync(skillPath, "utf-8");
      const fmResult = parseSkillFrontmatter(content);
      if (!fmResult.success) continue;

      const sourceCodeFiles = new Map<string, string>();
      const codePath = join(skillDir, "index.ts");
      if (existsSync(codePath)) {
        sourceCodeFiles.set("index.ts", readFileSync(codePath, "utf-8"));
      }

      skills.push({
        name: fmResult.data.name,
        frontmatter: fmResult.data,
        markdownBody: content,
        directory: skillDir,
        sourceCodeFiles,
      });
    }
    return skills;
  });
}

export function writeSkill(name: string, markdown: string): Result<void> {
  ensureSkillDir();
  const skillDir = join(SKILL_DIR, name);
  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });
  }
  try {
    writeFileSync(join(skillDir, "SKILL.md"), markdown, "utf-8");
    clearSkillsCache();
    return ok(undefined);
  } catch (e) {
    return err({ code: "WRITE_ERROR", message: String(e) });
  }
}

// =============================================================================
// Learning Tools
// =============================================================================

export const compressTrajectoryTool = buildTool({
  name: "compress_trajectory",
  description: "Compress a list of trajectory entries using head+tail protection and middle summarization.",
  inputSchema: z.object({
    entries: z.array(z.any()),
    targetTokens: z.number().default(4000),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ entries, targetTokens }) {
    const compressor = createTrajectoryCompressor();
    const result = await compressor.compress(entries as TrajectoryEntry[], targetTokens ?? 4000);
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  },
});

export const discoverSkillsTool = buildTool({
  name: "discover_skills",
  description: "Scan the skill directory and return all available skills with metadata.",
  inputSchema: z.object({}),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call() {
    return discoverSkills().map((s) => ({
      name: s.name,
      description: s.frontmatter.description,
      version: s.frontmatter.version,
      tags: s.frontmatter.tags,
    }));
  },
});

export const writeSkillTool = buildTool({
  name: "write_skill",
  description: "Create or overwrite a SKILL.md in the skill directory. Requires valid frontmatter.",
  inputSchema: z.object({
    name: z.string(),
    markdown: z.string(),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async call({ name, markdown }) {
    const fm = parseSkillFrontmatter(markdown);
    if (!fm.success) throw new Error(`Invalid skill frontmatter: ${fm.error.message}`);
    const result = writeSkill(name, markdown);
    if (!result.success) throw new Error(result.error.message);
    const skillDir = join(SKILL_DIR, name);
    await upsertSkillRegistry(name, skillDir, fm.data, fm.data.autoLoad ?? false);
    return { success: true, skill: name };
  },
});

export const readSkillTool = buildTool({
  name: "read_skill",
  description: "Read the raw markdown content of a skill.",
  inputSchema: z.object({ name: z.string() }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ name }) {
    const path = join(SKILL_DIR, name, "SKILL.md");
    if (!existsSync(path)) return { content: null };
    return { content: readFileSync(path, "utf-8") };
  },
});
