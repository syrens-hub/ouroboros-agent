/**
 * Ouroboros Hot Reload
 * ====================
 * Enables runtime reloading of ESM modules without restarting the process.
 * Critical for a self-modifying agent: when the Agent Loop replaces itself,
 * the new code must be loadable on the next iteration.
 *
 * Strategy: Node ESM caches modules by resolved URL. Appending a query string
 * is unreliable across loaders. We bypass the cache entirely by copying the
 * file to a temporary path with a unique hash and importing that copy.
 */

import { watch } from "fs";
import { resolve, basename, extname, join } from "path";
import { readFileSync, mkdirSync, existsSync, rmSync, copyFileSync, readdirSync, statSync } from "fs";
import { createHash } from "crypto";
import { appConfig } from "./config.ts";

const HOT_RELOAD_DIR = join(
  appConfig.db.dir.startsWith("/") ? appConfig.db.dir : join(process.cwd(), appConfig.db.dir),
  "hot-reload"
);

export interface HotReloadHandle<T> {
  /** Get the currently loaded module instance. */
  get current(): T | undefined;
  /** Manually trigger a reload. */
  reload(): Promise<T>;
  /** Stop the file watcher. */
  dispose(): void;
}

function ensureHotReloadDir() {
  if (!existsSync(HOT_RELOAD_DIR)) {
    mkdirSync(HOT_RELOAD_DIR, { recursive: true });
  }
}

function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Watch a module file and reload it whenever it changes on disk.
 */
export function watchModule<T>(
  filePath: string,
  opts: {
    onLoad?: (mod: T) => void;
    onError?: (err: Error) => void;
  } = {}
): HotReloadHandle<T> {
  let currentModule: T | undefined;
  const resolved = resolve(filePath);

  async function doReload(): Promise<T> {
    ensureHotReloadDir();
    const hash = computeFileHash(resolved);
    const ext = extname(resolved);
    const base = basename(resolved, ext);
    const tempPath = join(HOT_RELOAD_DIR, `${base}-${hash}${ext}`);

    // Copy to a uniquely-named temp file so the ESM loader sees a brand-new specifier
    copyFileSync(resolved, tempPath);

    const mod = await import("file://" + tempPath);
    currentModule = mod as T;

    // Best-effort cleanup of old temp files (keep last 10)
    try {
      const files = existsSync(HOT_RELOAD_DIR)
        ? readdirSync(HOT_RELOAD_DIR)
            .filter((f) => f.startsWith(base + "-"))
            .map((f) => ({ name: f, mtime: statSync(join(HOT_RELOAD_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.mtime - a.mtime)
        : [];
      for (const old of files.slice(10)) {
        try {
          rmSync(join(HOT_RELOAD_DIR, old.name));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore cleanup errors
    }

    if (opts.onLoad) {
      opts.onLoad(currentModule);
    }
    return currentModule;
  }

  // Initial load
  doReload().catch((e) => opts.onError?.(e as Error));

  const watcher = watch(resolved, (eventType) => {
    if (eventType === "change") {
      doReload().catch((e) => opts.onError?.(e as Error));
    }
  });

  return {
    get current() {
      return currentModule;
    },
    reload: doReload,
    dispose() {
      watcher.close();
    },
  };
}
