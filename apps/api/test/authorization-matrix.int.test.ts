import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import { format, resolveConfig } from 'prettier';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IS_PUBLIC, REQUIRED_PERMISSIONS } from '../src/auth/decorators.js';
import { MockOtpProvider } from '../src/customer-auth/otp-provider.js';
import { CUSTOMER_ROUTE } from '../src/customer-auth/customer-principal.js';
import {
  type TestApp,
  createOrg,
  createTestApp,
  createUser,
  login,
  resetDatabase,
} from './integration/harness.js';

interface Route {
  method: string;
  path: string;
  access: 'PUBLIC' | 'CUSTOMER' | 'STAFF';
  permissions: string[];
}

const DOC = path.resolve(import.meta.dirname, '../../../docs/security/authorization-matrix.md');

/**
 * Staff routes that deliberately need only a signed-in staff user (own
 * account, own session, reference data). Any new route without permissions
 * fails this test until it is reviewed and added here.
 */
const STAFF_WITHOUT_PERMISSION = new Set([
  'GET /api/v1/me',
  'POST /api/v1/auth/password/change',
  // Own two-step sign-in status and set-up (ADR 0011).
  'GET /api/v1/auth/mfa',
  'POST /api/v1/auth/mfa/enrollment',
  'POST /api/v1/auth/mfa/enrollment/confirm',
]);

function discoverRoutes(t: TestApp): Route[] {
  const discovery = new DiscoveryService(t.app.get(ModulesContainer));
  const scanner = new MetadataScanner();
  const routes: Route[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
    if (!controller || !wrapper.instance) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = Object.getPrototypeOf(wrapper.instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name] as object;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (sub === undefined || method === undefined) continue;
      const meta = <T>(key: string): T | undefined =>
        (Reflect.getMetadata(key, handler) as T | undefined) ??
        (Reflect.getMetadata(key, controller) as T | undefined);
      const full = ['api/v1', base, sub]
        .map((p) => p.replace(/^\/|\/$/g, ''))
        .filter(Boolean)
        .join('/');
      routes.push({
        method: RequestMethod[method],
        path: `/${full}`,
        access: meta<boolean>(IS_PUBLIC)
          ? 'PUBLIC'
          : meta<boolean>(CUSTOMER_ROUTE)
            ? 'CUSTOMER'
            : 'STAFF',
        permissions: [...(meta<string[]>(REQUIRED_PERMISSIONS) ?? [])].sort(),
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function render(routes: Route[]): string {
  const rows = routes.map(
    (r) =>
      `| ${r.method} | \`${r.path}\` | ${r.access === 'STAFF' ? 'staff' : r.access.toLowerCase()} | ${r.permissions.map((p) => `\`${p}\``).join(', ') || (r.access === 'STAFF' ? 'signed-in staff' : '—')} |`,
  );
  return [
    '# Authorization matrix',
    '',
    '> Generated from the API controllers by `apps/api/test/authorization-matrix.int.test.ts`',
    '> (`UPDATE_DOCS=1` to regenerate). Do not edit by hand.',
    '',
    'Every route is authenticated unless public. Staff routes enforce all listed permissions on every request and',
    'scope records to the organization and permitted branches (out-of-scope records → 404). Customer routes take',
    'identity from the customer token only. Public routes are rate-limited and protected by their own token/signature.',
    '',
    `Routes: ${routes.length} (public ${routes.filter((r) => r.access === 'PUBLIC').length}, customer ${routes.filter((r) => r.access === 'CUSTOMER').length}, staff ${routes.filter((r) => r.access === 'STAFF').length}).`,
    '',
    '| Method | Path | Access | Permissions |',
    '|--------|------|--------|-------------|',
    ...rows,
    '',
  ].join('\n');
}

const concrete = (p: string) => p.replace(/:[A-Za-z]+/g, '01a1eeac-6f23-74c8-bac5-000000000001');

describe('Authorization coverage (every API route)', () => {
  let t: TestApp;
  let routes: Route[];
  let staffNoRoles: string;
  let customerToken: string;
  let staffAdmin: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t.prisma);
    const org = await createOrg(t.prisma, 'ORGA', ['A1']);
    const nobody = await createUser(t.prisma, org, {
      email: 'nobody@a.test',
      roles: [],
      branches: ['A1'],
    });
    staffNoRoles = (await login(t, nobody.email)).accessToken;
    const admin = await createUser(t.prisma, org, {
      email: 'admin@a.test',
      roles: ['SUPER_ADMIN'],
    });
    staffAdmin = (await login(t, admin.email)).accessToken;
    await request(t.server())
      .post('/api/v1/customer/auth/otp/request')
      .send({ organizationCode: 'ORGA', phone: '+919812345678' })
      .expect(200);
    const code = t.app.get(MockOtpProvider).sent.get('+919812345678') ?? '';
    const signedIn = await request(t.server())
      .post('/api/v1/customer/auth/otp/verify')
      .send({ organizationCode: 'ORGA', phone: '+919812345678', code, fullName: 'Asha' })
      .expect(200);
    customerToken = (signedIn.body as { accessToken: string }).accessToken;
    routes = discoverRoutes(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it('matches the documented matrix', async () => {
    // Formatted like the rest of the repository so `prettier --check` stays clean.
    const doc = await format(render(routes), { ...(await resolveConfig(DOC)), parser: 'markdown' });
    if (process.env['UPDATE_DOCS'] === '1') writeFileSync(DOC, doc);
    expect(readFileSync(DOC, 'utf8')).toBe(doc);
  });

  it('gives every staff route a permission unless explicitly reviewed', () => {
    const open = routes
      .filter((r) => r.access === 'STAFF' && r.permissions.length === 0)
      .map((r) => `${r.method} ${r.path}`);
    expect(open.sort()).toEqual([...STAFF_WITHOUT_PERMISSION].sort());
  });

  const call = (r: Route, token?: string) => {
    const agent = request(t.server());
    const url = concrete(r.path);
    const req =
      r.method === 'GET'
        ? agent.get(url)
        : r.method === 'POST'
          ? agent.post(url)
          : r.method === 'PUT'
            ? agent.put(url)
            : r.method === 'PATCH'
              ? agent.patch(url)
              : agent.delete(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('rejects every protected route without a token, and with the wrong kind of token', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => x.access !== 'PUBLIC')) {
      const anonymous = await call(r);
      if (anonymous.status !== 401)
        failures.push(`${r.method} ${r.path} anonymous → ${anonymous.status}`);
      const wrong = await call(r, r.access === 'CUSTOMER' ? staffAdmin : customerToken);
      if (wrong.status !== 401)
        failures.push(`${r.method} ${r.path} wrong token → ${wrong.status}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('forbids every permission-protected route to a staff user without roles', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => x.access === 'STAFF' && x.permissions.length > 0)) {
      const res = await call(r, staffNoRoles);
      if (res.status !== 403) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
