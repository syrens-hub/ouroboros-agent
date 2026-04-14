import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmdirSync, utimesSync } from "fs";
import { join } from "path";
import { cleanupOldUploads } from "../../web/server.ts";

describe("Upload Cleanup", () => {
  const uploadsDir = join(process.cwd(), ".ouroboros", "uploads");
  const sessionDir = join(uploadsDir, "test-cleanup-session");
  const oldFile = join(sessionDir, "old-file.txt");
  const newFile = join(sessionDir, "new-file.txt");

  beforeEach(() => {
    // Ensure clean state
    if (existsSync(sessionDir)) {
      rmdirSync(sessionDir, { recursive: true });
    }
    mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(sessionDir)) {
      rmdirSync(sessionDir, { recursive: true });
    }
  });

  it("deletes files older than maxAgeDays and removes empty directories", () => {
    writeFileSync(oldFile, "old content");
    writeFileSync(newFile, "new content");

    // Backdate one file to 31 days ago
    const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, oldTime, oldTime);

    expect(existsSync(oldFile)).toBe(true);
    expect(existsSync(newFile)).toBe(true);

    const { deleted, dirsRemoved } = cleanupOldUploads(30);

    expect(deleted).toBe(1);
    expect(dirsRemoved).toBe(0);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
    expect(existsSync(sessionDir)).toBe(true);

    // Backdate remaining file and cleanup
    const oldTime2 = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(newFile, oldTime2, oldTime2);
    const { deleted: d2, dirsRemoved: r2 } = cleanupOldUploads(30);
    expect(d2).toBe(1);
    expect(r2).toBe(1);
    expect(existsSync(newFile)).toBe(false);
    expect(existsSync(sessionDir)).toBe(false);
  });

  it("keeps files newer than maxAgeDays", () => {
    writeFileSync(newFile, "new content");

    const { deleted, dirsRemoved } = cleanupOldUploads(30);

    expect(deleted).toBe(0);
    expect(dirsRemoved).toBe(0);
    expect(existsSync(newFile)).toBe(true);
    expect(existsSync(sessionDir)).toBe(true);
  });
});
