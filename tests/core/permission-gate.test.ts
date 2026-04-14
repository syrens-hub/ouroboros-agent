import { describe, it, expect } from "vitest";
import { evaluateRules, runPermissionPipeline, resolveSubagentTools } from "../../core/permission-gate.ts";
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
