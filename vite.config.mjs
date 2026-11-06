// Vite+ (https://viteplus.dev) solo se usa para revisar y formatear el código:
//   npm run check     → formato + lint (lo que conviene pasar antes de cada commit)
//   npm run lint      → Oxlint          npm run lint:fix  → corrige lo automático
//   npm run fmt       → Oxfmt (escribe) npm run fmt:check → solo comprueba
// No hay build: la extensión se carga tal cual y package.sh empaqueta sus archivos.
import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    ignorePatterns: ['dist/**', 'node_modules/**'],
    // Páginas de una WebExtension de Firefox: DOM del navegador + API `browser`.
    env: { browser: true, webextensions: true, es2024: true },
    categories: {
      correctness: 'error',
      suspicious: 'warn',
      perf: 'warn',
    },
    rules: {
      // Las funciones auxiliares viven una sola vez dentro del módulo (IIFE); no se recrean.
      'unicorn/consistent-function-scoping': 'off',
      // Listas de 3–10 constantes que además se recorren en orden (menús, selectores).
      'unicorn/prefer-set-has': 'off',
      // _sig y _enterTimer son marcas propias en elementos del DOM, a propósito.
      'no-underscore-dangle': 'off',
      // Copia puntual al importar una copia de seguridad; la claridad pesa más.
      'oxc/no-map-spread': 'off',
    },
    overrides: [
      {
        // Herramientas de Node del propio repositorio.
        files: ['vite.config.mjs'],
        env: { browser: false, webextensions: false, node: true },
      },
    ],
  },
  fmt: {
    ignorePatterns: ['dist/**', 'node_modules/**', 'package-lock.json'],
    // El estilo que ya tenía el código: comillas simples, punto y coma y comas finales.
    singleQuote: true,
    semi: true,
    trailingComma: 'all',
    printWidth: 120,
  },
});
