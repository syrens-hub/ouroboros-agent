import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getStorageProvider } from "../../../core/storage/storage-provider.ts";
import { existsSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(process.cwd(), ".ouroboros", "storage", "test-run");

describe("storage-provider", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });
  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("local provider round-trips data", async () => {
    process.env.STORAGE_TYPE = "local";
    const provider = getStorageProvider();
    await provider.save("test/hello.txt", "world");
    const data = await provider.get("test/hello.txt");
    expect(data).toBe("world");
  });

  it("local provider returns null for missing key", async () => {
    process.env.STORAGE_TYPE = "local";
    const provider = getStorageProvider();
    const data = await provider.get("nonexistent/key.txt");
    expect(data).toBeNull();
  });

  it("local provider lists keys", async () => {
    process.env.STORAGE_TYPE = "local";
    const provider = getStorageProvider();
    await provider.save("a/1.txt", "1");
    await provider.save("a/2.txt", "2");
    const keys = await provider.list("a");
    expect(keys.length).toBeGreaterThanOrEqual(2);
  });

  it("local provider deletes key", async () => {
    process.env.STORAGE_TYPE = "local";
    const provider = getStorageProvider();
    await provider.save("del.txt", "x");
    await provider.delete("del.txt");
    expect(await provider.get("del.txt")).toBeNull();
  });

  it("s3 provider stub constructs without error", () => {
    process.env.STORAGE_TYPE = "s3";
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_BUCKET = "test";
    process.env.S3_ACCESS_KEY = "ak";
    process.env.S3_SECRET_KEY = "sk";
    const provider = getStorageProvider();
    expect(provider).toBeDefined();
    delete process.env.STORAGE_TYPE;
  });
});
