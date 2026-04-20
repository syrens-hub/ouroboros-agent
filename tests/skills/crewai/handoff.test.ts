import { describe, it, expect } from "vitest";
import { createHandoff, applyHandoff, serializeHandoff, deserializeHandoff } from "../../../skills/crewai/handoff.ts";

describe("handoff", () => {
  it("createHandoff with all fields", () => {
    const h = createHandoff({
      fromAgent: "a1",
      toAgent: "a2",
      taskId: "t1",
      summary: "done",
      keyFindings: ["f1"],
      openQuestions: ["q1"],
      constraints: ["c1"],
      artifacts: [{ name: "art1", content: "data" }],
    });
    expect(h.fromAgent).toBe("a1");
    expect(h.keyFindings).toEqual(["f1"]);
    expect(h.openQuestions).toEqual(["q1"]);
    expect(h.constraints).toEqual(["c1"]);
    expect(h.artifacts).toHaveLength(1);
  });

  it("applyHandoff includes open questions", () => {
    const h = createHandoff({
      fromAgent: "a1", toAgent: "a2", taskId: "t1", summary: "s",
      openQuestions: ["q1", "q2"],
    });
    const text = applyHandoff(h, "next");
    expect(text).toContain("Open Questions");
    expect(text).toContain("q1");
  });

  it("applyHandoff includes artifacts", () => {
    const h = createHandoff({
      fromAgent: "a1", toAgent: "a2", taskId: "t1", summary: "s",
      artifacts: [{ name: "file.txt", content: "hello" }],
    });
    const text = applyHandoff(h, "next");
    expect(text).toContain("Artifacts");
    expect(text).toContain("file.txt");
  });

  it("serialize and deserialize round-trip", () => {
    const h = createHandoff({ fromAgent: "a1", toAgent: "a2", taskId: "t1", summary: "s" });
    const json = serializeHandoff(h);
    const back = deserializeHandoff(json);
    expect(back).toEqual(h);
  });

  it("deserializeHandoff returns undefined for invalid json", () => {
    expect(deserializeHandoff("not-json")).toBeUndefined();
  });

  it("deserializeHandoff returns undefined for missing fields", () => {
    expect(deserializeHandoff('{"fromAgent":"a1"}')).toBeUndefined();
  });
});
