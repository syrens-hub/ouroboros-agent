import { describe, it, expect, beforeEach } from "vitest";
import { startTurnSpan, endTurnSpan, startToolSpan, endToolSpan, resetSpansForTests } from "../../../skills/telemetry/telemetry-spans.ts";

describe("telemetry-spans", () => {
  beforeEach(() => {
    resetSpansForTests();
  });

  it("starts and ends turn span", () => {
    const span = startTurnSpan("sess-1", 5);
    expect(span.name).toBe("agent:turn");
    expect(span.attributes.turn).toBe(5);
    endTurnSpan("sess-1", true);
    expect(span.endTime).toBeDefined();
  });

  it("starts and ends tool span", () => {
    const span = startToolSpan("sess-1", 2, "bash");
    expect(span.attributes.toolName).toBe("bash");
    endToolSpan("sess-1", "bash", false, "Error:ENOENT");
    expect(span.endTime).toBeDefined();
    expect(span.attributes.errorClass).toBe("Error:ENOENT");
  });
});
