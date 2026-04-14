#!/usr/bin/env tsx
/**
 * Web UI Demo
 * ===========
 * One-liner to build the SPA and start the web server.
 */

import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const webDir = join(process.cwd(), "web");
const distDir = join(webDir, "dist");

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║              O U R O B O R O S   W E B   U I                 ║");
console.log("╠══════════════════════════════════════════════════════════════╣");
console.log("║  Building SPA and starting API server...                     ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// Build if dist is missing or stale
if (!existsSync(distDir)) {
  console.log("[1/2] Building web UI...");
  execSync("npm run web:build", { stdio: "inherit", cwd: process.cwd() });
} else {
  console.log("[1/2] Using existing web/dist build. Run 'npm run web:build' to rebuild.");
}

// Start server
console.log("[2/2] Starting server...\n");
const proc = spawn("npx", ["tsx", "web/server.ts"], {
  stdio: "inherit",
  cwd: process.cwd(),
});

proc.on("exit", (code) => {
  process.exit(code ?? 0);
});
