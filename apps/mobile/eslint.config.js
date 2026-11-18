const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  {
    // The Expo preset registers the TypeScript plugin for TS files only.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // CLAUDE.md §11.18: avoid `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  prettier,
  globalIgnores(['.expo/**', 'android/**', 'ios/**', 'dist/**', 'coverage/**']),
]);
