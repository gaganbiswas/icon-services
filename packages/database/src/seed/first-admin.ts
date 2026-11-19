/**
 * PRODUCTION first administrator (Phase 12). Creates the organisation, its first
 * branch, system roles and one Super Admin WITHOUT a password, and prints a
 * one-time password set-up link (valid 24 hours). No default credentials exist.
 *
 * All values are given explicitly — nothing about the business is assumed:
 *   ORG_CODE, ORG_DISPLAY_NAME, ORG_TIMEZONE (IANA, e.g. confirmed by the owner),
 *   BRANCH_CODE, BRANCH_NAME, ADMIN_EMAIL, ADMIN_FULL_NAME, ADMIN_PANEL_URL (https://…)
 *
 * Refuses to run when any staff user already exists (use the admin panel then).
 */
import { createHash, randomBytes } from 'node:crypto';

import { createPrismaClient } from '../client.js';
import { ensurePermissions, ensureSystemRoles } from './rbac.js';
import { ensureAssetCategories } from './reference-data.js';

const SETUP_LINK_HOURS = 24;

function required(name: string, pattern?: RegExp): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  if (pattern && !pattern.test(value)) throw new Error(`${name} has an invalid format`);
  return value;
}

function validTimezone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    throw new Error('ORG_TIMEZONE is not a valid IANA time zone');
  }
}

async function main(): Promise<void> {
  const input = {
    orgCode: required('ORG_CODE', /^[A-Z0-9-]{2,20}$/),
    orgName: required('ORG_DISPLAY_NAME'),
    timezone: validTimezone(required('ORG_TIMEZONE')),
    branchCode: required('BRANCH_CODE', /^[A-Z0-9-]{2,20}$/),
    branchName: required('BRANCH_NAME'),
    email: required('ADMIN_EMAIL', /^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    fullName: required('ADMIN_FULL_NAME'),
    panelUrl: required('ADMIN_PANEL_URL', /^https?:\/\/[^\s/]+/).replace(/\/$/, ''),
  };
  if (process.env['NODE_ENV'] === 'production' && !input.panelUrl.startsWith('https://')) {
    throw new Error('ADMIN_PANEL_URL must use https in production');
  }
  const prisma = createPrismaClient({ databaseUrl: required('DATABASE_URL'), maxConnections: 1 });
  const token = randomBytes(32).toString('base64url');
  try {
    await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) {
        throw new Error('Staff users already exist; create further users in the admin panel');
      }
      await ensurePermissions(tx);
      const organization = await tx.organization.create({
        data: { code: input.orgCode, displayName: input.orgName, timezone: input.timezone },
      });
      const branch = await tx.branch.create({
        data: {
          organizationId: organization.id,
          code: input.branchCode,
          name: input.branchName,
          timezone: input.timezone,
        },
      });
      await ensureSystemRoles(tx, organization.id);
      await ensureAssetCategories(tx, organization.id);
      const role = await tx.role.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: organization.id, code: 'SUPER_ADMIN' } },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          emailNormalized: input.email.toLowerCase(),
          fullName: input.fullName,
          passwordHash: null,
        },
      });
      await tx.userRole.create({
        data: { organizationId: organization.id, userId: user.id, roleId: role.id },
      });
      await tx.userBranchAccess.create({
        data: { organizationId: organization.id, userId: user.id, branchId: branch.id },
      });
      await tx.passwordSetupToken.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
          purpose: 'INITIAL_SETUP',
          expiresAt: new Date(Date.now() + SETUP_LINK_HOURS * 3_600_000),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorType: 'SYSTEM',
          action: 'setup.first_admin_created',
          entityType: 'user',
          entityId: user.id,
          after: {
            email: input.email.toLowerCase(),
            organization: input.orgCode,
            branch: input.branchCode,
          },
        },
      });
    });
  } finally {
    await prisma.$disconnect();
  }
  // Printed once to the operator's terminal only; never logged or stored in plain text.
  console.log(`First administrator created for ${input.email}.`);
  console.log(`Open this one-time link within ${SETUP_LINK_HOURS} hours to set the password:`);
  console.log(`${input.panelUrl}/set-password#token=${token}`);
  console.log('Then set up two-step sign-in when prompted.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'First admin creation failed');
  process.exitCode = 1;
});
