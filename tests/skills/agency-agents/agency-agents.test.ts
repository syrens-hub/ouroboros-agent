import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadAgentsFromDir,
  AgentRegistry,
  getAgentRegistry,
  reloadAgentRegistry,
  _resetAgentRegistry,
  buildSystemPrompt,
  buildConciseSystemPrompt,
  buildOrchestratorPrompt,
} from "../../../skills/agency-agents/index.ts";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Agency Agents Module", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agency-agents-test-"));
    _resetAgentRegistry();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    _resetAgentRegistry();
  });

  describe("Loader", () => {
    it("loads agents from directory with frontmatter", () => {
      mkdirSync(join(tmpDir, "engineering"), { recursive: true });
      writeFileSync(
        join(tmpDir, "engineering", "frontend-dev.md"),
        `---
name: Frontend Developer
description: Expert in React and UI
color: cyan
emoji: 🎨
vibe: Builds beautiful UIs
---

# Frontend Developer

You are a frontend expert.
`,
        "utf-8"
      );

      const agents = loadAgentsFromDir(tmpDir);
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("Frontend Developer");
      expect(agents[0].description).toBe("Expert in React and UI");
      expect(agents[0].division).toBe("engineering");
      expect(agents[0].color).toBe("cyan");
      expect(agents[0].emoji).toBe("🎨");
      expect(agents[0].vibe).toBe("Builds beautiful UIs");
      expect(agents[0].content).toContain("You are a frontend expert.");
    });

    it("loads multiple divisions", () => {
      mkdirSync(join(tmpDir, "engineering"), { recursive: true });
      mkdirSync(join(tmpDir, "marketing"), { recursive: true });
      writeFileSync(join(tmpDir, "engineering", "dev.md"), "---\nname: Dev\n---\nContent", "utf-8");
      writeFileSync(join(tmpDir, "marketing", "seo.md"), "---\nname: SEO\n---\nContent", "utf-8");

      const agents = loadAgentsFromDir(tmpDir);
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.division).sort()).toEqual(["engineering", "marketing"]);
    });

    it("returns empty array for missing directory", () => {
      const agents = loadAgentsFromDir(join(tmpDir, "nonexistent"));
      expect(agents).toHaveLength(0);
    });

    it("generates id from name", () => {
      mkdirSync(join(tmpDir, "general"), { recursive: true });
      writeFileSync(join(tmpDir, "general", "test.md"), "---\nname: Test Agent\n---\nContent", "utf-8");

      const agents = loadAgentsFromDir(tmpDir);
      expect(agents[0].id).toBe("test-agent");
    });
  });

  describe("Registry", () => {
    it("registers and retrieves agents", () => {
      const registry = new AgentRegistry();
      registry.register({
        id: "test",
        name: "Test Agent",
        description: "A test agent",
        division: "testing",
        content: "Content",
      });

      expect(registry.get("test")?.name).toBe("Test Agent");
      expect(registry.getByName("Test Agent")?.id).toBe("test");
    });

    it("lists all agents", () => {
      const registry = new AgentRegistry();
      registry.register({ id: "a", name: "A", description: "", division: "d1", content: "" });
      registry.register({ id: "b", name: "B", description: "", division: "d2", content: "" });

      expect(registry.listAll()).toHaveLength(2);
      expect(registry.listDivisions()).toContain("d1");
      expect(registry.listDivisions()).toContain("d2");
    });

    it("filters by division", () => {
      const registry = new AgentRegistry();
      registry.register({ id: "a", name: "A", description: "", division: "eng", content: "" });
      registry.register({ id: "b", name: "B", description: "", division: "mkt", content: "" });

      expect(registry.listByDivision("eng")).toHaveLength(1);
      expect(registry.listByDivision("eng")[0].name).toBe("A");
    });

    it("searches by keyword", () => {
      const registry = new AgentRegistry();
      registry.register({ id: "a", name: "Frontend Dev", description: "React expert", division: "eng", content: "Builds UIs" });
      registry.register({ id: "b", name: "Backend Dev", description: "Node expert", division: "eng", content: "Builds APIs" });

      const results = registry.search("React");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Frontend Dev");
    });

    it("matches agent for engineering task", () => {
      const registry = new AgentRegistry();
      registry.register({ id: "frontend", name: "Frontend Developer", description: "React/Vue", division: "engineering", content: "UI" });
      registry.register({ id: "seo", name: "SEO Specialist", description: "Search optimization", division: "marketing", content: "Keywords" });

      const matched = registry.matchForTask("Build a React code component with TypeScript programming");
      expect(matched).not.toBeNull();
      expect(matched!.division).toBe("engineering");
    });

    it("matches agent for marketing task", () => {
      const registry = new AgentRegistry();
      registry.register({ id: "frontend", name: "Frontend Developer", description: "React/Vue", division: "engineering", content: "UI" });
      registry.register({ id: "seo", name: "SEO Specialist", description: "Search optimization", division: "marketing", content: "Keywords" });

      const matched = registry.matchForTask("Run a marketing campaign with SEO content growth");
      expect(matched).not.toBeNull();
      expect(matched!.division).toBe("marketing");
    });

    it("returns stats", () => {
      const registry = new AgentRegistry();
      registry.register({ id: "a", name: "A", description: "", division: "d1", content: "" });
      expect(registry.getStats()).toEqual({ total: 1, divisions: 1 });
    });
  });

  describe("Prompt Builder", () => {
    it("builds system prompt from agent", () => {
      const agent = {
        id: "test",
        name: "Test Agent",
        description: "A test agent",
        division: "test",
        emoji: "🧪",
        content: "You are an expert tester.",
      };
      const prompt = buildSystemPrompt(agent);
      expect(prompt.role).toBe("system");
      expect(prompt.agentId).toBe("test");
      expect(prompt.agentName).toBe("Test Agent");
      expect(prompt.content).toContain("Test Agent");
      expect(prompt.content).toContain("You are an expert tester.");
    });

    it("builds concise system prompt", () => {
      const agent = {
        id: "test",
        name: "Test Agent",
        description: "A test agent",
        division: "test",
        vibe: "Fast and thorough",
        content: "Details...",
      };
      const prompt = buildConciseSystemPrompt(agent);
      expect(prompt.content).toContain("Test Agent");
      expect(prompt.content).toContain("Fast and thorough");
    });

    it("builds orchestrator prompt for multiple agents", () => {
      const agents = [
        { id: "a1", name: "Agent 1", description: "Does thing 1", division: "d1", emoji: "🎯", content: "" },
        { id: "a2", name: "Agent 2", description: "Does thing 2", division: "d2", emoji: "🔧", content: "" },
      ];
      const prompt = buildOrchestratorPrompt(agents, "Build a website");
      expect(prompt.role).toBe("system");
      expect(prompt.content).toContain("Orchestrator Agent");
      expect(prompt.content).toContain("Agent 1");
      expect(prompt.content).toContain("Agent 2");
      expect(prompt.content).toContain("Build a website");
    });
  });

  describe("Integration with file system", () => {
    it("getAgentRegistry loads from default directory", () => {
      const registry = getAgentRegistry();
      expect(registry.getStats().total).toBeGreaterThan(0);
    });

    it("reloadAgentRegistry refreshes the cache", () => {
      const r1 = getAgentRegistry();
      const stats1 = r1.getStats();
      const r2 = reloadAgentRegistry();
      expect(r2.getStats().total).toBe(stats1.total);
    });
  });
});
