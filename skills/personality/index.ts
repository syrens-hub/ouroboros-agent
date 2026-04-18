/**
 * Personality Evolution Skill
 * ===========================
 * Ports OpenClaw's PersonalityEvolution into Ouroboros as a Skill.
 * Uses SQLite for anchor memory persistence.
 *
 * This file is a backward-compatible facade. Implementation lives in sub-modules.
 */

export {
  type PersonalityTraits,
  type Values,
  type PersonalityState,
  type InteractionRecord,
  type LearningEvent,
  DEFAULT_TRAITS,
  DEFAULT_VALUES,
  PersonalityEvolution,
  createPersonalityEvolution,
  recordFeedbackTool,
  getPersonalityStateTool,
} from "./personality-core.ts";

export { type AnchorMemory } from "./anchor-store.ts";

export {
  buildPersonalityPrompt,
  generatePersonalityDescription,
} from "./prompt-engine.ts";

export {
  insertAnchor,
  reinforceAnchor,
  getAnchors,
  getRelevantAnchors,
  deleteSessionAnchors,
} from "./anchor-store.ts";

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { insertAnchor, getAnchors } from "./anchor-store.ts";

export async function syncSoulMd(sessionId: string): Promise<void> {
  const soulPath = join(homedir(), ".openclaw", "workspace", "SOUL.md");
  if (!existsSync(soulPath)) {
    return;
  }

  const text = readFileSync(soulPath, "utf-8");

  // Parse first H1 as persona
  const h1Match = text.match(/^#\s+(.+)$/m);
  const persona = h1Match ? h1Match[1].trim() : undefined;

  // Parse Vibe section
  const vibeMatch = text.match(/(?:^|\n)##\s+Vibe\s*\n([\s\S]*?)(?:\n##|\n*$)/i);
  const voice = vibeMatch ? vibeMatch[1].trim() : undefined;

  // Parse Core Truths section
  const coreTruthsMatch = text.match(/(?:^|\n)##\s+Core Truths\s*\n([\s\S]*?)(?:\n##|\n*$)/i);
  const values = coreTruthsMatch ? coreTruthsMatch[1].trim() : undefined;

  const existing = getAnchors(sessionId);

  function alreadyHas(content: string): boolean {
    return existing.some((a) => a.content.includes(content) || content.includes(a.content));
  }

  if (persona && !alreadyHas(persona)) {
    insertAnchor(sessionId, { content: `Persona: ${persona}`, category: "value", importance: 0.95 });
  }
  if (voice && !alreadyHas(voice)) {
    insertAnchor(sessionId, { content: `Voice: ${voice}`, category: "value", importance: 0.9 });
  }
  if (values && !alreadyHas(values)) {
    insertAnchor(sessionId, { content: `Core Truths: ${values}`, category: "value", importance: 0.95 });
  }
}
