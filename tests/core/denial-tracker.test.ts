import { describe, it, expect, beforeEach } from "vitest";
import {
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
  buildDenialHint,
  resetDenialTracker,
} from "../../core/denial-tracker.ts";

describe("denial-tracker", () => {
  beforeEach(() => {
    resetDenialTracker();
  });

  it("does not fallback after 2 denials", () => {
    recordDenial("bash", "");
    recordDenial("bash", "");
    expect(shouldFallbackToPrompting("bash", "")).toBe(false);
  });

  it("fallbacks after 3 denials", () => {
    recordDenial("bash", "");
    recordDenial("bash", "");
    recordDenial("bash", "");
    expect(shouldFallbackToPrompting("bash", "")).toBe(true);
  });

  it("resets after success", () => {
    recordDenial("bash", "");
    recordDenial("bash", "");
    recordDenial("bash", "");
    recordSuccess("bash", "");
    expect(shouldFallbackToPrompting("bash", "")).toBe(false);
  });

  it("builds hint message", () => {
    expect(buildDenialHint("bash")).toContain("repeatedly denied bash operations");
  });
});
