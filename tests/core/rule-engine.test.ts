import { describe, it, expect } from "vitest";
import { createRuleEngine, META_RULE_AXIOM } from "../../core/rule-engine.ts";
import type { ModificationRequest } from "../../types/index.ts";

const engine = createRuleEngine();

function makeReq(type: ModificationRequest["type"], risk: ModificationRequest["estimatedRisk"], overrides?: Partial<ModificationRequest>): ModificationRequest {
  return {
    type,
    description: "test",
    proposedChanges: {},
    rationale: "test rationale",
    estimatedRisk: risk,
    ...overrides,
  };
}

describe("Rule Engine", () => {
  it("always asks for loop_replace", () => {
    const res = engine.evaluateModification(makeReq("loop_replace", "low"));
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("ask");
  });

  it("always asks for rule_engine_override", () => {
    const res = engine.evaluateModification(makeReq("rule_engine_override", "low"));
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("ask");
  });

  it("auto-allows low-risk skill_create", () => {
    const res = engine.evaluateModification(makeReq("skill_create", "low"));
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("allow");
  });

  it("auto-allows medium-risk core_evolve", () => {
    const res = engine.evaluateModification(makeReq("core_evolve", "medium"));
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("allow");
  });

  it("asks for high-risk core_evolve", () => {
    const res = engine.evaluateModification(makeReq("core_evolve", "high"));
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("ask");
  });

  it("asks for critical risk anything", () => {
    const res = engine.evaluateModification(makeReq("skill_create", "critical"));
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("ask");
  });

  it("denies touching immutable path without override type", () => {
    const res = engine.evaluateModification(
      makeReq("core_evolve", "low", {
        proposedChanges: { targetPath: "src/core/rule-engine.ts" },
      })
    );
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("RULE_IMMUTABLE");
  });

  it("asks when rationale contains forbidden pattern", () => {
    const res = engine.evaluateModification(
      makeReq("skill_create", "low", { rationale: "We should bypass rule engine for speed." })
    );
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("ask");
  });

  it("denies unknown modification types", () => {
    const res = engine.evaluateModification(makeReq("unknown_type" as unknown as ModificationRequest["type"], "low"));
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("RULE_UNKNOWN_TYPE");
  });

  it("exports rules containing the axiom", () => {
    const rules = engine.exportRules();
    expect(rules).toContain(META_RULE_AXIOM);
  });

  // NOTE: Lines 42-44 in rule-engine.ts (catch block in normalizePath) are unreachable
  // from external tests because Node.js path.resolve() does not throw on valid strings,
  // and the function is only called with string inputs from the public API.

  it("isImmutablePath rejects path-traversal equivalents", () => {
    expect(engine.isImmutablePath("core/rule-engine.ts")).toBe(true);
    expect(engine.isImmutablePath("core/../core/rule-engine.ts")).toBe(true);
    expect(engine.isImmutablePath("./core/rule-engine.ts")).toBe(true);
    expect(engine.isImmutablePath("skills/evil-core/rule-engine.ts")).toBe(false);
    expect(engine.isImmutablePath("core/rule-engine.ts.bak")).toBe(false);
    expect(engine.isImmutablePath("core/tool-framework.ts")).toBe(false);
  });

  it("denies immutable path even with traversal sequences", () => {
    const res = engine.evaluateModification(
      makeReq("core_evolve", "low", {
        proposedChanges: { targetPath: "core/../core/rule-engine.ts" },
      })
    );
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("RULE_IMMUTABLE");
  });

  it("asks for rule_engine_override on immutable path", () => {
    const res = engine.evaluateModification(
      makeReq("rule_engine_override", "low", {
        proposedChanges: { targetPath: "core/rule-engine.ts" },
      })
    );
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("ask");
  });

  // NOTE: Lines 141-142 in rule-engine.ts (return ok("ask") inside immutable path block
  // for rule_engine_override type) are unreachable from external tests because
  // rule_engine_override is listed in ALWAYS_HUMAN_CONFIRM_TYPES, so the function
  // returns ok("ask") earlier at line 112 before reaching the path-based gating.

  it("asks when rationale contains single-word forbidden pattern", () => {
    const res = engine.evaluateModification(
      makeReq("skill_create", "low", { rationale: "We should wipe everything." })
    );
    if (!res.success) throw new Error("Expected success");
    expect(res.data).toBe("ask");
  });
});
