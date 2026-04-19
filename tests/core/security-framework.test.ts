import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PathValidator,
  SecurityAuditor,
  ToolRateLimiter,
  createSecurityFramework,
  pruneSecurityAuditLogs,
} from "../../core/security-framework.ts";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("PathValidator", () => {
  it("returns true for safe paths when no patterns are set", () => {
    const validator = new PathValidator([]);
    expect(validator.validate("/home/user/file.txt")).toBe(true);
  });

  it("blocks paths matching a glob deny pattern", () => {
    const validator = new PathValidator(["/etc/*", "*.key"]);
    expect(validator.validate("/etc/passwd")).toBe(false);
    expect(validator.validate("secrets.key")).toBe(false);
  });

  it("allows paths that do not match any deny pattern", () => {
    const validator = new PathValidator(["/etc/*", "*.key"]);
    expect(validator.validate("/home/user/file.txt")).toBe(true);
    expect(validator.validate("/etc")).toBe(true);
    expect(validator.validate("secrets.pem")).toBe(true);
  });

  it("supports wildcard anywhere in the pattern", () => {
    const validator = new PathValidator(["*_secret_*"]);
    expect(validator.validate("my_secret_file.txt")).toBe(false);
    expect(validator.validate("my_public_file.txt")).toBe(true);
  });
});

describe("SecurityAuditor", () => {
  let auditor: SecurityAuditor;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `security-audit-${Date.now()}.db`);
    auditor = new SecurityAuditor(dbPath);
  });

  afterEach(() => {
    auditor.close();
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  });

  it("logs and retrieves audit decisions", () => {
    auditor.logDecision("sess_1", "read_file", { path: "/tmp/test" }, "allow", "safe path");
    auditor.logDecision("sess_1", "write_file", { path: "/tmp/test" }, "deny", "blocked by rules");

    const audits = auditor.getRecentAudits(undefined, 10);
    expect(audits.length).toBe(2);
    expect(audits[0].session_id).toBe("sess_1");
    expect(audits[0].tool_name).toBe("write_file");
    expect(audits[0].decision).toBe("deny");
    expect(audits[0].reason).toBe("blocked by rules");
    expect(JSON.parse(audits[1].input_json)).toEqual({ path: "/tmp/test" });
  });

  it("filters audits by session id", () => {
    auditor.logDecision("sess_a", "tool", {}, "allow", "");
    auditor.logDecision("sess_b", "tool", {}, "allow", "");

    const audits = auditor.getRecentAudits("sess_a", 10);
    expect(audits.length).toBe(1);
    expect(audits[0].session_id).toBe("sess_a");
  });

  it("respects the limit parameter", () => {
    auditor.logDecision("sess_1", "tool", {}, "allow", "");
    auditor.logDecision("sess_1", "tool", {}, "allow", "");
    auditor.logDecision("sess_1", "tool", {}, "allow", "");

    const audits = auditor.getRecentAudits(undefined, 2);
    expect(audits.length).toBe(2);
  });

  it("pruneOldLogs removes entries older than threshold", async () => {
    auditor.logDecision("sess_1", "tool", {}, "allow", "");
    await new Promise((r) => setTimeout(r, 10));
    const deleted = auditor.pruneOldLogs(5);
    expect(deleted).toBe(1);
    expect(auditor.getRecentAudits(undefined, 10).length).toBe(0);
  });

  it("pruneOldLogs returns 0 when nothing is old enough", () => {
    auditor.logDecision("sess_1", "tool", {}, "allow", "");
    const deleted = auditor.pruneOldLogs(100000);
    expect(deleted).toBe(0);
  });
});

describe("ToolRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = new ToolRateLimiter();
    const r1 = limiter.checkToolRateLimit("s1", "t1", 3, 1000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.checkToolRateLimit("s1", "t1", 3, 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
  });

  it("blocks requests over the limit", () => {
    const limiter = new ToolRateLimiter();
    limiter.checkToolRateLimit("s1", "t1", 2, 1000);
    limiter.checkToolRateLimit("s1", "t1", 2, 1000);
    const r3 = limiter.checkToolRateLimit("s1", "t1", 2, 1000);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfter).toBeGreaterThan(0);
  });

  it("resets after the window expires", async () => {
    const limiter = new ToolRateLimiter();
    limiter.checkToolRateLimit("s1", "t1", 1, 50);
    const blocked = limiter.checkToolRateLimit("s1", "t1", 1, 50);
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 60));

    const reset = limiter.checkToolRateLimit("s1", "t1", 1, 50);
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(0);
  });

  it("tracks different session and tool keys independently", () => {
    const limiter = new ToolRateLimiter();
    limiter.checkToolRateLimit("s1", "t1", 1, 1000);
    const otherSession = limiter.checkToolRateLimit("s2", "t1", 1, 1000);
    expect(otherSession.allowed).toBe(true);

    const otherTool = limiter.checkToolRateLimit("s1", "t2", 1, 1000);
    expect(otherTool.allowed).toBe(true);
  });
});

describe("createSecurityFramework", () => {
  it("returns all components", () => {
    const fw = createSecurityFramework({ dbPath: ":memory:" });
    expect(fw.pathValidator).toBeInstanceOf(PathValidator);
    expect(fw.securityAuditor).toBeInstanceOf(SecurityAuditor);
    expect(fw.toolRateLimiter).toBeInstanceOf(ToolRateLimiter);
    fw.securityAuditor.close();
  });
});

describe("pruneSecurityAuditLogs", () => {
  it("prunes old logs and returns deleted count", () => {
    const auditor = new SecurityAuditor();
    auditor.logDecision("sess_1", "tool", {}, "allow", "");
    auditor.close();

    const deleted = pruneSecurityAuditLogs(-1);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
