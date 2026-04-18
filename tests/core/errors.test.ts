import { describe, it, expect } from "vitest";
import { TelemetrySafeError, classifyToolError, hasErrnoCode } from "../../core/errors.ts";

describe("errors", () => {
  it("classifies TelemetrySafeError by telemetryMessage", () => {
    const err = new TelemetrySafeError("full msg", "telemetry msg");
    expect(classifyToolError(err)).toBe("telemetry msg");
  });

  it("classifies Node errno errors", () => {
    const err = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    expect(classifyToolError(err)).toBe("Error:ENOENT");
  });

  it("classifies named errors", () => {
    class CustomError extends Error {
      constructor() {
        super("boom");
        this.name = "CustomError";
      }
    }
    expect(classifyToolError(new CustomError())).toBe("CustomError");
  });

  it("falls back to Error for unnamed errors", () => {
    expect(classifyToolError(new Error("something"))).toBe("Error");
  });

  it("hasErrnoCode extracts code", () => {
    const err = Object.assign(new Error("fail"), { code: "EACCES" });
    expect(hasErrnoCode(err)).toBe("EACCES");
  });
});
