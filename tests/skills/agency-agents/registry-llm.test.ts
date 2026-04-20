import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRegistry, _resetAgentRegistry } from "../../../skills/agency-agents/registry.ts";
import type { AgentDefinition } from "../../../skills/agency-agents/loader.ts";

const mockAgents: AgentDefinition[] = [
  { id: "engineer", name: "Engineer", description: "Writes code", division: "engineering", content: "You write code." },
  { id: "designer", name: "Designer", description: "Designs UI", division: "design", content: "You design UI." },
  { id: "marketer", name: "Marketer", description: "Creates campaigns", division: "marketing", content: "You market." },
];

describe("AgentRegistry LLM matching", () => {
  beforeEach(() => {
    _resetAgentRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to keyword match when LLM is unavailable", async () => {
    const registry = new AgentRegistry(mockAgents);
    const agent = await registry.matchForTaskAsync("Write a Python API endpoint");
    expect(agent).toBeDefined();
    expect(agent?.division).toBe("engineering");
  });

  it("caches LLM match results", async () => {
    const registry = new AgentRegistry(mockAgents);

    // Mock callAuxiliary by dynamically intercepting the import
    const spy = vi.spyOn(await import("../../../core/auxiliary-llm.ts"), "callAuxiliary").mockResolvedValue({
      success: true,
      data: { role: "assistant", content: '{"agentId": "designer"}' },
    });

    const agent1 = await registry.matchForTaskAsync("Design a landing page");
    expect(agent1?.id).toBe("designer");
    expect(spy).toHaveBeenCalledTimes(1);

    // Second identical call should hit cache
    const agent2 = await registry.matchForTaskAsync("Design a landing page");
    expect(agent2?.id).toBe("designer");
    expect(spy).toHaveBeenCalledTimes(1); // no extra LLM call
  });

  it("keyword match works synchronously", () => {
    const registry = new AgentRegistry(mockAgents);
    const agent = registry.matchForTask("Create a marketing campaign");
    expect(agent?.division).toBe("marketing");
  });

  it("returns null for empty registry", () => {
    const registry = new AgentRegistry([]);
    expect(registry.matchForTask("anything")).toBeNull();
  });
});
