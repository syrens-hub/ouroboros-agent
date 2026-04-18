import { describe, it, expect } from "vitest";
import { createSandboxContext, resolveSandboxPath } from "../../../skills/sandbox/index.ts";
import { existsSync, rmdirSync } from "fs";

const dummyLoopState = {
  messages: [],
  toolResults: [],
  turnCount: 0,
} as any;

describe("sandbox", () => {
  it("creates a sandbox directory on context creation", () => {
    const sandbox = createSandboxContext(
      { loopState: dummyLoopState, abortController: new AbortController() },
      { readOnly: true }
    );
    expect(existsSync(sandbox.sandboxDir)).toBe(true);
    // cleanup
    try { rmdirSync(sandbox.sandboxDir); } catch { /* ignore */ }
  });

  it("resolveSandboxPath resolves child files correctly", () => {
    const sandbox = createSandboxContext(
      { loopState: dummyLoopState, abortController: new AbortController() },
      { readOnly: false }
    );
    const result = resolveSandboxPath(sandbox, "notes.txt");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toContain("notes.txt");
    }
    try { rmdirSync(sandbox.sandboxDir); } catch { /* ignore */ }
  });

  it("resolveSandboxPath blocks directory traversal escapes", () => {
    const sandbox = createSandboxContext(
      { loopState: dummyLoopState, abortController: new AbortController() },
      { readOnly: false }
    );
    const result = resolveSandboxPath(sandbox, "../../core/config.ts");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("ESCAPE");
    }
    try { rmdirSync(sandbox.sandboxDir); } catch { /* ignore */ }
  });

  it("resolveSandboxPath blocks absolute path escapes", () => {
    const sandbox = createSandboxContext(
      { loopState: dummyLoopState, abortController: new AbortController() },
      { readOnly: false }
    );
    const result = resolveSandboxPath(sandbox, "/etc/passwd");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("ESCAPE");
    }
    try { rmdirSync(sandbox.sandboxDir); } catch { /* ignore */ }
  });
});
