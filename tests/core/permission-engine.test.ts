import { describe, it, expect } from "vitest";
import { evaluatePermissionRules, loadProjectRules, type PermissionRule } from "../../core/permission-engine.ts";
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
});
