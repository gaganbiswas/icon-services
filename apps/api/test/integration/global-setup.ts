import { execFileSync } from 'node:child_process';

import { paths, testDatabaseUrl } from './test-database.js';

/** Applies all migrations to the dedicated test database once per run. */
export default function setup(): void {
  const url = testDatabaseUrl();
  execFileSync(process.execPath, [paths.prismaCli, 'migrate', 'deploy'], {
    cwd: paths.databasePackage,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
