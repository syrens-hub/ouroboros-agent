/**
 * Graceful shutdown utilities to avoid circular dependencies with server.ts.
 */

import type { Server } from "http";
import { logger } from "../core/logger.ts";
import { closeRedis } from "../core/redis.ts";
import { SHUTDOWN_FORCE_EXIT_MS } from "./routes/constants.ts";
import { stopRunnerIdleCleanup } from "./runner-pool.ts";
import { closeWebSocket } from "./ws-server.ts";
import { getMcpConnectionManager } from "../skills/mcp/index.ts";
import { shutdownOtel } from "../skills/telemetry/otel.ts";

export function gracefulShutdown(server: Server | null, signal = "MANUAL", exitCode = 0): void {
  logger.info(`Shutting down gracefully...`, { signal });
  stopRunnerIdleCleanup();
  const mcpManager = getMcpConnectionManager();
  const mcpShutdown = mcpManager ? mcpManager.shutdown() : Promise.resolve();
  mcpShutdown
    .then(() => shutdownOtel())
    .then(() => closeWebSocket())
    .then(() => closeRedis())
    .then(() => {
      if (server) {
        server.close(() => {
          logger.info("Server closed");
          process.exit(exitCode);
        });
      } else {
        process.exit(exitCode);
      }
    })
    .catch(() => process.exit(exitCode));
  // Force exit after 10s
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(exitCode);
  }, SHUTDOWN_FORCE_EXIT_MS);
}
