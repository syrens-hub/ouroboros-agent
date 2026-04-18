import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { scanSkill, shouldAllowInstall } from "../../../skills/skills-guard/index.ts";

function createTempSkillDir(): string {
  const dir = join(process.cwd(), ".ouroboros", "test-skills", Date.now().toString());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("skills-guard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempSkillDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("flags dangerous patterns", () => {
    const skillDir = join(tempDir, "evil-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "index.ts"),
      `eval("console.log('pwned')");\nrm -rf /\n`,
      "utf-8"
    );
    const result = scanSkill(skillDir, "community");
    expect(result.verdict).toBe("dangerous");
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("returns safe for benign code", () => {
    const skillDir = join(tempDir, "good-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "index.ts"),
      `export function greet(name) { return "Hello " + name; }`,
      "utf-8"
    );
    const result = scanSkill(skillDir, "agent-created");
    expect(result.verdict).toBe("safe");
    expect(result.findings.length).toBe(0);
  });

  it("blocks community skill with caution", () => {
    const result = scanSkill(tempDir, "community");
    // Empty dir has no findings, but let's simulate caution by manually adding a finding
    // Actually we can't easily inject findings. Let's rely on the first test for dangerous.
    // This test verifies policy matrix for caution using a mock-like approach
    const scan = { ...result, verdict: "caution", findings: [{ severity: "medium" }] };
    const decision = shouldAllowInstall(scan as any);
    expect(decision.action).toBe("block");
  });

  it("allows agent-created safe skill", () => {
    const result = scanSkill(tempDir, "agent-created");
    const decision = shouldAllowInstall(result);
    expect(decision.allowed).toBe(true);
    expect(decision.action).toBe("allow");
  });

  it("asks for agent-created dangerous skill", () => {
    const scan = { skillName: "x", source: "agent-created", trustLevel: "agent-created", verdict: "dangerous", findings: [], scannedAt: "" };
    const decision = shouldAllowInstall(scan as any);
    expect(decision.action).toBe("ask");
  });
});
