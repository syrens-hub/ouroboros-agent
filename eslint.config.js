// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Root/backend TypeScript
  {
    files: [
      "*.ts",
      "benchmarks/**/*.ts",
      "core/**/*.ts",
      "skills/**/*.ts",
      "types/**/*.ts",
      "tests/**/*.ts",
      "extensions/**/*.ts",
      "scripts/**/*.ts",
      "tools/**/*.ts",
    ],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/prefer-nullish-coalescing": "off",
    },
  },
  // Web TypeScript / TSX
  {
    files: ["web/**/*.ts", "web/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./web/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/prefer-nullish-coalescing": "off",
    },
  },
  // JavaScript files (skills, extensions, legacy)
  {
    files: ["**/*.js", "**/*.jsx", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        global: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        AbortController: "readonly",
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        Image: "readonly",
        EventSource: "readonly",
        WebSocket: "readonly",
        Element: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        Event: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        SpeechSynthesisUtterance: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        CustomEvent: "readonly",
        performance: "readonly",
        btoa: "readonly",
        apiFetch: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-redeclare": "off",
      "no-case-declarations": "warn",
    },
  },
  // Relaxed rules for skill JS bundles
  {
    files: ["skills/**/*.js", "skills/**/*.mjs", "skills/**/*.cjs", "extensions/**/*.js", "extensions/**/*.mjs"],
    rules: {
      "no-empty": "off",
      "no-useless-escape": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // React Hooks (web/src only)
  {
    files: ["web/src/**/*.js", "web/src/**/*.jsx", "web/src/**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  // Test files
  {
    files: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.test.js", "tests/**/*.test.jsx", "web/src/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "web/node_modules/**",
      "web/dist/**",
      ".ouroboros/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "**/dist/**",
      "**/.openclaw-migrated/**",
      "skills/web-mcp/templates/**",
      "skills/skill-scan/test-fixtures/**",
      "skills/**/scripts/**",
      "skills/feishu-*/**/*.js",
      "skills/feishu-*/**/*.mjs",
      "skills/fluid-memory/**/*.js",
      "skills/personal-productivity/index.js",
    ],
  }
);
