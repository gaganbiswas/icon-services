import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  /** PostgreSQL connection string. */
  readonly databaseUrl: string;
  /** Maximum pool size (default 10). */
  readonly maxConnections?: number;
}

/**
 * Creates a Prisma client using the node-postgres driver adapter (Prisma 7).
 * Only apps/api (and seed/test tooling) may create clients.
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    max: options.maxConnections ?? 10,
  });
  return new PrismaClient({ adapter });
}
