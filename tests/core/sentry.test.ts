import { describe, it, expect } from "vitest";
import { captureException, addBreadcrumb, initSentry } from "../../core/sentry.ts";

describe("sentry", () => {
  it("captureException does not throw", () => {
    expect(() => captureException(new Error("test"))).not.toThrow();
  });

  it("addBreadcrumb does not throw", () => {
    expect(() => addBreadcrumb("test", "cat")).not.toThrow();
  });

  it("initSentry does not throw", () => {
    expect(() => initSentry()).not.toThrow();
  });
});
