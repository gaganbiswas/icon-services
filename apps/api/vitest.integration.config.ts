import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests need the Docker Compose services (bun run services:up).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
