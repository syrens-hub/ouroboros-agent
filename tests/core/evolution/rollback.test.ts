import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPendingMarker, clearPendingMarker, hasPendingMarker, checkAndRollback } from "../../../core/evolution/rollback.ts";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const MARKER = join(process.cwd(), ".ouroboros", "evolution-pending.json");

describe("evolution rollback", () => {
  beforeEach(() => {
    if (existsSync(MARKER)) unlinkSync(MARKER);
  });
  afterEach(() => {
    if (existsSync(MARKER)) unlinkSync(MARKER);
  });

  it("creates and clears marker", () => {
    expect(hasPendingMarker()).toBe(false);
    createPendingMarker("/tmp/backup", "v1");
    expect(hasPendingMarker()).toBe(true);
    clearPendingMarker();
    expect(hasPendingMarker()).toBe(false);
  });

  it("returns false when no marker exists", async () => {
    const result = await checkAndRollback();
    expect(result).toBe(false);
  });

  it("skips rollback within grace period", async () => {
    createPendingMarker("/tmp/backup", "v1");
    const result = await checkAndRollback();
    expect(result).toBe(false);
    expect(hasPendingMarker()).toBe(true);
  });

  it("attempts rollback when marker is old", async () => {
    const oldMarker = { backupDir: "/tmp/backup", versionId: "v1", appliedAt: Date.now() - 10 * 60 * 1000 };
    writeFileSync(MARKER, JSON.stringify(oldMarker), "utf-8");
    const result = await checkAndRollback();
    expect(result).toBe(true);
    expect(hasPendingMarker()).toBe(false);
  });
});
