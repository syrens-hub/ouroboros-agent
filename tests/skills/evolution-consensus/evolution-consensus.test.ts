import { describe, it, expect } from "vitest";
import { runEvolutionConsensus } from "../../../skills/evolution-consensus/index.ts";
import type { EvolutionProposal } from "../../../skills/evolution-orchestrator/index.ts";

describe("Evolution Consensus v2", () => {
  function makeProposal(p: Partial<EvolutionProposal> = {}): EvolutionProposal {
    return {
      filesChanged: ["skills/greet/index.ts"],
      description: "Update greeting",
      linesAdded: 5,
      linesRemoved: 0,
      ...p,
    };
  }

  it("approves safe low-risk proposal", () => {
    const result = runEvolutionConsensus(makeProposal());
    expect(result.recommendation).toBe("approve");
    expect(result.agreementRatio).toBeGreaterThanOrEqual(50);
    expect(result.adjustedRiskScore).toBeLessThan(50);
  });

  it("rejects proposal with protected path (security veto)", () => {
    const result = runEvolutionConsensus(
      makeProposal({ filesChanged: ["core/rule-engine.ts"] })
    );
    expect(result.recommendation).toBe("reject");
    expect(result.votes.some((v) => v.reviewerRole === "security" && v.verdict === "reject")).toBe(true);
  });

  it("delays large changes", () => {
    const result = runEvolutionConsensus(
      makeProposal({
        filesChanged: Array.from({ length: 12 }, (_, i) => `skills/mod${i}/index.ts`),
        linesAdded: 600,
        linesRemoved: 50,
      })
    );
    expect(result.recommendation).toBe("delay");
    expect(result.votes.some((v) => v.reviewerRole === "architecture" && v.verdict === "delay")).toBe(true);
  });

  it("cost reviewer rejects over-budget proposal", () => {
    const result = runEvolutionConsensus(
      makeProposal({ estimatedCostUsd: 9999 })
    );
    // Cost votes reject, but other reviewers may approve; consensus depends on aggregation
    expect(result.votes.some((v) => v.reviewerRole === "cost" && v.verdict === "reject")).toBe(true);
  });

  it("returns all reviewer votes", () => {
    const result = runEvolutionConsensus(makeProposal());
    expect(result.votes.length).toBe(4);
    expect(result.votes.map((v) => v.reviewerRole).sort()).toEqual([
      "architecture",
      "cost",
      "security",
      "testing",
    ]);
  });

  it("adjusts risk score on strong approval consensus", () => {
    const result = runEvolutionConsensus(makeProposal());
    if (result.recommendation === "approve" && result.agreementRatio >= 75) {
      expect(result.adjustedRiskScore).toBeLessThanOrEqual(20);
    }
  });

  it("boosts risk score on security rejection", () => {
    const result = runEvolutionConsensus(
      makeProposal({ filesChanged: ["core/rule-engine.ts"] })
    );
    expect(result.recommendation).toBe("reject");
    expect(result.adjustedRiskScore).toBeGreaterThanOrEqual(100);
  });
});
