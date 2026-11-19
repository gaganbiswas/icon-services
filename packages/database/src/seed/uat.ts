/**
 * UAT / DEMO bootstrap (Phase 11): a clearly labelled sample organisation with two
 * branches and one user per staff role, so testers can sign in as each role.
 * Business data (customers, jobs, payments …) is then created through the real API
 * by `apps/api/scripts/uat-data.ts`, so it obeys every rule and is fully audited.
 *
 * Refuses NODE_ENV=production. Password comes from UAT_PASSWORD (never hard-coded).
 * Idempotent: existing users are left unchanged.
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
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const UAT_ORGANIZATION_CODE = 'UAT';

const BRANCHES = [
  { code: 'UAT-1', name: 'Sample Branch — Central (UAT)' },
  { code: 'UAT-2', name: 'Sample Branch — North (UAT)' },
] as const;

/** One person per role; e-mail local part is the login. */
const PEOPLE = [
  { local: 'superadmin', fullName: 'Sample Super Admin', role: 'SUPER_ADMIN', branches: [] },
  { local: 'manager', fullName: 'Meera Manager', role: 'BRANCH_ADMIN', branches: ['UAT-1'] },
  { local: 'reception', fullName: 'Ravi Reception', role: 'RECEPTION', branches: ['UAT-1'] },
  { local: 'reception2', fullName: 'Nisha Reception', role: 'RECEPTION', branches: ['UAT-2'] },
  { local: 'tech1', fullName: 'Tarun Technician', role: 'TECHNICIAN', branches: ['UAT-1'] },
  {
    local: 'tech2',
    fullName: 'Kavya Technician',
    role: 'TECHNICIAN',
    branches: ['UAT-1', 'UAT-2'],
  },
  { local: 'accounts', fullName: 'Arjun Accounts', role: 'ACCOUNTS', branches: ['UAT-1', 'UAT-2'] },
  { local: 'delivery', fullName: 'Dev Delivery', role: 'DELIVERY', branches: ['UAT-1'] },
  { local: 'auditor', fullName: 'Asha Auditor', role: 'AUDITOR', branches: ['UAT-1', 'UAT-2'] },
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see docs/uat/README.md)`);
  return value;
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to create UAT sample data with NODE_ENV=production');
  }
  const databaseUrl = required('DATABASE_URL');
  const password = PasswordSchema.parse(required('UAT_PASSWORD'));
  const domain = process.env['UAT_EMAIL_DOMAIN'] ?? 'uat.example.test';
  const prisma = createPrismaClient({ databaseUrl, maxConnections: 1 });
  try {
    const passwordHash = await hash(password, ARGON2_OPTIONS);
    await prisma.$transaction(async (tx) => {
      await ensurePermissions(tx);
      const organization = await tx.organization.upsert({
        where: { code: UAT_ORGANIZATION_CODE },
        create: {
          code: UAT_ORGANIZATION_CODE,
          displayName: 'Sample Service Centre (UAT data — not a real business)',
        },
        update: {},
      });
      const branchIds = new Map<string, string>();
      for (const b of BRANCHES) {
        const branch = await tx.branch.upsert({
          where: { organizationId_code: { organizationId: organization.id, code: b.code } },
          create: { organizationId: organization.id, code: b.code, name: b.name },
          update: {},
        });
        branchIds.set(b.code, branch.id);
      }
      await ensureSystemRoles(tx, organization.id);
      await ensureAssetCategories(tx, organization.id);
      for (const person of PEOPLE) {
        const email = `${person.local}@${domain}`;
        if (await tx.user.findUnique({ where: { emailNormalized: email.toLowerCase() } })) continue;
        const role = await tx.role.findUniqueOrThrow({
          where: { organizationId_code: { organizationId: organization.id, code: person.role } },
        });
        const user = await tx.user.create({
          data: {
            organizationId: organization.id,
            email,
            emailNormalized: email.toLowerCase(),
            fullName: person.fullName,
            passwordHash,
            passwordChangedAt: new Date(),
          },
        });
        await tx.userRole.create({
          data: { organizationId: organization.id, userId: user.id, roleId: role.id },
        });
        for (const code of person.branches) {
          await tx.userBranchAccess.create({
            data: {
              organizationId: organization.id,
              userId: user.id,
              branchId: branchIds.get(code) ?? '',
            },
          });
        }
        await tx.auditLog.create({
          data: {
            organizationId: organization.id,
            actorType: 'SYSTEM',
            action: 'seed.uat.user_created',
            entityType: 'user',
            entityId: user.id,
            after: { email: email.toLowerCase(), roles: [person.role] },
          },
        });
      }
    });
    console.log(
      `UAT bootstrap ready: organisation ${UAT_ORGANIZATION_CODE}, ${PEOPLE.length} users at @${domain}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'UAT seed failed');
  process.exitCode = 1;
});
