import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'prisma/config';

// Local development: load the repository-root `.env` if present.
// CI/production provide DATABASE_URL through the environment / secrets manager.
const rootEnv = path.resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    // Not required for `prisma validate`/`format`; required for migrate commands.
    url: process.env['DATABASE_URL'] ?? '',
  },
});
