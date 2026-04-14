// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/prefer-nullish-coalescing": "off",
    },
  },
  {
    files: ["web/src/**/*.js", "web/src/**/*.jsx"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        location: "readonly",
        history: "readonly",
        Image: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        EventSource: "readonly",
        AbortController: "readonly",
        Element: "readonly",
        global: "readonly",
        apiFetch: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/**", "web/dist/**", ".ouroboros/**", "playwright-report/**", "test-results/**"],
  }
);
