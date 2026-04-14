/**
 * Ouroboros Structured Logger
 * =============================
 * Lightweight log level wrapper. Supports LOG_LEVEL and LOG_FORMAT env overrides.
 * Optional file output via LOG_FILE env variable.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { dirname } from "path";
import { appConfig } from "./config.ts";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[appConfig.log.level] ?? 1;
const JSON_FORMAT = appConfig.log.format === "json";
const LOG_FILE = process.env.LOG_FILE || "";
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function rotateLogIfNeeded(filePath: string): void {
  if (!existsSync(filePath)) return;
  try {
    const stats = statSync(filePath);
    if (stats.size >= MAX_LOG_SIZE_BYTES) {
      renameSync(filePath, `${filePath}.1`);
    }
  } catch {
    // ignore rotation errors
  }
}

function writeToFile(filePath: string, line: string): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotateLogIfNeeded(filePath);
    appendFileSync(filePath, line + "\n", "utf-8");
  } catch {
    // ignore file write errors to keep console logging available
  }
}

function log(level: keyof typeof LEVELS, message: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < currentLevel) return;
  const ts = new Date().toISOString();
  if (JSON_FORMAT) {
    const entry: Record<string, unknown> = {
      timestamp: ts,
      level: level.toUpperCase(),
      message,
      ...meta,
    };
    const line = JSON.stringify(entry);
    console.log(line);
    if (LOG_FILE) writeToFile(LOG_FILE, line);
    return;
  }
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (meta && Object.keys(meta).length > 0) {
    console.log(prefix, message, meta);
    if (LOG_FILE) writeToFile(LOG_FILE, `${prefix} ${message} ${JSON.stringify(meta)}`);
  } else {
    console.log(prefix, message);
    if (LOG_FILE) writeToFile(LOG_FILE, `${prefix} ${message}`);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
