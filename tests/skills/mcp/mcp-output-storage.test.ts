import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  persistMcpOutput,
  getMcpOutputPath,
} from "../../../skills/mcp/output-storage.ts";
import { appConfig } from "../../../core/config.ts";

// Override db.dir to a temp path for isolation
describe("mcp-output-storage", () => {
  let tempDir: string;
  const originalDir = appConfig.db.dir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ouro-mcp-"));
    appConfig.db.dir = tempDir;
  });

  afterEach(() => {
    appConfig.db.dir = originalDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not persist small outputs", () => {
    const res = persistMcpOutput("sess-1", "tu-1", "hello world");
    expect(res.persisted).toBe(false);
    expect(res.summary).toBe("hello world");
    expect(res.path).toBeUndefined();
  });

  it("persists large text outputs", () => {
    const big = "x".repeat(60_000);
    const res = persistMcpOutput("sess-1", "tu-1", big);
    expect(res.persisted).toBe(true);
    expect(res.path).toBeDefined();
    expect(res.summary).toContain("persisted to file");
    expect(existsSync(res.path!)).toBe(true);
    expect(readFileSync(res.path!, "utf-8")).toBe(big);
  });

  it("persists large JSON objects", () => {
    const obj = { data: "x".repeat(60_000) };
    const res = persistMcpOutput("sess-1", "tu-2", obj);
    expect(res.persisted).toBe(true);
    expect(existsSync(res.path!)).toBe(true);
    expect(readFileSync(res.path!, "utf-8")).toBe(JSON.stringify(obj, null, 2));
  });

  it("guesses png extension for base64 image", () => {
    const big = "data:image/png;base64," + "a".repeat(60_000);
    const path = getMcpOutputPath("sess-1", "tu-3", big);
    expect(path.endsWith(".png")).toBe(true);
  });

  it("guesses jpg extension for jpeg base64", () => {
    const big = "data:image/jpeg;base64," + "a".repeat(60_000);
    const path = getMcpOutputPath("sess-1", "tu-4", big);
    expect(path.endsWith(".jpg")).toBe(true);
  });

  it("guesses pdf extension from mimeType object", () => {
    const path = getMcpOutputPath("sess-1", "tu-5", { mimeType: "application/pdf" });
    expect(path.endsWith(".pdf")).toBe(true);
  });

  it("sanitizes filenames", () => {
    const path = getMcpOutputPath("sess/1", "tu:1", "x");
    expect(path.includes("sess_1")).toBe(true);
    expect(path.includes("tu_1")).toBe(true);
  });
});
