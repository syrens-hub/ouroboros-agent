/**
 * Database result helpers to avoid scattering `as` assertions.
 */

export function runMeta(
  result: unknown
): { changes: number; lastInsertRowid: number | bigint } {
  const r = result as { changes?: number; lastInsertRowid?: number | bigint };
  return {
    changes: r.changes ?? 0,
    lastInsertRowid: r.lastInsertRowid ?? 0,
  };
}

export function rowCount(result: unknown): number {
  return (result as { changes?: number }).changes ?? 0;
}

export function lastId(result: unknown): number {
  return Number(runMeta(result).lastInsertRowid);
}

export function rowAs<T>(row: unknown | undefined): T | undefined {
  return row as T | undefined;
}

export function rowsAs<T>(rows: unknown): T[] {
  return rows as T[];
}
