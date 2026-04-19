import { describe, it, expect } from "vitest";
import { evaluateRules, runPermissionPipeline, resolveSubagentTools, evaluateConditionalRules } from "../../core/permission-gate.ts";
import { buildTool } from "../../core/tool-framework.ts";
import { z } from "zod";
import type { ToolPermissionContext } from "../../types/index.ts";

function makeCtx(overrides: Partial<ToolPermissionContext> = {}): ToolPermissionContext {
  return {
    alwaysAllowRules: [],
    alwaysDenyRules: [],
    alwaysAskRules: [],
    mode: "interactive",
    source: "cli",
    readOnly: false,
    ...overrides,
  };
}

describe("Permission Gate", () => {
  describe("evaluateConditionalRules", () => {
    it("returns null when no conditional rules match", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test" }, [
        { toolPattern: "read_file", path: "path", operator: "equals", value: "/tmp/test", action: "deny" },
      ]);
      expect(result).toBeNull();
    });

    it("returns null when conditionalRules is empty", () => {
      expect(evaluateConditionalRules("write_file", {}, [])).toBeNull();
      expect(evaluateConditionalRules("write_file", {}, undefined)).toBeNull();
    });

    it("matches based on operator equals", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test" }, [
        { toolPattern: "write_file", path: "path", operator: "equals", value: "/tmp/test", action: "deny" },
      ]);
      expect(result).toBe("deny");
    });

    it("matches based on operator contains", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test.txt" }, [
        { toolPattern: "write_file", path: "path", operator: "contains", value: "test", action: "ask" },
      ]);
      expect(result).toBe("ask");
    });

    it("does not match when actual value is undefined", () => {
      const result = evaluateConditionalRules("write_file", {}, [
        { toolPattern: "write_file", path: "missing", operator: "equals", value: "x", action: "deny" },
      ]);
      expect(result).toBeNull();
    });

    it("does not match when nested path key is missing", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test" }, [
        { toolPattern: "write_file", path: "path.nonexistent", operator: "equals", value: "x", action: "deny" },
      ]);
      expect(result).toBeNull();
    });

    it("matches based on operator gt", () => {
      const result = evaluateConditionalRules("write_file", { size: 100 }, [
        { toolPattern: "write_file", path: "size", operator: "gt", value: 50, action: "deny" },
      ]);
      expect(result).toBe("deny");
    });

    it("matches based on operator gt with string values", () => {
      const result = evaluateConditionalRules("write_file", { size: "100" }, [
        { toolPattern: "write_file", path: "size", operator: "gt", value: "50", action: "deny" },
      ]);
      expect(result).toBe("deny");
    });

    it("does not match operator gt when value is not a number", () => {
      const result = evaluateConditionalRules("write_file", { size: "abc" }, [
        { toolPattern: "write_file", path: "size", operator: "gt", value: 50, action: "deny" },
      ]);
      expect(result).toBeNull();
    });

    it("matches based on operator lt", () => {
      const result = evaluateConditionalRules("write_file", { size: 10 }, [
        { toolPattern: "write_file", path: "size", operator: "lt", value: 50, action: "ask" },
      ]);
      expect(result).toBe("ask");
    });

    it("matches based on operator regex", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/secret.txt" }, [
        { toolPattern: "write_file", path: "path", operator: "regex", value: "secret", action: "deny" },
      ]);
      expect(result).toBe("deny");
    });

    it("invalid regex in conditional rule falls back to no match", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test.txt" }, [
        { toolPattern: "write_file", path: "path", operator: "regex", value: "[invalid", action: "deny" },
      ]);
      expect(result).toBeNull();
    });

    it("matches based on operator startsWith", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test.txt" }, [
        { toolPattern: "write_file", path: "path", operator: "startsWith", value: "/tmp/", action: "deny" },
      ]);
      expect(result).toBe("deny");
    });

    it("matches based on operator endsWith", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test.txt" }, [
        { toolPattern: "write_file", path: "path", operator: "endsWith", value: ".txt", action: "ask" },
      ]);
      expect(result).toBe("ask");
    });

    it("falls back to default for unknown operator", () => {
      const result = evaluateConditionalRules("write_file", { path: "/tmp/test" }, [
        { toolPattern: "write_file", path: "path", operator: "unknown" as "equals", value: "test", action: "deny" },
      ]);
      expect(result).toBeNull();
    });
  });

  describe("evaluateRules", () => {
    it("deny beats allow", () => {
      const ctx = makeCtx({ alwaysDenyRules: ["file_*"], alwaysAllowRules: ["file_read"] });
      expect(evaluateRules("file_read", ctx)).toBe("deny");
    });

    it("wildcard matching works", () => {
      const ctx = makeCtx({ alwaysAllowRules: ["file_*"] });
      expect(evaluateRules("file_write", ctx)).toBe("allow");
      expect(evaluateRules("shell_exec", ctx)).toBe("ask");
    });

    it("escapes regex metacharacters in wildcards", () => {
      const ctx = makeCtx({ alwaysAllowRules: ["tool.+"] });
      // Should match literal "tool.+" because regex metacharacters are escaped
      expect(evaluateRules("tool.+", ctx)).toBe("allow");
      expect(evaluateRules("toolX", ctx)).toBe("ask");
    });
  });

  describe("runPermissionPipeline", () => {
    const readTool = buildTool({
      name: "read_file",
      description: "read",
      inputSchema: z.object({ path: z.string() }),
      isReadOnly: true,
      async call() {
        return {};
      },
    });

    const writeTool = buildTool({
      name: "write_file",
      description: "write",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      isReadOnly: false,
      async call() {
        return {};
      },
    });

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

    it("readOnly sandbox denies write tools", () => {
      const ctx = makeCtx({ readOnly: true });
      const res = runPermissionPipeline({ tool: writeTool, toolInput: {}, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("deny");
    });

    it("readOnly sandbox allows read tools", () => {
      const ctx = makeCtx({ readOnly: true });
      const res = runPermissionPipeline({ tool: readTool, toolInput: {}, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("allow");
    });

    it("tool-specific deny overrides rule allow", () => {
      const ctx = makeCtx({ alwaysAllowRules: ["danger"] });
      const res = runPermissionPipeline({ tool: restrictedTool, toolInput: {}, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("deny");
    });

    it("bypass mode allows everything", () => {
      const ctx = makeCtx({ mode: "bypass" });
      const res = runPermissionPipeline({ tool: writeTool, toolInput: {}, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("allow");
    });

    it("plan mode allows read-only, asks for writes", () => {
      const ctx = makeCtx({ mode: "plan" });
      expect((runPermissionPipeline({ tool: readTool, toolInput: {}, ctx }) as { success: true; data: string }).data).toBe("allow");
      expect((runPermissionPipeline({ tool: writeTool, toolInput: {}, ctx }) as { success: true; data: string }).data).toBe("ask");
    });

    it("conditional rule deny returns deny", () => {
      const ctx = makeCtx({
        conditionalRules: [{ toolPattern: "write_file", path: "path", operator: "equals", value: "/etc/passwd", action: "deny" }],
      });
      const res = runPermissionPipeline({ tool: writeTool, toolInput: { path: "/etc/passwd", content: "x" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("deny");
    });

    it("conditional rule ask returns ask", () => {
      const ctx = makeCtx({
        conditionalRules: [{ toolPattern: "write_file", path: "path", operator: "equals", value: "/tmp/test", action: "ask" }],
      });
      const res = runPermissionPipeline({ tool: writeTool, toolInput: { path: "/tmp/test", content: "x" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("ask");
    });

    it("conditional rule allow with tool-specific deny results in deny", () => {
      const ctx = makeCtx({
        conditionalRules: [{ toolPattern: "danger", path: "x", operator: "equals", value: "y", action: "allow" }],
      });
      const res = runPermissionPipeline({ tool: restrictedTool, toolInput: {}, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("deny");
    });

    it("conditional rule allow with bypass mode results in allow", () => {
      const ctx = makeCtx({
        mode: "bypass",
        conditionalRules: [{ toolPattern: "write_file", path: "path", operator: "equals", value: "/tmp/test", action: "allow" }],
      });
      const res = runPermissionPipeline({ tool: writeTool, toolInput: { path: "/tmp/test", content: "x" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("allow");
    });

    it("conditional rule allow with plan mode on write tool results in ask", () => {
      const ctx = makeCtx({
        mode: "plan",
        conditionalRules: [{ toolPattern: "write_file", path: "path", operator: "equals", value: "/tmp/test", action: "allow" }],
      });
      const res = runPermissionPipeline({ tool: writeTool, toolInput: { path: "/tmp/test", content: "x" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("ask");
    });

    it("conditional rule allow with plan mode on read tool results in allow", () => {
      const ctx = makeCtx({
        mode: "plan",
        conditionalRules: [{ toolPattern: "read_file", path: "path", operator: "equals", value: "/tmp/test", action: "allow" }],
      });
      const res = runPermissionPipeline({ tool: readTool, toolInput: { path: "/tmp/test" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("allow");
    });

    it("conditional rule with tool-specific check failure returns error", () => {
      const failingTool = buildTool({
        name: "fail_conditional",
        description: "fails",
        inputSchema: z.object({ x: z.string() }),
        checkPermissions() {
          return { success: false, error: { code: "CHECK_FAILED", message: "nope" } };
        },
        async call() {
          return {};
        },
      });
      const ctx = makeCtx({
        conditionalRules: [{ toolPattern: "fail_conditional", path: "x", operator: "equals", value: "y", action: "allow" }],
      });
      const res = runPermissionPipeline({ tool: failingTool, toolInput: { x: "y" }, ctx });
      expect(res.success).toBe(false);
    });

    it("bash dangerous command downgrades allow to ask", () => {
      const bashTool = buildTool({
        name: "bash",
        description: "bash",
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: false,
        async call() {
          return {};
        },
      });
      const ctx = makeCtx({ alwaysAllowRules: ["bash"] });
      const res = runPermissionPipeline({ tool: bashTool, toolInput: { command: "rm -rf /" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("ask");
    });

    it("shell caution command downgrades allow to ask", () => {
      const shellTool = buildTool({
        name: "shell",
        description: "shell",
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: false,
        async call() {
          return {};
        },
      });
      const ctx = makeCtx({ alwaysAllowRules: ["shell"] });
      const res = runPermissionPipeline({ tool: shellTool, toolInput: { command: "sudo ls" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("ask");
    });

    it("bash safe command stays allow", () => {
      const bashTool = buildTool({
        name: "bash",
        description: "bash",
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: false,
        async call() {
          return {};
        },
      });
      const ctx = makeCtx({ alwaysAllowRules: ["bash"] });
      const res = runPermissionPipeline({ tool: bashTool, toolInput: { command: "ls -la" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("allow");
    });

    it("name-based deny rule returns deny when no conditional rules match", () => {
      const ctx = makeCtx({ alwaysDenyRules: ["write_file"] });
      const res = runPermissionPipeline({ tool: writeTool, toolInput: { path: "/tmp/test", content: "x" }, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("deny");
    });

    it("tool-specific check failure in non-conditional path returns error", () => {
      const failingTool = buildTool({
        name: "fail_tool",
        description: "fails",
        inputSchema: z.object({}),
        checkPermissions() {
          return { success: false, error: { code: "CHECK_FAILED", message: "nope" } };
        },
        async call() {
          return {};
        },
      });
      const ctx = makeCtx({ alwaysAllowRules: ["fail_tool"] });
      const res = runPermissionPipeline({ tool: failingTool, toolInput: {}, ctx });
      expect(res.success).toBe(false);
    });

    it("bash tool with no command property treats command as empty", () => {
      const bashTool = buildTool({
        name: "bash",
        description: "bash",
        inputSchema: z.object({ command: z.string().optional() }),
        isReadOnly: false,
        async call() {
          return {};
        },
      });
      const ctx = makeCtx({ alwaysAllowRules: ["bash"] });
      const res = runPermissionPipeline({ tool: bashTool, toolInput: {}, ctx });
      expect(res.success).toBe(true);
      expect((res as { success: true; data: string }).data).toBe("allow");
    });
  });

  describe("resolveSubagentTools", () => {
    const tools = [
      buildTool({ name: "read_file", description: "r", inputSchema: z.object({}), isReadOnly: true, async call() { return {}; } }),
      buildTool({ name: "write_file", description: "w", inputSchema: z.object({}), isReadOnly: false, async call() { return {}; } }),
      buildTool({ name: "self_modify", description: "sm", inputSchema: z.object({}), async call() { return {}; } }),
    ];

    it("removes globally disallowed tools", () => {
      const pool = resolveSubagentTools(tools, {});
      expect(pool.map((t) => t.name)).not.toContain("self_modify");
    });

    it("async mode keeps only read-only + allowed async tools", () => {
      const pool = resolveSubagentTools(tools, { isAsync: true });
      expect(pool.map((t) => t.name)).toContain("read_file");
      expect(pool.map((t) => t.name)).not.toContain("write_file");
    });

    it("extra deny list filters tools", () => {
      const pool = resolveSubagentTools(tools, { extraDenyList: ["read_file"] });
      expect(pool.map((t) => t.name)).not.toContain("read_file");
    });

    it("strict mode keeps only read-only", () => {
      const pool = resolveSubagentTools(tools, { permissionMode: "strict" });
      expect(pool.map((t) => t.name)).toEqual(["read_file"]);
    });
  });
});
