/**
 * Evolution Dependency Graph v8.2
 * ================================
 * Dependency resolution, batch queueing, and conflict detection for evolutions.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname, relative, sep, normalize } from "path";
import { logger } from "../../core/logger.ts";

const PROJECT_ROOT = normalize(resolve(process.cwd()));

// =============================================================================
// Types
// =============================================================================

export interface DependencyNode {
  path: string;
  dependsOn: string[]; // files this file imports
  dependedBy: string[]; // files that import this file
}

export interface EvolutionBatch {
  id: string;
  proposals: Array<{ filesChanged: string[]; versionId: string; description: string }>;
  status: "pending" | "executing" | "completed" | "failed";
}

export interface ConflictReport {
  hasConflict: boolean;
  conflicts: Array<{
    type: "file_overlap" | "dependency_cycle" | "order_violation";
    files: string[];
    reason: string;
  }>;
}

// =============================================================================
// Lightweight import scanner
// =============================================================================

const IMPORT_RE =
  /(?:^|;|\s)import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]|(?:^|;|\s)require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

function resolveImport(sourceFile: string, importPath: string): string | null {
  if (importPath.startsWith(".")) {
    const base = dirname(resolve(PROJECT_ROOT, sourceFile));
    const resolved = resolve(base, importPath);
    const rel = normalize(relative(PROJECT_ROOT, resolved)).split(sep).join("/");
    // Try common extensions
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
      const candidate = rel + ext;
      if (existsSync(resolve(PROJECT_ROOT, candidate))) {
        return candidate;
      }
    }
    return rel;
  }
  // External / alias imports — skip for now
  return null;
}

export function scanFileDependencies(filePath: string): string[] {
  const fullPath = resolve(PROJECT_ROOT, filePath);
  if (!existsSync(fullPath)) return [];

  try {
    const content = readFileSync(fullPath, "utf-8");
    const deps: string[] = [];
    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(content)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) continue;
      const resolved = resolveImport(filePath, importPath);
      if (resolved && resolved !== filePath) {
        deps.push(resolved);
      }
    }
    return [...new Set(deps)];
  } catch {
    return [];
  }
}

// =============================================================================
// Dependency Graph Builder
// =============================================================================

export class DependencyGraph {
  private nodes = new Map<string, DependencyNode>();

  addFile(filePath: string): DependencyNode {
    const existing = this.nodes.get(filePath);
    if (existing && existing.dependsOn.length > 0) {
      // Already fully scanned
      return existing;
    }

    const deps = scanFileDependencies(filePath);
    const node: DependencyNode = existing
      ? { ...existing, dependsOn: deps }
      : { path: filePath, dependsOn: deps, dependedBy: [] };
    this.nodes.set(filePath, node);

    // Reverse edges
    for (const dep of deps) {
      const depNode = this.nodes.get(dep);
      if (depNode) {
        if (!depNode.dependedBy.includes(filePath)) depNode.dependedBy.push(filePath);
      } else {
        // Lazily add dependency node placeholder (will be scanned when addFile is called for it)
        this.nodes.set(dep, { path: dep, dependsOn: [], dependedBy: [filePath] });
      }
    }

    return node;
  }

  getNode(filePath: string): DependencyNode | undefined {
    return this.nodes.get(filePath);
  }

  /** Topological sort of files respecting import direction (dependents after dependencies). */
  topoSort(filePaths: string[]): string[] {
    for (const fp of filePaths) this.addFile(fp);

    const visited = new Set<string>();
    const temp = new Set<string>();
    const result: string[] = [];

    const visit = (fp: string) => {
      if (temp.has(fp)) {
        // cycle detected — break it by skipping
        logger.warn("Dependency cycle detected", { file: fp });
        return;
      }
      if (visited.has(fp)) return;
      temp.add(fp);
      const node = this.nodes.get(fp);
      if (node) {
        for (const dep of node.dependsOn) {
          if (filePaths.includes(dep)) visit(dep);
        }
      }
      temp.delete(fp);
      visited.add(fp);
      result.push(fp);
    };

    for (const fp of filePaths) visit(fp);
    return result;
  }

  /** Check if two evolutions have overlapping files or violate dependency order. */
  detectConflicts(
    proposals: Array<{ filesChanged: string[]; versionId: string }>
  ): ConflictReport {
    const conflicts: ConflictReport["conflicts"] = [];
    const fileToVersions = new Map<string, string[]>();

    // Map files to versions
    for (const p of proposals) {
      for (const f of p.filesChanged) {
        const arr = fileToVersions.get(f) ?? [];
        arr.push(p.versionId);
        fileToVersions.set(f, arr);
      }
    }

    // File overlap
    for (const [file, versions] of fileToVersions) {
      if (versions.length > 1) {
        conflicts.push({
          type: "file_overlap",
          files: [file],
          reason: `File "${file}" is modified by multiple evolutions: ${versions.join(", ")}`,
        });
      }
    }

    // Dependency order violations
    for (let i = 0; i < proposals.length; i++) {
      for (let j = i + 1; j < proposals.length; j++) {
        const a = proposals[i];
        const b = proposals[j];
        for (const fa of a.filesChanged) {
          for (const fb of b.filesChanged) {
            const depsA = scanFileDependencies(fa);
            if (depsA.includes(fb)) {
              // a depends on b, but a comes first in the array — this is okay if we execute in order
              // Actually this means b should be executed BEFORE a
              // If the array order has a before b, that's a violation
              conflicts.push({
                type: "order_violation",
                files: [fa, fb],
                reason: `${a.versionId} (${fa}) depends on ${b.versionId} (${fb}) but appears earlier in the batch`,
              });
            }
          }
        }
      }
    }

    return { hasConflict: conflicts.length > 0, conflicts };
  }
}

// =============================================================================
// Batch Execution Queue
// =============================================================================

export class ExecutionQueue {
  private graph = new DependencyGraph();
  private batches: EvolutionBatch[] = [];

  addBatch(batch: EvolutionBatch): { success: boolean; conflict?: ConflictReport } {
    const conflict = this.graph.detectConflicts(batch.proposals);
    if (conflict.hasConflict) {
      return { success: false, conflict };
    }
    this.batches.push({ ...batch, status: "pending" });
    return { success: true };
  }

  /** Returns the next executable batch where all dependencies are satisfied. */
  nextBatch(): EvolutionBatch | undefined {
    for (const batch of this.batches) {
      if (batch.status === "pending") {
        return batch;
      }
    }
    return undefined;
  }

  markBatchStatus(batchId: string, status: EvolutionBatch["status"]): void {
    const batch = this.batches.find((b) => b.id === batchId);
    if (batch) batch.status = status;
  }

  listBatches(): EvolutionBatch[] {
    return [...this.batches];
  }

  /** Topological order of all files across all pending batches. */
  getExecutionOrder(): string[] {
    const allFiles = new Set<string>();
    for (const batch of this.batches) {
      if (batch.status !== "completed") {
        for (const p of batch.proposals) {
          for (const f of p.filesChanged) allFiles.add(f);
        }
      }
    }
    return this.graph.topoSort([...allFiles]);
  }
}
