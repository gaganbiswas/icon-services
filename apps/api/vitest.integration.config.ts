import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests need PostgreSQL/Redis (bun run services:up) and use the
// dedicated TEST_DATABASE_URL database, which they reset between test files.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
