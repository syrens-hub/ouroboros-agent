/**
 * Agency Agents Registry
 * =======================
 * Register, search, and match agent definitions for dynamic personality injection.
 */

import type { AgentDefinition } from "./loader.ts";
import { loadAgentsFromDir } from "./loader.ts";
import { logger } from "../../core/logger.ts";
import { callAuxiliary } from "../../core/auxiliary-llm.ts";
import { safeJsonParse } from "../../core/safe-utils.ts";

const DEFAULT_AGENTS_DIR = new URL("./agents", import.meta.url).pathname;

interface LLMMatchCacheEntry {
  agentId: string;
  timestamp: number;
}

const LLM_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private divisions = new Set<string>();
  private llmMatchCache = new Map<string, LLMMatchCacheEntry>();

  constructor(agents: AgentDefinition[] = []) {
    for (const agent of agents) {
      this.register(agent);
    }
  }

  register(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
    this.divisions.add(agent.division);
  }

  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  getByName(name: string): AgentDefinition | undefined {
    const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
    return this.agents.get(slug) || Array.from(this.agents.values()).find((a) => a.name.toLowerCase() === name.toLowerCase());
  }

  listAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  listDivisions(): string[] {
    return Array.from(this.divisions);
  }

  listByDivision(division: string): AgentDefinition[] {
    return Array.from(this.agents.values()).filter((a) => a.division === division);
  }

  search(query: string, division?: string): AgentDefinition[] {
    const q = query.toLowerCase();
    return Array.from(this.agents.values()).filter((a) => {
      if (division && a.division !== division) return false;
      return (
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.content.toLowerCase().includes(q) ||
        (a.vibe && a.vibe.toLowerCase().includes(q))
      );
    });
  }

  /**
   * Synchronous keyword-based match. Used as fallback when LLM is unavailable.
   */
  matchForTask(taskDescription: string): AgentDefinition | null {
    return this._keywordMatch(taskDescription);
  }

  /**
   * Asynchronous match with LLM classification. Falls back to keyword match
   * if LLM is unavailable, fails, or cache is stale.
   */
  async matchForTaskAsync(taskDescription: string): Promise<AgentDefinition | null> {
    const cacheKey = taskDescription.slice(0, 200).toLowerCase().trim();
    const cached = this.llmMatchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < LLM_CACHE_TTL_MS) {
      const agent = this.agents.get(cached.agentId);
      if (agent) {
        logger.debug("Agent match cache hit", { agent: agent.name });
        return agent;
      }
    }

    const llmAgentId = await this._classifyWithLLM(taskDescription);
    if (llmAgentId) {
      const agent = this.agents.get(llmAgentId) || this.getByName(llmAgentId);
      if (agent) {
        this.llmMatchCache.set(cacheKey, { agentId: agent.id, timestamp: Date.now() });
        logger.debug("Agent matched via LLM", { task: taskDescription.slice(0, 100), agent: agent.name });
        return agent;
      }
    }

    // Fallback to keyword match
    return this._keywordMatch(taskDescription);
  }

  private async _classifyWithLLM(taskDescription: string): Promise<string | null> {
    const agentList = this.listAll()
      .map((a) => `- ${a.id}: ${a.name} (${a.division}) — ${a.description}`)
      .join("\n");

    const messages = [
      {
        role: "system" as const,
        content:
          "You are an agent classifier. Given a task description and a list of available agents, " +
          "return ONLY the agent ID (the slug before the colon) that is best suited for the task. " +
          "If no agent is a good fit, return 'null'. Respond with a single JSON object: {\"agentId\": \"...\"} or {\"agentId\": null}.",
      },
      {
        role: "user" as const,
        content: `## Available Agents\n${agentList}\n\n## Task\n${taskDescription}\n\nWhich agent is best suited?`,
      },
    ];

    try {
      const result = await callAuxiliary("agent-classification", messages);
      if (!result.success) return null;

      const text =
        typeof result.data.content === "string"
          ? result.data.content
          : JSON.stringify(result.data.content);

      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      const parsed = safeJsonParse<{ agentId?: string | null }>(jsonMatch ? jsonMatch[0] : text, "agent classification");
      if (parsed?.agentId) return parsed.agentId;
    } catch {
      // LLM classification failed — fail-open to keyword match
    }
    return null;
  }

  private _keywordMatch(taskDescription: string): AgentDefinition | null {
    const text = taskDescription.toLowerCase();

    // Division keyword mapping
    const divisionScores: Record<string, number> = {};
    const divisionKeywords: Record<string, string[]> = {
      engineering: ["code", "programming", "developer", "software", "api", "database", "frontend", "backend", "devops", "security", "bug", "refactor", "deploy"],
      design: ["design", "ui", "ux", "visual", "brand", "layout", "color", "typography", "prototype", "figma"],
      marketing: ["marketing", "content", "seo", "social media", "growth", "campaign", "audience", "brand awareness"],
      sales: ["sales", "prospect", "deal", "pipeline", "outreach", "lead", "closing", "revenue"],
      product: ["product", "roadmap", "feature", "sprint", "backlog", "user story", "requirement", "pr"],
      testing: ["test", "qa", "quality", "bug", "automation", "coverage", "benchmark", "audit"],
      support: ["support", "customer", "ticket", "issue", "analytics", "report", "finance"],
      specialized: ["automation", "mcp", "blockchain", "compliance", "training", "governance"],
    };

    for (const [division, keywords] of Object.entries(divisionKeywords)) {
      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) score++;
      }
      if (score > 0) divisionScores[division] = score;
    }

    // Find best division
    let bestDivision: string | null = null;
    let bestScore = 0;
    for (const [division, score] of Object.entries(divisionScores)) {
      if (score > bestScore) {
        bestScore = score;
        bestDivision = division;
      }
    }

    if (!bestDivision) {
      // Fallback: return a generic agent if available, or first agent
      return this.agents.get("agents-orchestrator") || this.listAll()[0] || null;
    }

    // Within best division, score individual agents by keyword overlap
    const candidates = this.listByDivision(bestDivision);
    if (candidates.length === 0) return null;

    let bestAgent = candidates[0];
    let bestAgentScore = 0;

    for (const agent of candidates) {
      const agentText = `${agent.name} ${agent.description} ${agent.content}`.toLowerCase();
      let score = 0;
      const words = text.split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && agentText.includes(word)) score++;
      }
      if (score > bestAgentScore) {
        bestAgentScore = score;
        bestAgent = agent;
      }
    }

    logger.debug("Agent keyword-matched for task", { task: taskDescription.slice(0, 100), agent: bestAgent.name, division: bestDivision, score: bestAgentScore });
    return bestAgent;
  }

  getStats(): { total: number; divisions: number } {
    return { total: this.agents.size, divisions: this.divisions.size };
  }
}

let _defaultRegistry: AgentRegistry | null = null;

export function getAgentRegistry(agentsDir?: string): AgentRegistry {
  if (!_defaultRegistry) {
    const dir = agentsDir || process.env.AGENCY_AGENTS_DIR || DEFAULT_AGENTS_DIR;
    const agents = loadAgentsFromDir(dir);
    _defaultRegistry = new AgentRegistry(agents);
    logger.info("Agent registry initialized", { count: agents.length, dir });
  }
  return _defaultRegistry;
}

export function reloadAgentRegistry(agentsDir?: string): AgentRegistry {
  _defaultRegistry = null;
  return getAgentRegistry(agentsDir);
}

/** Reset registry — for testing only */
export function _resetAgentRegistry(): void {
  _defaultRegistry = null;
}
