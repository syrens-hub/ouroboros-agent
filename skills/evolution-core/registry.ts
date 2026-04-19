/**
 * Evolution DI Registry
 * =====================
 * Lightweight service locator that eliminates direct cross-skill imports
 * inside the evolution cluster. All evolution skills register themselves here
 * during startup; consumers resolve dependencies via `use<T>(name)`.
 *
 * This keeps the evolution domain internally cohesive while making the
 * dependency graph explicit and testable (consumers can inject mocks via
 * `registerEvolutionModule`).
 */

const modules = new Map<string, unknown>();

export function registerEvolutionModule(name: string, mod: unknown): void {
  if (modules.has(name)) {
    // Idempotent re-registration allowed (e.g. hot-reload scenarios)
    return;
  }
  modules.set(name, mod);
}

export function use<T = unknown>(name: string): T {
  const mod = modules.get(name);
  if (!mod) {
    throw new Error(
      `Evolution module '${name}' not registered. ` +
        `Ensure skills/evolution-core/init.ts is imported before any evolution skill runs.`
    );
  }
  return mod as T;
}

/** Reset the registry — useful for tests. */
export function resetEvolutionRegistry(): void {
  modules.clear();
}

/** List registered module names (diagnostic). */
export function listRegisteredModules(): string[] {
  return Array.from(modules.keys());
}
