// Vite+ (https://viteplus.dev) is only used to lint and format the code:
//   npm run check     → format + lint + tests (what should pass before every commit)
//   npm test          → tests in tests/ with node:test (no browser, no dependencies)
//   npm run lint      → Oxlint          npm run lint:fix  → fixes what it can
//   npm run fmt       → Oxfmt (writes)  npm run fmt:check → only checks
// There is no build: the extension loads as is and package.sh packages its files.
import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    ignorePatterns: ['dist/**', 'node_modules/**'],
    // Pages of a Firefox WebExtension: browser DOM + the `browser` API.
    env: { browser: true, webextensions: true, es2024: true },
    categories: {
      correctness: 'error',
      suspicious: 'warn',
      perf: 'warn',
    },
    rules: {
      // Helper functions live once inside the module (IIFE); they are not recreated.
      'unicorn/consistent-function-scoping': 'off',
      // Lists of 3–10 constants that are also iterated in order (menus, selects).
      'unicorn/prefer-set-has': 'off',
      // _sig and _enterTimer are our own markers on DOM elements, on purpose.
      'no-underscore-dangle': 'off',
      // One-off copy when importing a backup; clarity matters more.
      'oxc/no-map-spread': 'off',
      // Moving, creating and restoring bookmarks is sequential on purpose: each index depends
      // on the previous operation, and in parallel the bookmarks would end up out of place.
      'no-await-in-loop': 'off',
    },
    overrides: [
      {
        // Node tooling of the repository itself (including the tests).
        files: ['vite.config.mjs', 'tests/**'],
        env: { browser: false, webextensions: false, node: true },
      },
    ],
  },
  fmt: {
    ignorePatterns: ['dist/**', 'node_modules/**', 'package-lock.json'],
    // The style the code already had: single quotes, semicolons and trailing commas.
    singleQuote: true,
    semi: true,
    trailingComma: 'all',
    printWidth: 120,
  },
});
