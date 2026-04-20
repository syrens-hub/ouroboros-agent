import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkPermissionV2,
  getSystemRules,
  loadPolicyRules,
  refreshPolicyRules,
  setSessionRules,
  clearSessionRules,
  getSessionRules,
  getPermissionAudits,
  prunePermissionAudits,
  initPermissionV2Tables,
} from "../../core/permission-engine-v2.ts";
import type { ACLRule } from "../../core/permission-engine-v2.ts";
import { buildTool } from "../../core/tool-framework.ts";
import { z } from "zod";
import { getDb } from "../../core/db-manager.ts";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../core/logger.ts", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Permission Engine v2", () => {
  let tmpDir: string;
  let readTool: ReturnType<typeof buildTool>;
  let writeTool: ReturnType<typeof buildTool>;
  let bashTool: ReturnType<typeof buildTool>;

  beforeEach(() => {
    initPermissionV2Tables();
    tmpDir = mkdtempSync(join(tmpdir(), "perm-v2-"));
    mkdirSync(join(tmpDir, ".ouroboros"), { recursive: true });

    readTool = buildTool({
      name: "read_file",
      description: "read",
      inputSchema: z.object({ path: z.string() }),
      isReadOnly: true,
      async call() {
        return {};
      },
    });

    writeTool = buildTool({
      name: "write_file",
      description: "write",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      isReadOnly: false,
      async call() {
        return {};
      },
    });

    bashTool = buildTool({
      name: "bash",
      description: "bash",
      inputSchema: z.object({ command: z.string() }),
      isReadOnly: false,
      async call() {
        return {};
      },
    });
  });

  afterEach(() => {
    const db = getDb();
    db.exec("DELETE FROM permission_audit_log_v2");
    rmSync(tmpDir, { recursive: true, force: true });
    clearSessionRules("sess-test");
  });

  describe("System Rules (L0)", () => {
    it("has system rules defined", () => {
      const rules = getSystemRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.every((r) => r.level === 0)).toBe(true);
    });

    it("denies self_modify at system level", () => {
      const tool = buildTool({
        name: "self_modify",
        description: "sm",
        inputSchema: z.object({}),
        async call() {
          return {};
        },
      });
      const result = checkPermissionV2({
        tool,
        toolInput: {},
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });

    it("denies rule_engine_override at system level", () => {
      const tool = buildTool({
        name: "rule_engine_override",
        description: "re",
        inputSchema: z.object({}),
        async call() {
          return {};
        },
      });
      const result = checkPermissionV2({
        tool,
        toolInput: {},
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });

    it("denies bash rm -rf / at system level", () => {
      const result = checkPermissionV2({
        tool: bashTool,
        toolInput: { command: "rm -rf /" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });

    it("allows safe bash command", () => {
      const result = checkPermissionV2({
        tool: bashTool,
        toolInput: { command: "ls -la" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("allow"); // tool default checkPermissions returns allow
    });

    it("denies writing to /etc/passwd", () => {
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/etc/passwd", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });

    it("denies writing to /etc/shadow", () => {
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/etc/shadow", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });

    it("denies writing to SSH keys", () => {
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/home/user/.ssh/id_rsa", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });

    it("denies writing to AWS credentials", () => {
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/root/.aws/credentials", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });

    it("allows writing to safe paths", () => {
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/tmp/test.txt", content: "hello" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).not.toBe("deny");
    });

    it("system deny cannot be bypassed", () => {
      const tool = buildTool({
        name: "self_modify",
        description: "sm",
        inputSchema: z.object({}),
        async call() {
          return {};
        },
      });
      const result = checkPermissionV2({
        tool,
        toolInput: {},
        sessionId: "sess-test",
        projectRoot: tmpDir,
        mode: "bypass",
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(0);
    });
  });

  describe("Read-Only Sandbox", () => {
    it("denies write tools in readOnly mode", () => {
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/tmp/test", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
        readOnly: true,
      });
      expect(result.decision).toBe("deny");
    });

    it("allows read tools in readOnly mode", () => {
      const result = checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
        readOnly: true,
      });
      expect(result.decision).toBe("allow");
    });
  });

  describe("Policy Rules (L1)", () => {
    it("loads policy rules from file", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [
            { level: 1, pattern: "write_file", behavior: "deny", reason: "No writes allowed" },
          ],
        }),
        "utf-8"
      );
      const rules = loadPolicyRules(tmpDir);
      expect(rules).toHaveLength(1);
      expect(rules[0].pattern).toBe("write_file");
    });

    it("applies loaded policy rules", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "write_file", behavior: "deny" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/tmp/test", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(1);
    });

    it("policy ask is respected", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "bash", behavior: "ask" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: bashTool,
        toolInput: { command: "ls" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("ask");
    });

    it("policy allow is respected", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "read_file", behavior: "allow" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("allow");
    });

    it("ignores invalid level values in policy file", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [
            { level: 0, pattern: "x", behavior: "deny" }, // Should be ignored (system only)
            { level: 1, pattern: "y", behavior: "deny" },
          ],
        }),
        "utf-8"
      );
      const rules = loadPolicyRules(tmpDir);
      expect(rules).toHaveLength(1);
      expect(rules[0].pattern).toBe("y");
    });
  });

  describe("Session Rules (L2)", () => {
    it("sets and gets session rules", () => {
      const rules: ACLRule[] = [{ level: 2, pattern: "bash", behavior: "deny" }];
      setSessionRules("sess-a", rules);
      expect(getSessionRules("sess-a")).toHaveLength(1);
      expect(getSessionRules("sess-b")).toHaveLength(0);
    });

    it("applies session rules", () => {
      setSessionRules("sess-test", [{ level: 2, pattern: "bash", behavior: "deny" }]);
      const result = checkPermissionV2({
        tool: bashTool,
        toolInput: { command: "ls" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(2);
    });

    it("clears session rules", () => {
      setSessionRules("sess-test", [{ level: 2, pattern: "bash", behavior: "deny" }]);
      clearSessionRules("sess-test");
      const result = checkPermissionV2({
        tool: bashTool,
        toolInput: { command: "ls" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).not.toBe("deny");
    });
  });

  describe("Tool-Level Checks (L3)", () => {
    it("respects tool-specific deny", () => {
      const restrictedTool = buildTool({
        name: "danger",
        description: "danger",
        inputSchema: z.object({}),
        checkPermissions() {
          return { success: true, data: "deny" };
        },
        async call() {
          return {};
        },
      });
      const result = checkPermissionV2({
        tool: restrictedTool,
        toolInput: {},
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(3);
    });

    it("respects tool-specific allow", () => {
      const allowedTool = buildTool({
        name: "safe",
        description: "safe",
        inputSchema: z.object({}),
        checkPermissions() {
          return { success: true, data: "allow" };
        },
        async call() {
          return {};
        },
      });
      const result = checkPermissionV2({
        tool: allowedTool,
        toolInput: {},
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("allow");
    });

    it("treats tool check failure as deny", () => {
      const failingTool = buildTool({
        name: "fail",
        description: "fail",
        inputSchema: z.object({}),
        checkPermissions() {
          return { success: false, error: { code: "CHECK_FAILED", message: "nope" } };
        },
        async call() {
          return {};
        },
      });
      const result = checkPermissionV2({
        tool: failingTool,
        toolInput: {},
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
      expect(result.level).toBe(3);
    });
  });

  describe("Mode Overrides", () => {
    it("bypass mode allows non-system rules", () => {
      setSessionRules("sess-test", [{ level: 2, pattern: "read_file", behavior: "ask" }]);
      const result = checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
        mode: "bypass",
      });
      expect(result.decision).toBe("allow");
    });

    it("plan mode allows read-only tools", () => {
      const result = checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
        mode: "plan",
      });
      expect(result.decision).toBe("allow");
    });

    it("plan mode asks for write tools", () => {
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/tmp/test", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
        mode: "plan",
      });
      expect(result.decision).toBe("ask");
    });
  });

  describe("Most Restrictive Wins", () => {
    it("policy deny beats session allow", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "bash", behavior: "deny" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      setSessionRules("sess-test", [{ level: 2, pattern: "bash", behavior: "allow" }]);
      const result = checkPermissionV2({
        tool: bashTool,
        toolInput: { command: "ls" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
    });

    it("session deny beats policy ask", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "bash", behavior: "ask" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      setSessionRules("sess-test", [{ level: 2, pattern: "bash", behavior: "deny" }]);
      const result = checkPermissionV2({
        tool: bashTool,
        toolInput: { command: "ls" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
    });

    it("tool ask with policy allow results in ask", () => {
      const askTool = buildTool({
        name: "ask_tool",
        description: "ask",
        inputSchema: z.object({}),
        checkPermissions() {
          return { success: true, data: "ask" };
        },
        async call() {
          return {};
        },
      });
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "ask_tool", behavior: "allow" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: askTool,
        toolInput: {},
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("ask");
    });
  });

  describe("Conditional Rules", () => {
    it("matches conditional policy rule", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [
            {
              level: 1,
              pattern: "write_file",
              behavior: "deny",
              condition: { path: "path", operator: "contains", value: "secret" },
            },
          ],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/tmp/my-secret.txt", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
    });

    it("does not match when condition fails", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [
            {
              level: 1,
              pattern: "write_file",
              behavior: "deny",
              condition: { path: "path", operator: "contains", value: "secret" },
            },
          ],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/tmp/public.txt", content: "x" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).not.toBe("deny");
    });
  });

  describe("Audit Logging", () => {
    it("logs permission decisions to database", () => {
      checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-audit",
        projectRoot: tmpDir,
      });
      const audits = getPermissionAudits({ sessionId: "sess-audit" });
      expect(audits.length).toBeGreaterThan(0);
      expect(audits[0].session_id).toBe("sess-audit");
      expect(audits[0].tool_name).toBe("read_file");
    });

    it("filters audits by tool name", () => {
      checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-audit",
        projectRoot: tmpDir,
      });
      checkPermissionV2({
        tool: writeTool,
        toolInput: { path: "/tmp/test", content: "x" },
        sessionId: "sess-audit",
        projectRoot: tmpDir,
      });
      const audits = getPermissionAudits({ toolName: "write_file" });
      expect(audits.every((a) => a.tool_name === "write_file")).toBe(true);
    });

    it("prunes old audits", () => {
      const db = getDb();
      db.prepare(
        `INSERT INTO permission_audit_log_v2 (session_id, tool_name, decision, level, timestamp)
         VALUES (?, ?, ?, ?, ?)`
      ).run("sess", "tool", "allow", 1, Date.now() - 100_000);
      const deleted = prunePermissionAudits(50_000);
      expect(deleted).toBe(1);
    });
  });

  describe("Glob Matching", () => {
    it("matches exact tool name", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "read_file", behavior: "allow" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("allow");
    });

    it("matches wildcard pattern", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "file_*", behavior: "allow" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("allow");
    });

    it("matches star wildcard", () => {
      const permFile = join(tmpDir, ".ouroboros", "permissions-v2.json");
      writeFileSync(
        permFile,
        JSON.stringify({
          rules: [{ level: 1, pattern: "*", behavior: "deny" }],
        }),
        "utf-8"
      );
      refreshPolicyRules(tmpDir);
      const result = checkPermissionV2({
        tool: readTool,
        toolInput: { path: "/tmp/test" },
        sessionId: "sess-test",
        projectRoot: tmpDir,
      });
      expect(result.decision).toBe("deny");
    });
  });
});
