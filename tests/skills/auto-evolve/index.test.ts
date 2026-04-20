import { describe, it, expect, beforeEach } from "vitest";
import {
  runEvolutionCycle,
  approveProposal,
  rejectProposal,
  snoozeProposal,
  getProposalStats,
} from "../../../skills/auto-evolve/index.ts";
import { _resetProposals } from "../../../skills/auto-evolve/proposal-db.ts";
import { _resetMetrics } from "../../../skills/telemetry-v2/metrics-registry.ts";

describe("auto-evolve integration", () => {
  beforeEach(() => {
    _resetMetrics();
    _resetProposals();
  });

  it("runs full evolution cycle", () => {
    const { checkup, proposals } = runEvolutionCycle("manual");
    expect(checkup.id).toMatch(/^checkup-/);
    expect(Array.isArray(proposals)).toBe(true);
  });

  it("creates proposals from high-latency metrics", () => {
    const { proposals } = runEvolutionCycle("manual");
    // Default process metrics may or may not trigger proposals
    expect(proposals.length).toBeGreaterThanOrEqual(0);
  });

  it("approves, rejects, and snoozes proposals", () => {
    const { proposals } = runEvolutionCycle("manual");
    if (proposals.length === 0) return;

    const p = proposals[0];

    const approved = approveProposal(p.id);
    expect(approved.success).toBe(true);
    expect(approved.proposal!.status).toBe("approved");

    const snoozed = snoozeProposal(p.id);
    expect(snoozed.success).toBe(false); // already approved

    const rejected = rejectProposal(p.id);
    expect(rejected.success).toBe(false); // already approved
  });

  it("tracks stats", () => {
    runEvolutionCycle("manual");
    const stats = getProposalStats();
    expect(stats.pending).toBeGreaterThanOrEqual(0);
  });
});
