import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "web/node_modules", "e2e", "dist", ".ouroboros"],
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 41,
        branches: 60,
        functions: 46,
        lines: 41,
      },
    },
  },
});
