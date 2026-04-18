import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import {
  DependencyGraph,
  ExecutionQueue,
  scanFileDependencies,
} from "../../../skills/evolution-dependency-graph/index.ts";

const FIXTURE_DIR = join(process.cwd(), "tests", "skills", "evolution-dependency-graph", "fixtures");

function ensureClean(): void {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });
}

function fixture(name: string): string {
  return join("tests", "skills", "evolution-dependency-graph", "fixtures", name);
}

describe("Evolution Dependency Graph v8.2", () => {
  beforeEach(() => {
    ensureClean();
  });

  afterEach(() => {
    ensureClean();
  });

  it("scans file dependencies", () => {
    const utilPath = resolve(FIXTURE_DIR, "util.ts");
    writeFileSync(utilPath, "export const x = 1;\n", "utf-8");

    const mainPath = resolve(FIXTURE_DIR, "main.ts");
    writeFileSync(
      mainPath,
      `import { x } from "./util";\nimport { something } from "nonexistent";\nconsole.log(x);\n`,
      "utf-8"
    );

    const deps = scanFileDependencies(fixture("main.ts"));
    expect(deps).toContain(fixture("util.ts"));
    expect(deps).not.toContain("nonexistent");
  });

  it("topological sorts files by dependency", () => {
    writeFileSync(resolve(FIXTURE_DIR, "a.ts"), "export const a = 1;\n", "utf-8");
    writeFileSync(resolve(FIXTURE_DIR, "b.ts"), `import { a } from "./a";\nexport const b = a + 1;\n`, "utf-8");
    writeFileSync(resolve(FIXTURE_DIR, "c.ts"), `import { b } from "./b";\nexport const c = b + 1;\n`, "utf-8");

    const graph = new DependencyGraph();
    const order = graph.topoSort([fixture("c.ts"), fixture("a.ts"), fixture("b.ts")]);

    expect(order.indexOf(fixture("a.ts"))).toBeLessThan(order.indexOf(fixture("b.ts")));
    expect(order.indexOf(fixture("b.ts"))).toBeLessThan(order.indexOf(fixture("c.ts")));
  });

  it("detects file overlap conflicts", () => {
    const graph = new DependencyGraph();
    const report = graph.detectConflicts([
      { filesChanged: ["skills/a.ts", "skills/b.ts"], versionId: "v1" },
      { filesChanged: ["skills/b.ts", "skills/c.ts"], versionId: "v2" },
    ]);

    expect(report.hasConflict).toBe(true);
    expect(report.conflicts.some((c) => c.type === "file_overlap" && c.files.includes("skills/b.ts"))).toBe(true);
  });

  it("detects order violations", () => {
    writeFileSync(resolve(FIXTURE_DIR, "child.ts"), `import { parent } from "./parent";\n`, "utf-8");
    writeFileSync(resolve(FIXTURE_DIR, "parent.ts"), "export const parent = 1;\n", "utf-8");

    const graph = new DependencyGraph();
    const report = graph.detectConflicts([
      { filesChanged: [fixture("child.ts")], versionId: "v-child" },
      { filesChanged: [fixture("parent.ts")], versionId: "v-parent" },
    ]);

    expect(report.conflicts.some((c) => c.type === "order_violation")).toBe(true);
  });

  it("execution queue rejects conflicting batches", () => {
    const queue = new ExecutionQueue();
    const result = queue.addBatch({
      id: "batch-1",
      proposals: [
        { filesChanged: ["a.ts"], versionId: "v1", description: "" },
        { filesChanged: ["a.ts"], versionId: "v2", description: "" },
      ],
      status: "pending",
    });

    expect(result.success).toBe(false);
    expect(result.conflict?.hasConflict).toBe(true);
  });

  it("execution queue returns next pending batch", () => {
    const queue = new ExecutionQueue();
    queue.addBatch({
      id: "batch-1",
      proposals: [{ filesChanged: ["a.ts"], versionId: "v1", description: "" }],
      status: "pending",
    });

    const next = queue.nextBatch();
    expect(next).toBeDefined();
    expect(next!.id).toBe("batch-1");
  });
});
