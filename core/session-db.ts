/**
 * Ouroboros SessionDB
 * ===================
 * Barrel file for backward compatibility.
 * All CRUD logic has moved to core/repositories/*.
 * Connection management lives in core/db-manager.ts.
 */

export * from "./db-manager.ts";
export * from "./repositories/index.ts";
