import { describe, it, expect } from "vitest";
import { evaluatePermissionRules, loadProjectRules, buildPermissionEngineConfig, type PermissionRule } from "../../core/permission-engine.ts";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("permission-engine", () => {
  it("exact match wins", () => {
    const rules = [{ source: "session", behavior: "deny", pattern: "self_modify" }];
    expect(evaluatePermissionRules("self_modify", rules as PermissionRule[])).toBe("deny");
  });

  it("glob match works", () => {
    const rules = [{ source: "project", behavior: "ask", pattern: "file_*" }];
    expect(evaluatePermissionRules("file_read", rules as PermissionRule[])).toBe("ask");
    expect(evaluatePermissionRules("bash", rules as PermissionRule[])).toBeNull();
  });

  it("wildcard matches all", () => {
    const rules = [{ source: "cli", behavior: "allow", pattern: "*" }];
    expect(evaluatePermissionRules("anything", rules as PermissionRule[])).toBe("allow");
  });

  it("first match wins", () => {
    const rules = [
      { source: "session", behavior: "allow", pattern: "bash" },
      { source: "project", behavior: "deny", pattern: "bash" },
    ];
    expect(evaluatePermissionRules("bash", rules as PermissionRule[])).toBe("allow");
  });

  it("loads project rules from .ouroboros/permissions.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ouro-perm-"));
    mkdirSync(join(dir, ".ouroboros"), { recursive: true });
    writeFileSync(
      join(dir, ".ouroboros", "permissions.json"),
      JSON.stringify({ rules: [{ source: "project", behavior: "deny", pattern: "rm" }] })
    );
    const rules = loadProjectRules(dir);
    expect(rules.length).toBe(1);
    expect(rules[0]!.behavior).toBe("deny");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when file missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ouro-perm2-"));
    expect(loadProjectRules(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when permissions.json is unreadable (e.g., a directory)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ouro-perm3-"));
    mkdirSync(join(dir, ".ouroboros"), { recursive: true });
    mkdirSync(join(dir, ".ouroboros", "permissions.json"), { recursive: true });
    expect(loadProjectRules(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("buildPermissionEngineConfig combines session and project rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "ouro-perm4-"));
    mkdirSync(join(dir, ".ouroboros"), { recursive: true });
    writeFileSync(
      join(dir, ".ouroboros", "permissions.json"),
      JSON.stringify({ rules: [{ source: "project", behavior: "allow", pattern: "read_file" }] })
    );
    const sessionRules: PermissionRule[] = [{ source: "session", behavior: "deny", pattern: "rm" }];
    const config = buildPermissionEngineConfig(dir, sessionRules, "bypass");
    expect(config.mode).toBe("bypass");
    expect(config.rules.length).toBe(2);
    expect(config.rules[0]).toEqual(sessionRules[0]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("toolPattern mismatch skips the rule", () => {
    const rules = [
      { source: "session", behavior: "deny", pattern: "*", toolPattern: "other_tool" },
      { source: "session", behavior: "allow", pattern: "*" },
    ];
    expect(evaluatePermissionRules("my_tool", rules as PermissionRule[])).toBe("allow");
  });

  it("returns empty array when permissions.json contains invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ouro-perm5-"));
    mkdirSync(join(dir, ".ouroboros"), { recursive: true });
    writeFileSync(join(dir, ".ouroboros", "permissions.json"), "not json");
    expect(loadProjectRules(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
