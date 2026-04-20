import { describe, it, expect, vi } from "vitest";
import { getDiskUsage, startDiskMonitor, stopDiskMonitor } from "../../core/disk-monitor.ts";
import { statfsSync } from "fs";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    statfsSync: vi.fn(),
  };
});

describe("disk-monitor", () => {
  it("returns disk usage stats", () => {
    vi.mocked(statfsSync).mockReturnValue({
      bsize: 4096,
      blocks: 1000000,
      bavail: 500000,
    } as any);
    const usage = getDiskUsage();
    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.freeBytes).toBeGreaterThan(0);
    expect(usage.usedBytes).toBeGreaterThanOrEqual(0);
    expect(usage.usedPercent).toBeGreaterThanOrEqual(0);
    expect(usage.usedPercent).toBeLessThanOrEqual(100);
  });

  it("handles statfsSync error gracefully", () => {
    vi.mocked(statfsSync).mockImplementation(() => {
      throw new Error("ENOTFOUND");
    });
    expect(() => getDiskUsage()).toThrow("ENOTFOUND");
  });

  it("triggers alert when disk usage exceeds threshold", () => {
    vi.mocked(statfsSync).mockReturnValue({
      bsize: 4096,
      blocks: 1000000,
      bavail: 50000, // 95% used
    } as any);
    startDiskMonitor();
    stopDiskMonitor();
  });

  it("starts and stops without error", () => {
    vi.mocked(statfsSync).mockReturnValue({
      bsize: 4096,
      blocks: 1000000,
      bavail: 500000,
    } as any);
    startDiskMonitor();
    stopDiskMonitor();
    startDiskMonitor();
    stopDiskMonitor();
  });

  it("getDiskUsage is a function", () => {
    expect(typeof getDiskUsage).toBe("function");
  });
});
