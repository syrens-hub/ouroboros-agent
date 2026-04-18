import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { watchModule } from "../../../skills/hot-reload/index.ts";
import * as fs from "fs";
import * as path from "path";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    watch: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
    rmSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

describe("hot-reload", () => {
  let watcherMock: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    watcherMock = { close: vi.fn() };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('export default { hello: "world" };');
    (fs.readdirSync as any).mockReturnValue([]);
    (fs.watch as any).mockReturnValue(watcherMock);
    (fs.statSync as any).mockReturnValue({ mtime: { getTime: () => Date.now() } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets up a file watcher on the target module", () => {
    watchModule(path.resolve("/tmp/fake-module.ts"));
    expect(fs.watch).toHaveBeenCalledWith(
      path.resolve("/tmp/fake-module.ts"),
      expect.any(Function)
    );
  });

  it("copies the module to a temp path on initial load", async () => {
    watchModule("/tmp/fake-module.ts");
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      path.resolve("/tmp/fake-module.ts"),
      expect.stringMatching(/fake-module-[a-f0-9]{16}\.ts$/)
    );
  });

  it("calls onError when file read fails", async () => {
    (fs.readFileSync as any).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const onError = vi.fn();
    watchModule("/tmp/missing.ts", { onError });
    await new Promise((r) => setTimeout(r, 50));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("closes the watcher on dispose", () => {
    const handle = watchModule("/tmp/fake-module.ts");
    handle.dispose();
    expect(watcherMock.close).toHaveBeenCalled();
  });

  it("triggers copy on manual reload", async () => {
    const handle = watchModule("/tmp/fake-module.ts");
    await new Promise((r) => setTimeout(r, 50));
    (fs.copyFileSync as any).mockClear();
    // reload will fail on dynamic import, but copyFileSync should still be called
    await expect(handle.reload()).rejects.toThrow();
    expect(fs.copyFileSync).toHaveBeenCalled();
  });
});
