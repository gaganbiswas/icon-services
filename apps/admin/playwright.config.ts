import { defineConfig, devices } from '@playwright/test';

/**
 * Staff workflow E2E (Phase 11). Run through `bun run test:e2e`, which prepares an
 * isolated database (icon_service_e2e) and the UAT role users first (e2e/run.sh).
 */
const API_PORT = 4200;
const ADMIN_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${ADMIN_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: `http://localhost:${API_PORT}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        API_PORT: String(API_PORT),
        DATABASE_URL: process.env['E2E_DATABASE_URL'] ?? '',
        API_CORS_ORIGINS: `http://localhost:${ADMIN_PORT}`,
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
      },
    },
    {
      command: `bunx vite --port ${ADMIN_PORT} --strictPort`,
      url: `http://localhost:${ADMIN_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_BASE_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
