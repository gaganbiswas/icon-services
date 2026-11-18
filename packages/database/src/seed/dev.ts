/**
 * DEVELOPMENT-ONLY seed: one placeholder organization and branch, system roles,
 * and a Super Admin whose credentials come from SEED_ADMIN_EMAIL /
 * SEED_ADMIN_PASSWORD. Refuses to run in production. Idempotent.
 *
 * The organization/branch values are placeholders, not business data
 * (owner questions B7–B12, D28 are still open).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { hash } from '@node-rs/argon2';
import { PasswordSchema } from '@icon/contracts';

import { createPrismaClient } from '../client.js';
import { ARGON2_OPTIONS } from '../password-hashing.js';
import { ensurePermissions, ensureSystemRoles } from './rbac.js';
import { ensureAssetCategories } from './reference-data.js';

const rootEnv = path.resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set (see .env.example)`);
  }
  return value;
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to run the development seed with NODE_ENV=production');
  }
  const databaseUrl = required('DATABASE_URL');
  const email = required('SEED_ADMIN_EMAIL').trim();
  const password = PasswordSchema.parse(required('SEED_ADMIN_PASSWORD'));

  const prisma = createPrismaClient({ databaseUrl, maxConnections: 1 });
  try {
    const passwordHash = await hash(password, ARGON2_OPTIONS);
    await prisma.$transaction(async (tx) => {
      await ensurePermissions(tx);
      const organization = await tx.organization.upsert({
        where: { code: 'DEV' },
        create: { code: 'DEV', displayName: 'Development Organisation (placeholder)' },
        update: {},
      });
      const branch = await tx.branch.upsert({
        where: { organizationId_code: { organizationId: organization.id, code: 'DEV-01' } },
        create: {
          organizationId: organization.id,
          code: 'DEV-01',
          name: 'Development Branch (placeholder)',
        },
        update: {},
      });
      await ensureSystemRoles(tx, organization.id);
      await ensureAssetCategories(tx, organization.id);
      const superAdmin = await tx.role.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: organization.id, code: 'SUPER_ADMIN' } },
      });

      const emailNormalized = email.toLowerCase();
      const existing = await tx.user.findUnique({ where: { emailNormalized } });
      if (existing) {
        console.log(`Seed: admin ${emailNormalized} already exists; password unchanged.`);
        return;
      }
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email,
          emailNormalized,
          fullName: 'Development Admin',
          passwordHash,
          passwordChangedAt: new Date(),
        },
      });
      await tx.userRole.create({
        data: { organizationId: organization.id, userId: user.id, roleId: superAdmin.id },
      });
      await tx.userBranchAccess.create({
        data: { organizationId: organization.id, userId: user.id, branchId: branch.id },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorType: 'SYSTEM',
          action: 'seed.dev.admin_created',
          entityType: 'user',
          entityId: user.id,
          after: { email: emailNormalized, roles: ['SUPER_ADMIN'] },
        },
      });
      console.log(`Seed: created development admin ${emailNormalized}.`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
