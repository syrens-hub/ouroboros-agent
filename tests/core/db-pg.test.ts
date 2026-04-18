import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockRelease = vi.fn();

const mockPool = vi.fn(() => ({
  query: mockQuery,
  connect: mockConnect,
  end: mockEnd,
}));

vi.mock("pg", () => ({
  Pool: mockPool,
}));

// Re-import after mocking so PgPool is populated
const { isPgAvailable, PgDbAdapter } = await import("../../core/db-pg.ts");

describe("db-pg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  it("isPgAvailable returns true when pg is mocked", () => {
    expect(isPgAvailable()).toBe(true);
  });

  it("prepare().get returns first row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: "Alice" }] });
    const db = new PgDbAdapter("postgres://localhost");
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(1);
    expect(row).toEqual({ id: 1, name: "Alice" });
    expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM users WHERE id = $1", [1]);
    await db.close();
  });

  it("prepare().all returns all rows", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    const db = new PgDbAdapter("postgres://localhost");
    const rows = await db.prepare("SELECT * FROM users").all();
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    await db.close();
  });

  it("prepare().run returns changes and lastInsertRowid", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });
    const db = new PgDbAdapter("postgres://localhost");
    const result = await db.prepare("INSERT INTO users (name) VALUES (?)").run("Bob");
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(42);
    expect(mockQuery).toHaveBeenCalledWith("INSERT INTO users (name) VALUES ($1)", ["Bob"]);
    await db.close();
  });

  it("exec runs sql and returns void", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const db = new PgDbAdapter("postgres://localhost");
    await expect(db.exec("CREATE TABLE test (id INT)")).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledWith("CREATE TABLE test (id INT)", undefined);
    await db.close();
  });

  it("pragma returns ok", async () => {
    const db = new PgDbAdapter("postgres://localhost");
    const result = await db.pragma("wal_checkpoint");
    expect(result).toBe("ok");
    await db.close();
  });

  it("close calls pool.end", async () => {
    const db = new PgDbAdapter("postgres://localhost");
    await db.close();
    expect(mockEnd).toHaveBeenCalled();
  });

  it("transaction commits on success", async () => {
    const db = new PgDbAdapter("postgres://localhost");
    mockQuery.mockResolvedValue({ rows: [] });
    const tx = db.transaction(async () => {
      await db.prepare("INSERT INTO t (v) VALUES (?)").run(1);
      return "done";
    });
    const result = await tx();
    expect(result).toBe("done");
    expect(mockQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockQuery).toHaveBeenCalledWith("COMMIT");
    await db.close();
  });

  it("transaction rolls back on failure", async () => {
    const db = new PgDbAdapter("postgres://localhost");
    mockQuery.mockResolvedValue({ rows: [] });
    const tx = db.transaction(async () => {
      throw new Error("boom");
    });
    await expect(tx()).rejects.toThrow("boom");
    expect(mockQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    await db.close();
  });

  it("replaces multiple placeholders in order", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const db = new PgDbAdapter("postgres://localhost");
    await db.prepare("UPDATE t SET a = ?, b = ? WHERE c = ?").run(1, 2, 3);
    expect(mockQuery).toHaveBeenCalledWith("UPDATE t SET a = $1, b = $2 WHERE c = $3", [1, 2, 3]);
    await db.close();
  });
});
