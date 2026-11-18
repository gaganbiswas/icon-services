import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import {
  ARGON2_OPTIONS,
  type PrismaClient,
  createPrismaClient,
  ensurePermissions,
  ensureSystemRoles,
} from '@icon/database';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { type Env, parseEnv } from '../../src/config/env.js';
import { testDatabaseUrl } from './test-database.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct-horse-battery-staple';

export interface TestApp {
  readonly app: INestApplication;
  readonly prisma: PrismaClient;
  readonly env: Env;
  server(): Server;
  close(): Promise<void>;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const databaseUrl = testDatabaseUrl();
  const env = parseEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    API_CORS_ORIGINS: ORIGIN,
    // Fresh random signing key per test app; never a fixed value.
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    AUTH_COOKIE_SECURE: 'false',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
    AUDIT_STORE_CLIENT_METADATA: 'true',
    API_DOCS_ENABLED: 'false',
    ...overrides,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, env);
  await app.init();
  const prisma = createPrismaClient({ databaseUrl, maxConnections: 2 });
  return {
    app,
    prisma,
    env,
    server: () => app.getHttpServer() as Server,
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/** Empties every application table (TRUNCATE is not blocked by the audit trigger). */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await prisma.$transaction((tx) => ensurePermissions(tx));
}

export interface OrgFixture {
  readonly id: string;
  readonly code: string;
  readonly branches: Record<string, string>;
  readonly roles: Record<string, string>;
}

export async function createOrg(
  prisma: PrismaClient,
  code: string,
  branchCodes: readonly string[],
): Promise<OrgFixture> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { code, displayName: `Org ${code}` } });
    const branches: Record<string, string> = {};
    for (const branchCode of branchCodes) {
      const branch = await tx.branch.create({
        data: { organizationId: org.id, code: branchCode, name: `Branch ${branchCode}` },
      });
      branches[branchCode] = branch.id;
    }
    await ensureSystemRoles(tx, org.id);
    const roles = await tx.role.findMany({ where: { organizationId: org.id } });
    return {
      id: org.id,
      code,
      branches,
      roles: Object.fromEntries(roles.map((role) => [role.code, role.id])),
    };
  });
}

let cachedHash: Promise<string> | undefined;

export async function createUser(
  prisma: PrismaClient,
  org: OrgFixture,
  options: {
    email: string;
    /** System role codes or custom role codes present in the fixture. */
    roles?: string[];
    branches?: string[];
    password?: string | null;
    isActive?: boolean;
    mustChangePassword?: boolean;
  },
): Promise<{ id: string; email: string }> {
  const password = options.password === undefined ? PASSWORD : options.password;
  cachedHash ??= hash(PASSWORD, ARGON2_OPTIONS);
  const passwordHash =
    password === null
      ? null
      : password === PASSWORD
        ? await cachedHash
        : await hash(password, ARGON2_OPTIONS);
  const roleIds = (options.roles ?? []).map((code) => {
    const roleId = org.roles[code];
    if (!roleId) throw new Error(`Unknown role ${code}`);
    return roleId;
  });
  const branchIds = (options.branches ?? []).map((code) => {
    const branchId = org.branches[code];
    if (!branchId) throw new Error(`Unknown branch ${code}`);
    return branchId;
  });
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        organizationId: org.id,
        email: options.email,
        emailNormalized: options.email.toLowerCase(),
        fullName: options.email.split('@')[0] ?? 'User',
        passwordHash,
        isActive: options.isActive ?? true,
        mustChangePassword: options.mustChangePassword ?? false,
      },
    });
    await tx.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId: user.id, roleId, organizationId: org.id })),
    });
    await tx.userBranchAccess.createMany({
      data: branchIds.map((branchId) => ({ userId: user.id, branchId, organizationId: org.id })),
    });
    return { id: user.id, email: user.email };
  });
}

export interface LoginResult {
  readonly accessToken: string;
  /** Raw "icon_rt=..." cookie pair for subsequent refresh/logout calls. */
  readonly cookie: string;
  readonly setCookieHeader: string;
}

export function refreshCookieFrom(setCookie: string[] | string | undefined): {
  pair: string;
  header: string;
} {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = headers.find((h) => h.startsWith('icon_rt='));
  if (!header) throw new Error('No refresh cookie set');
  return { pair: header.split(';')[0] ?? '', header };
}

export async function login(t: TestApp, email: string, password = PASSWORD): Promise<LoginResult> {
  const response = await request(t.server())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const body = response.body as { accessToken: string };
  const cookie = refreshCookieFrom(response.headers['set-cookie']);
  return { accessToken: body.accessToken, cookie: cookie.pair, setCookieHeader: cookie.header };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
