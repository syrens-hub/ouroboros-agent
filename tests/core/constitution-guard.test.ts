import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evaluateConstitutionGuard, isConstitutionallyProtected } from "../../core/constitution-guard.ts";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

const mockEmitEvent = vi.fn();
vi.mock("../../skills/notification/index.ts", () => ({
  notificationBus: {
    emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
  },
}));

const TEST_PROJECT_ROOT = process.cwd();

describe("constitution-guard", () => {
  const pkgJsonPath = join(TEST_PROJECT_ROOT, "package.json");
  let originalPkgJson: string;

  beforeEach(() => {
    originalPkgJson = readFileSync(pkgJsonPath, "utf-8");
    mockEmitEvent.mockClear();
  });

  afterEach(() => {
    writeFileSync(pkgJsonPath, originalPkgJson, "utf-8");
  });

  it("denies modification of core/rule-engine.ts", () => {
    const result = evaluateConstitutionGuard("core/rule-engine.ts", "write", "// evil");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONSTITUTION_VIOLATION");
      expect(result.error.message).toContain("immutable file");
    }
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEvent.mock.calls[0][0].meta.rule).toBe("Rule 2");
  });

  it("denies modification of core/config.ts", () => {
    const result = evaluateConstitutionGuard("core/config.ts", "patch", "{}");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONSTITUTION_VIOLATION");
    }
  });

  it("denies deletion of core/sandbox.ts", () => {
    const result = evaluateConstitutionGuard("core/sandbox.ts", "delete");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONSTITUTION_VIOLATION");
      expect(result.error.message).toContain("Deletion of core file");
    }
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEvent.mock.calls[0][0].meta.rule).toBe("Rule 1");
  });

  it("denies adding new dependencies to package.json", () => {
    const result = evaluateConstitutionGuard(
      "package.json",
      "write",
      JSON.stringify({ ...JSON.parse(originalPkgJson), dependencies: { ...JSON.parse(originalPkgJson).dependencies, "evil-pkg": "1.0.0" } })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONSTITUTION_VIOLATION");
      expect(result.error.message).toContain("package.json");
    }
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEvent.mock.calls[0][0].meta.rule).toBe("Rule 4");
  });

  it("allows modification of skills/greet-tool/index.ts", () => {
    const result = evaluateConstitutionGuard("skills/greet-tool/index.ts", "write", "export default {}");
    expect(result.success).toBe(true);
  });

  it("allows modification of test files", () => {
    const result = evaluateConstitutionGuard("tests/core/constitution-guard.test.ts", "write", "// test");
    expect(result.success).toBe(true);
  });

  it("allows package.json modification without new dependencies", () => {
    const pkg = JSON.parse(originalPkgJson);
    pkg.description = "Updated description";
    const result = evaluateConstitutionGuard("package.json", "write", JSON.stringify(pkg));
    expect(result.success).toBe(true);
  });

  it("isConstitutionallyProtected returns true for immutable paths", () => {
    expect(isConstitutionallyProtected("core/rule-engine.ts")).toBe(true);
    expect(isConstitutionallyProtected("core/config.ts")).toBe(true);
  });

  it("isConstitutionallyProtected returns false for regular skills", () => {
    expect(isConstitutionallyProtected("skills/greet-tool/index.ts")).toBe(false);
    expect(isConstitutionallyProtected("tests/core/constitution-guard.test.ts")).toBe(false);
  });
});
