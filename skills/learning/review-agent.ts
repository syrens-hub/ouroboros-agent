/**
 * Ouroboros Background Review Agent
 * =================================
 * Hermes blood core: after a conversation turn ends, a background agent
 * reviews the trajectory and decides whether to create, patch, or delete skills.
 *
 * This is non-blocking and runs after the user has already received the
 * main response.
 */

import type { BaseMessage, Result } from "../../types/index.ts";
import type { LLMConfig } from "../../core/llm-router.ts";
import { ok, err } from "../../types/index.ts";
import { callAuxiliary } from "../../core/auxiliary-llm.ts";
import { saveTrajectory, getMessages, logModification, upsertSkillRegistry } from "../../core/session-db.ts";
import { writeSkill, createTrajectoryCompressor } from "./index.ts";
import { defaultRuleEngine } from "../../core/rule-engine.ts";
import { join } from "path";

// =============================================================================
// Review Prompt
// =============================================================================

const REVIEW_PROMPT = `You are the Ouroboros Background Review Agent.
Your job is to analyze a completed conversation trajectory and decide if any reusable knowledge should be saved as a Skill.

A Skill is a markdown file with YAML frontmatter (name, description, version, tags) followed by instructions or patterns.

Rules:
1. CREATE a skill ONLY when:
   - A complex task succeeded (multiple tool calls, iterative problem solving)
   - A non-trivial pattern emerged that is likely reusable in future sessions
   - The user explicitly asked to "learn", "remember", or "save as skill"
2. PATCH an existing skill when:
   - The trajectory shows an improved version of an already-known pattern
   - The existing skill name is known and the change is incremental
3. DELETE is rarely used; only suggest it if a skill is completely obsolete and harmful.
4. If nothing is worth saving, reply with exactly: NO_ACTION

When you decide to CREATE or PATCH, respond in this exact format:

ACTION: create|patch|delete
SKILL_NAME: lowercase-name
DESCRIPTION: one-line description
MARKDOWN:
---
name: lowercase-name
description: one-line description
version: 0.1.0
tags: [tag1, tag2]
---

[skill body here]

END

Be concise. The skill body should be instructions or patterns, not a raw transcript.
`;

// =============================================================================
// Review Types
// =============================================================================

export interface ReviewDecision {
  action: "create" | "patch" | "delete" | "no_action";
  skillName?: string;
  description?: string;
  markdown?: string;
}

// =============================================================================
// Parse Review Response
// =============================================================================

function parseReviewResponse(text: string): ReviewDecision {
  const actionMatch = text.match(/ACTION:\s*(create|patch|delete|no_action)/i);
  if (!actionMatch) return { action: "no_action" };

  const action = actionMatch[1].toLowerCase() as ReviewDecision["action"];
  if (action === "no_action") return { action };

  const nameMatch = text.match(/SKILL_NAME:\s*(.+)/);
  const descMatch = text.match(/DESCRIPTION:\s*(.+)/);
  const markdownMatch = text.match(/MARKDOWN:\n([\s\S]+?)\n(?:END|$)/);

  return {
    action,
    skillName: nameMatch?.[1].trim(),
    description: descMatch?.[1].trim(),
    markdown: markdownMatch?.[1].trim(),
  };
}

// =============================================================================
// Build Trajectory for Review
// =============================================================================

async function buildReviewTrajectory(sessionId: string): Promise<Result<BaseMessage[]>> {
  const messagesRes = await getMessages(sessionId);
  if (!messagesRes.success) return messagesRes;

  const messages = messagesRes.data;
  // Compress if too long (> ~8000 chars)
  const rawChars = JSON.stringify(messages).length;
  if (rawChars > 8000) {
    const compressor = createTrajectoryCompressor();
    const fakeEntries = messages.map((m, idx) => ({
      turn: idx,
      messages: [m],
      toolCalls: [] as unknown[],
      outcome: "success" as const,
    }));
    const compressed = await compressor.compress(fakeEntries, 4000);
    if (compressed.success && compressed.data.length < messages.length) {
      const summaryMsg: BaseMessage = {
        role: "system",
        content: `This conversation was compressed for review. Original ${messages.length} messages, now ${compressed.data.length} entries.`,
      };
      const remaining = compressed.data.flatMap((e) => e.messages);
      return ok([summaryMsg, ...remaining]);
    }
  }

  return ok(messages);
}

// =============================================================================
// Run Background Review
// =============================================================================

export async function runBackgroundReview(
  sessionId: string,
  llmCfg: LLMConfig,
  opts: {
    onDecision?: (decision: ReviewDecision) => void;
    autoApplyLowRisk?: boolean;
  } = {}
): Promise<Result<ReviewDecision>> {
  try {
    const trajectoryRes = await buildReviewTrajectory(sessionId);
    if (!trajectoryRes.success) return trajectoryRes;

    const reviewMessages: BaseMessage[] = [
      { role: "system", content: REVIEW_PROMPT },
      { role: "user", content: `Review this trajectory:\n\n${JSON.stringify(trajectoryRes.data, null, 2)}` },
    ];

    const llmRes = await callAuxiliary("review", reviewMessages);
    if (!llmRes.success) return llmRes;

    const text =
      typeof llmRes.data.content === "string"
        ? llmRes.data.content
        : (Array.isArray(llmRes.data.content) && llmRes.data.content.find((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")?.text) || "";

    const decision = parseReviewResponse(text);

    // Persist trajectory
    const fakeEntries = trajectoryRes.data.map((m, idx) => ({
      turn: idx,
      messages: [m],
      toolCalls: [] as unknown[],
      outcome: "success" as const,
      summary: decision.action === "no_action" ? undefined : `Review action: ${decision.action}`,
    }));
    await saveTrajectory(sessionId, fakeEntries, decision.action === "no_action" ? "success" : "success", undefined, false);

    // Apply decision if skill markdown is present
    if (decision.markdown && decision.skillName && decision.action === "create") {
      const risk = "low" as const;
      const req = {
        type: "skill_create" as const,
        skillName: decision.skillName,
        description: decision.description || `Auto-created skill ${decision.skillName}`,
        proposedChanges: {},
        rationale: "Background review agent determined this pattern is reusable.",
        estimatedRisk: risk,
      };
      const ruleCheck = defaultRuleEngine.evaluateModification(req);
      if (ruleCheck.success && ruleCheck.data === "allow" && opts.autoApplyLowRisk !== false) {
        const skillDir = join(process.cwd(), "skills", decision.skillName);
        const writeRes = writeSkill(decision.skillName, decision.markdown);
        if (writeRes.success) {
          await upsertSkillRegistry(decision.skillName, skillDir, {
            name: decision.skillName,
            description: decision.description,
            source: "background_review",
          });
          await logModification(sessionId, req, "allow", true);
        }
      }
    }

    if (opts.onDecision) {
      opts.onDecision(decision);
    }

    return ok(decision);
  } catch (e) {
    return err({ code: "REVIEW_ERROR", message: String(e) });
  }
}

// =============================================================================
// Non-blocking spawn helper
// =============================================================================

export function spawnBackgroundReview(
  sessionId: string,
  llmCfg: LLMConfig,
  opts?: {
    onDecision?: (decision: ReviewDecision) => void;
    autoApplyLowRisk?: boolean;
  }
): void {
  // Fire-and-forget with a small delay to avoid competing with main response flush
  setTimeout(() => {
    runBackgroundReview(sessionId, llmCfg, opts).catch(() => {
      // Silent failure for background task
    });
  }, 100);
}
