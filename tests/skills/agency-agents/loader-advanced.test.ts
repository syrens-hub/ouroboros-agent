import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadAgentsFromDir } from "../../../skills/agency-agents/loader.ts";

describe("loadAgentsFromDir advanced", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agency-agents-test-"));
  });

  afterEach(() => {
    // vitest isolation handles cleanup
  });

  it("recursively scans nested directories", () => {
    mkdirSync(join(tempDir, "engineering"), { recursive: true });
    mkdirSync(join(tempDir, "engineering", "ai"), { recursive: true });
    writeFileSync(
      join(tempDir, "engineering", "ai", "ai-researcher.md"),
      "---\nname: AI Researcher\ndescription: Deep learning specialist\n---\nYou research AI.",
      "utf-8"
    );

    const agents = loadAgentsFromDir(tempDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("AI Researcher");
    expect(agents[0].division).toBe("engineering");
  });

  it("parses multiline frontmatter values", () => {
    writeFileSync(
      join(tempDir, "test-agent.md"),
      "---\nname: Test Agent\ndescription: |\n  This is a multiline\n  description block.\nvibe: Friendly\n---\nContent here.",
      "utf-8"
    );

    const agents = loadAgentsFromDir(tempDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].description).toContain("multiline");
    expect(agents[0].vibe).toBe("Friendly");
  });

  it("parses array frontmatter values", () => {
    writeFileSync(
      join(tempDir, "test-agent.md"),
      "---\nname: Test Agent\nskills:\n  - coding\n  - debugging\n  - testing\n---\nContent here.",
      "utf-8"
    );

    const agents = loadAgentsFromDir(tempDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("test-agent");
  });

  it("handles flat files in root as general division", () => {
    writeFileSync(
      join(tempDir, "orchestrator.md"),
      "---\nname: Orchestrator\ndescription: Coordinates agents\n---\nYou coordinate.",
      "utf-8"
    );

    const agents = loadAgentsFromDir(tempDir);
    expect(agents[0].division).toBe("general");
  });
});
