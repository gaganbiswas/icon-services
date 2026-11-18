import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

/** Loads the repo-root .env (local runs) and returns the guarded test DB URL. */
export function testDatabaseUrl(): string {
  const envFile = path.join(repoRoot, '.env');
  if (existsSync(envFile) && process.env['CI'] === undefined) {
    process.loadEnvFile(envFile);
  }
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set for integration tests');
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  // Safety: integration tests truncate every table.
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against database "${name}" (must end with _test)`,
    );
  }
  return url;
}

export const paths = {
  repoRoot,
  databasePackage: path.join(repoRoot, 'packages/database'),
  prismaCli: path.join(repoRoot, 'node_modules/prisma/build/index.js'),
};
