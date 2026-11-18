import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Local development convenience: loads the repository-root `.env` file when it
 * exists. Variables already set in the environment are not overwritten.
 * Production must inject configuration via the environment / secrets manager.
 */
export function loadLocalEnvFile(cwd: string = process.cwd()): void {
  if (process.env['NODE_ENV'] === 'production') {
    return;
  }
  const candidate = path.resolve(cwd, '../../.env');
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
  }
}
