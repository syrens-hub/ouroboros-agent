import { describe, it, expect, beforeEach } from "vitest";
import {
  createProposal,
  getProposal,
  listProposals,
  updateProposalStatus,
  deleteProposal,
  getProposalStats,
  _resetProposals,
  type ProposalDraft,
} from "../../../skills/auto-evolve/proposal-db.ts";

describe("proposal-db", () => {
  beforeEach(() => {
    _resetProposals();
  });

  const draft: ProposalDraft = {
    category: "performance",
    severity: "warning",
    title: "Add index on users.email",
    description: "Queries on users.email are slow.",
    rootCause: "Missing index.",
    suggestedFix: "CREATE INDEX idx_users_email ON users(email);",
    expectedImpact: "Faster lookups.",
    riskLevel: "low",
    autoApplicable: true,
  };

  it("creates and retrieves a proposal", () => {
    const p = createProposal(draft);
    expect(p.id).toMatch(/^aep-/);
    expect(p.status).toBe("pending");

    const fetched = getProposal(p.id);
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe(draft.title);
  });

  it("lists proposals with filter", () => {
    createProposal(draft);
    createProposal({ ...draft, category: "reliability" });

    const all = listProposals();
    expect(all.length).toBe(2);

    const perf = listProposals({ category: "performance" });
    expect(perf.length).toBe(1);
  });

  it("updates status", () => {
    const p = createProposal(draft);
    const ok = updateProposalStatus(p.id, "approved");
    expect(ok).toBe(true);

    const fetched = getProposal(p.id);
    expect(fetched!.status).toBe("approved");
    // approved does not set resolvedAt (only applied/failed/rejected do)
  });

  it("deletes a proposal", () => {
    const p = createProposal(draft);
    expect(deleteProposal(p.id)).toBe(true);
    expect(getProposal(p.id)).toBeUndefined();
  });

  it("returns stats", () => {
    createProposal(draft);
    createProposal({ ...draft, category: "reliability" });
    updateProposalStatus(listProposals()[0].id, "approved");

    const stats = getProposalStats();
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.approved).toBeGreaterThanOrEqual(1);
  });
});
