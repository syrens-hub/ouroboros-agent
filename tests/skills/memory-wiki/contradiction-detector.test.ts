import { describe, it, expect } from "vitest";
import { detectContradictions, findPotentialContradictions } from "../../../skills/memory-wiki/contradiction-detector.ts";
import type { Claim } from "../../../skills/memory-wiki/types.ts";

function makeClaim(overrides?: Partial<Claim>): Claim {
  return {
    id: `claim-${Math.random().toString(36).slice(2, 9)}`,
    category: "pref",
    content: "Default claim",
    freshness: "high",
    status: "active",
    confidence: 0.9,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sources: [],
    contradictions: [],
    ...overrides,
  } as Claim;
}

describe("detectContradictions", () => {
  it("returns empty for non-overlapping claims", () => {
    const c1 = makeClaim({ category: "tech", content: "React is a library" });
    const c2 = makeClaim({ category: "food", content: "Pizza is delicious" });
    expect(detectContradictions([c1, c2])).toHaveLength(0);
  });

  it("flags same-category overlapping claims as low severity", () => {
    const c1 = makeClaim({ category: "tech", content: "React is popular" });
    const c2 = makeClaim({ category: "tech", content: "React is widely used" });
    const reports = detectContradictions([c1, c2]);
    expect(reports).toHaveLength(1);
    expect(reports[0].severity).toBe("low");
    expect(reports[0].claimA.id).toBe(c1.id);
    expect(reports[0].claimB.id).toBe(c2.id);
  });

  it("flags active claims with opposite sentiments as medium severity", () => {
    const c1 = makeClaim({ category: "pref", content: "I love React" });
    const c2 = makeClaim({ category: "pref", content: "I hate React" });
    const reports = detectContradictions([c1, c2]);
    expect(reports).toHaveLength(1);
    expect(reports[0].severity).toBe("medium");
    expect(reports[0].reason).toContain("love vs hate");
  });

  it("does not flag opposite sentiments if one claim is not active", () => {
    const c1 = makeClaim({ category: "pref", content: "I love React", status: "active" });
    const c2 = makeClaim({ category: "pref", content: "I hate React", status: "superseded" });
    const reports = detectContradictions([c1, c2]);
    expect(reports).toHaveLength(1);
    expect(reports[0].severity).toBe("low");
  });

  it("returns high severity for multiple opposite sentiments", () => {
    const c1 = makeClaim({ category: "pref", content: "I love fast cars" });
    const c2 = makeClaim({ category: "pref", content: "I hate slow cars" });
    const reports = detectContradictions([c1, c2]);
    expect(reports.length).toBeGreaterThanOrEqual(1);
    const high = reports.find((r) => r.severity === "high");
    expect(high).toBeDefined();
  });

  it("ignores identical claims pairs only once", () => {
    const c1 = makeClaim({ category: "x", content: "Apple is red" });
    const c2 = makeClaim({ category: "x", content: "Apple is green" });
    const reports = detectContradictions([c1, c2]);
    expect(reports).toHaveLength(1);
  });
});

describe("findPotentialContradictions", () => {
  it("checks new claim against existing active claims", () => {
    const existing = [
      makeClaim({ category: "pref", content: "I love sushi" }),
      makeClaim({ category: "pref", content: "I like ramen" }),
    ];
    const newClaim = makeClaim({ category: "pref", content: "I hate sushi" });
    const reports = findPotentialContradictions(newClaim, existing);
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports.some((r) => r.claimB.id === existing[0].id && r.severity === "medium")).toBe(true);
  });

  it("returns empty when no overlap", () => {
    const existing = [makeClaim({ category: "food", content: "Pizza is great" })];
    const newClaim = makeClaim({ category: "tech", content: "React is fast" });
    expect(findPotentialContradictions(newClaim, existing)).toHaveLength(0);
  });
});
