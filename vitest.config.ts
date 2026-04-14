import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "web/node_modules", "e2e", "dist", ".ouroboros"],
    coverage: {
      provider: "v8",
      include: ["core/**", "skills/**", "extensions/**", "web/routes/**", "types/**"],
      exclude: [
        "node_modules",
        "web/node_modules",
        "web/src/**",
        "web/dist/**",
        "skills/archive/**",
        "skills/web-mcp/templates/**",
        "skills/skill-scan/test-fixtures/**",
        "e2e",
        "dist",
        ".ouroboros",
      ],
      thresholds: {
        statements: 30,
        branches: 50,
        functions: 35,
        lines: 30,
      },
    },
  },
});
