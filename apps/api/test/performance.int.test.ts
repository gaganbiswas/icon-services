import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestApp,
  bearer,
  createOrg,
  createTestApp,
  createUser,
  login,
  resetDatabase,
} from './integration/harness.js';

/**
 * Volume check (Phase 11): ~50,000 jobs across 3 branches, 12 months of data.
 * Runs only with PERF=1 (bun run test:perf) because seeding takes time.
 * Budgets are generous for a laptop; record actual timings in the runbook.
 */
const JOBS = Number(process.env['PERF_JOBS'] ?? 50_000);
const BUDGET_MS = 1_500;

describe.skipIf(process.env['PERF'] !== '1')(`Performance with ${JOBS} jobs`, () => {
  let t: TestApp;
  let token: string;
  let branchA1: string;
  const timings: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t.prisma);
    const org = await createOrg(t.prisma, 'ORGA', ['A1', 'A2', 'A3']);
    branchA1 = org.branches['A1'] ?? '';
    const admin = await createUser(t.prisma, org, {
      email: 'admin@a.test',
      roles: ['SUPER_ADMIN'],
    });
    const techs = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        createUser(t.prisma, org, {
          email: `tech${n}@a.test`,
          roles: ['TECHNICIAN'],
          branches: ['A1', 'A2', 'A3'],
        }),
      ),
    );
    token = (await login(t, admin.email)).accessToken;
    const branches = Object.values(org.branches);
    const category = org.categories['LAPTOP'] ?? '';
    const started = Date.now();
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO customers (id, organization_id, customer_code, type, name, phone_e164, phone_display, updated_at)
      SELECT gen_random_uuid(), '${org.id}', 'C' || g, 'INDIVIDUAL', 'Customer ' || g, '+9190' || lpad(g::text, 8, '0'), '+91 90' || g, now()
      FROM generate_series(1, ${Math.ceil(JOBS / 3)}) g`);
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO assets (id, organization_id, customer_id, category_id, brand, model, serial_number, updated_at)
      SELECT gen_random_uuid(), c.organization_id, c.id, '${category}', 'Brand', 'Model ' || (random() * 50)::int, 'SN' || c.customer_code, now()
      FROM customers c WHERE c.organization_id = '${org.id}'`);
    await t.prisma.$executeRawUnsafe(`
      WITH a AS (SELECT id, customer_id, row_number() OVER () AS n, count(*) OVER () AS total FROM assets)
      INSERT INTO service_jobs (id, organization_id, branch_id, job_number, customer_id, asset_id, service_type, service_mode, complaint, channel, status,
                                received_at, received_by_id, created_by_id, expected_completion_date, created_at, updated_at)
      SELECT gen_random_uuid(), '${org.id}', (ARRAY['${branches.join("','")}']::uuid[])[1 + g % 3], 'J-' || g, a.customer_id, a.id,
             (ARRAY['IN_WARRANTY','OUT_OF_WARRANTY','WARRANTY_UNVERIFIED']::service_type[])[1 + g % 3], 'AT_SERVICE_CENTRE', 'Complaint ' || g, 'STAFF',
             (ARRAY['RECEIVED','DIAGNOSIS','WAITING_FOR_PARTS','REPAIR_IN_PROGRESS','READY_FOR_DELIVERY','DELIVERED','DELIVERED','DELIVERED','CANCELLED']::job_status[])[1 + g % 9],
             now() - (g % 365) * interval '1 day', '${admin.id}', '${admin.id}', (now() - (g % 365 - 7) * interval '1 day')::date,
             now() - (g % 365) * interval '1 day', now()
      FROM generate_series(1, ${JOBS}) g JOIN a ON a.n = 1 + g % a.total`);
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO job_assignments (id, job_id, technician_user_id, assigned_by_id, assigned_at)
      SELECT gen_random_uuid(), j.id, (ARRAY['${techs.map((u) => u.id).join("','")}']::uuid[])[1 + (random() * 5)::int], '${admin.id}', j.created_at
      FROM service_jobs j`);
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO payments (id, organization_id, branch_id, receipt_number, customer_id, job_id, currency, amount, method, received_at, received_by_id)
      SELECT gen_random_uuid(), j.organization_id, j.branch_id, 'R-' || j.job_number, j.customer_id, j.id, 'XXX', 500 + (random() * 5000)::int, 'CASH', j.created_at + interval '2 days', '${admin.id}'
      FROM service_jobs j WHERE j.status = 'DELIVERED'`);
    await t.prisma.$executeRawUnsafe('ANALYZE');
    timings.push(`seed ${JOBS} jobs: ${Date.now() - started} ms`);
  }, 600_000);

  afterAll(async () => {
    process.stdout.write(`\nPerformance (${JOBS} jobs)\n  ${timings.join('\n  ')}\n`);
    await resetDatabase(t.prisma);
    await t.close();
  });

  const year = () => ({
    from: new Date(Date.now() - 365 * 86_400_000).toISOString(),
    to: new Date(Date.now() + 86_400_000).toISOString(),
  });

  async function timed(label: string, url: string) {
    await request(t.server()).get(url).set(bearer(token)).expect(200); // warm-up
    const started = performance.now();
    const response = await request(t.server()).get(url).set(bearer(token)).expect(200);
    const ms = Math.round(performance.now() - started);
    timings.push(`${label}: ${ms} ms`);
    expect(ms, label).toBeLessThan(BUDGET_MS);
    return response;
  }

  it('keeps list, search and report endpoints within budget', async () => {
    await timed('dashboard (all branches)', '/api/v1/reports/dashboard');
    await timed('dashboard (one branch)', `/api/v1/reports/dashboard?branchId=${branchA1}`);
    await timed(
      'job register page 1 (12 months)',
      `/api/v1/reports/jobs?${new URLSearchParams(year()).toString()}`,
    );
    await timed(
      'job register page 200',
      `/api/v1/reports/jobs?${new URLSearchParams({ ...year(), page: '200' }).toString()}`,
    );
    await timed(
      'technician performance (12 months)',
      `/api/v1/reports/technicians?${new URLSearchParams(year()).toString()}`,
    );
    await timed('outstanding', '/api/v1/reports/outstanding');
    await timed(
      'collections (12 months)',
      `/api/v1/reports/collections?${new URLSearchParams(year()).toString()}`,
    );
    await timed('job list', '/api/v1/jobs');
    await timed('job search by number', '/api/v1/jobs?q=J-4242');
    await timed('job search by phone', '/api/v1/jobs?q=%2B919000004242');
    await timed('customer search by name', '/api/v1/customers?q=Customer%204242');
  }, 600_000);
});
