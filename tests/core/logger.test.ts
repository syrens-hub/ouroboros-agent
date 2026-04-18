import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ouroboros-logger-"));

async function importLogger(
  opts: {
    level?: "debug" | "info" | "warn" | "error";
    format?: "text" | "json";
    logFile?: string;
  } = {},
) {
  vi.resetModules();
  if (opts.logFile !== undefined) {
    if (opts.logFile) process.env.LOG_FILE = opts.logFile;
    else delete process.env.LOG_FILE;
  }
  const { appConfig } = await import("../../core/config.ts");
  if (opts.level) appConfig.log.level = opts.level;
  if (opts.format) (appConfig.log as { format: string }).format = opts.format;
  const mod = await import("../../core/logger.ts");
  return mod.logger;
}

describe("logger", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    delete process.env.LOG_FILE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("outputs logger.info to console when level is info", async () => {
    const logger = await importLogger({ level: "info", format: "text" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("hello");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\]$/,
    );
    expect(spy.mock.calls[0][1]).toBe("hello");
  });

  it("does not output logger.debug when level is info", async () => {
    const logger = await importLogger({ level: "info", format: "text" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.debug("hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("outputs logger.warn with meta in text format", async () => {
    const logger = await importLogger({ level: "info", format: "text" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.warn("hello", { foo: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(
      /^\[.*\] \[WARN\]$/,
    );
    expect(spy.mock.calls[0][1]).toBe("hello");
    expect(spy.mock.calls[0][2]).toEqual({ foo: 1 });
  });

  it("outputs logger.warn with meta in JSON format", async () => {
    const logger = await importLogger({ level: "info", format: "json" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.warn("hello", { foo: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      level: "WARN",
      message: "hello",
      foo: 1,
    });
    expect(entry.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("appends logs to file when LOG_FILE is set", async () => {
    const logPath = join(TEST_DIR, "file.log");
    const logger = await importLogger({
      level: "info",
      format: "text",
      logFile: logPath,
    });
    logger.info("file test");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("file test");
    expect(content).toContain("[INFO]");
  });

  it("rotates log file when it exceeds 10 MB", async () => {
    const logPath = join(TEST_DIR, "rotation.log");
    const bigContent = Buffer.alloc(10 * 1024 * 1024 + 1, "x");
    writeFileSync(logPath, bigContent);
    const logger = await importLogger({
      level: "info",
      format: "text",
      logFile: logPath,
    });
    logger.info("rotated");
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(readFileSync(`${logPath}.1`, "utf-8").length).toBe(
      10 * 1024 * 1024 + 1,
    );
    const current = readFileSync(logPath, "utf-8");
    expect(current).toContain("rotated");
  });

  it("creates parent directory recursively if it does not exist", async () => {
    const logPath = join(TEST_DIR, "nested", "deep", "app.log");
    const logger = await importLogger({
      level: "info",
      format: "text",
      logFile: logPath,
    });
    logger.info("dir test");
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("dir test");
  });
});
