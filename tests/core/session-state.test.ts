import { describe, it, expect } from "vitest";
import { getSessionState, clearSessionState, resetSessionStateForTests } from "../../core/session-state.ts";

describe("session-state", () => {
  it("creates default state per session", () => {
    const s = getSessionState("sess-1");
    expect(s.tokenCounters.totalInput).toBe(0);
    expect(s.tokenCounters.totalOutput).toBe(0);
    expect(s.caches.ouroborosMdContent).toBeUndefined();
  });

  it("returns the same instance for the same sessionId", () => {
    const a = getSessionState("sess-2");
    const b = getSessionState("sess-2");
    expect(a).toBe(b);
  });

  it("clearSessionState removes the entry", () => {
    getSessionState("sess-3").tokenCounters.totalInput = 100;
    clearSessionState("sess-3");
    const s = getSessionState("sess-3");
    expect(s.tokenCounters.totalInput).toBe(0);
  });

  it("resetSessionStateForTests clears all", () => {
    getSessionState("sess-4");
    getSessionState("sess-5");
    resetSessionStateForTests();
    expect(getSessionState("sess-4").tokenCounters.totalInput).toBe(0);
  });
});
