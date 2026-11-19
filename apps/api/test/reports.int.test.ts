import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type OrgFixture,
  type TestApp,
  bearer,
  createOrg,
  createTestApp,
  createUser,
  login,
  newKey,
  resetDatabase,
} from './integration/harness.js';

interface ErrorBody {
  error: { code: string };
}

const DAY = 86_400_000;
const period = () => ({
  from: new Date(Date.now() - 90 * DAY).toISOString(),
  to: new Date(Date.now() + DAY).toISOString(),
});

describe('Reports, dashboard and exports (real PostgreSQL)', () => {
  let t: TestApp;
  let org: OrgFixture;
  const users: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    org = await createOrg(t.prisma, 'ORGA', ['A1', 'A2']);
    const people: [string, string[], string[]][] = [
      ['reception', ['RECEPTION'], ['A1']],
      ['receptionA2', ['RECEPTION'], ['A2']],
      ['tech1', ['TECHNICIAN'], ['A1']],
      ['accounts', ['ACCOUNTS'], ['A1']],
      ['manager', ['BRANCH_ADMIN'], ['A1']],
      ['super', ['SUPER_ADMIN'], []],
    ];
    for (const [key, roles, branches] of people) {
      const user = await createUser(t.prisma, org, { email: `${key}@a.test`, roles, branches });
      users[key] = user.id;
      tokens[key] = (await login(t, user.email)).accessToken;
    }
    await http()
      .put('/api/v1/settings/money')
      .set(as('super'))
      .send({ value: { currency: 'XXX' }, reason: 'test' })
      .expect(200);
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(tokens[who] ?? '');

  async function job(
    who: string,
    branch: string,
    options: { name?: string; serviceType?: string; approvedAmount?: string } = {},
  ) {
    const customer = await http()
      .post('/api/v1/customers')
      .set(as(who))
      .send({
        type: 'INDIVIDUAL',
        name: options.name ?? 'Asha Rao',
        phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      })
      .expect(201);
    const customerId = (customer.body as { id: string }).id;
    const asset = await http()
      .post('/api/v1/assets')
      .set(as(who))
      .send({
        customerId,
        categoryId: org.categories['LAPTOP'],
        brand: 'Acme',
        model: 'Book',
        serialNumber: 'SN-1',
      })
      .expect(201);
    const created = await http()
      .post('/api/v1/jobs')
      .set(as(who))
      .set('Idempotency-Key', newKey())
      .send({
        branchId: org.branches[branch],
        customerId,
        assetId: (asset.body as { asset: { id: string } }).asset.id,
        serviceType: options.serviceType ?? 'OUT_OF_WARRANTY',
        serviceMode: 'AT_SERVICE_CENTRE',
        complaint: 'Broken',
      })
      .expect(201);
    const jobId = (created.body as { id: string }).id;
    if (options.approvedAmount) {
      await http()
        .post(`/api/v1/jobs/${jobId}/assignments`)
        .set(as('manager'))
        .send({ technicianUserId: users['tech1'] })
        .expect(201);
      await t.prisma.serviceJob.update({
        where: { id: jobId },
        data: { status: 'ESTIMATE_PREPARATION' },
      });
      const draft = await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('tech1'))
        .send({
          lines: [
            {
              lineType: 'PART',
              description: 'Screen',
              quantity: '1',
              unitPrice: options.approvedAmount,
            },
          ],
        })
        .expect(201);
      const sent = await http()
        .post(`/api/v1/estimates/${(draft.body as { id: string }).id}/send`)
        .set(as('manager'))
        .send({ rowVersion: (draft.body as { rowVersion: number }).rowVersion })
        .expect(200);
      await http()
        .post('/api/v1/public/estimate-links/decision')
        .send({
          token: (sent.body as { approvalLink: { token: string } }).approvalLink.token,
          decision: 'APPROVED',
          termsAccepted: true,
        })
        .expect(200);
    }
    return { jobId, customerId };
  }

  async function complete(jobId: string, daysAgo: number, receivedDaysAgo: number) {
    await t.prisma.serviceJob.update({
      where: { id: jobId },
      data: {
        status: 'REPAIR_COMPLETED',
        receivedAt: new Date(Date.now() - receivedDaysAgo * DAY),
        completedAt: new Date(Date.now() - daysAgo * DAY),
        completedById: users['tech1'] ?? null,
        repairSummary: 'Replaced screen',
        qcChecklist: [{ item: 'Powers on', checked: true }],
      },
    });
  }

  it('builds the dashboard within the caller’s branches only', async () => {
    const { jobId, customerId } = await job('reception', 'A1', { approvedAmount: '2300' });
    await job('reception', 'A1', { serviceType: 'IN_WARRANTY' });
    await job('receptionA2', 'A2');
    await t.prisma.serviceJob.updateMany({
      where: { id: { not: jobId } },
      data: { expectedCompletionDate: new Date(Date.now() - 3 * DAY) },
    });
    await complete(jobId, 45, 50);
    const payment = await http()
      .post('/api/v1/payments')
      .set(as('accounts'))
      .set('Idempotency-Key', newKey())
      .send({ branchId: org.branches['A1'], customerId, jobId, amount: '1000', method: 'CASH' })
      .expect(201);
    await http()
      .post(`/api/v1/payments/${(payment.body as { id: string }).id}/refunds`)
      .set(as('manager'))
      .set('Idempotency-Key', newKey())
      .send({ amount: '100', method: 'CASH', reason: 'Goodwill' })
      .expect(201);

    const mine = (await http().get('/api/v1/reports/dashboard').set(as('accounts')).expect(200))
      .body as Record<string, unknown>;
    expect(mine).toMatchObject({
      newJobsToday: 2,
      overdueJobs: 1,
      repairCompleted: 1,
      collectedToday: '900.0000',
      collectedThisMonth: '900.0000',
      outstanding: { total: '1400.0000', jobs: 1 },
      currency: 'XXX',
      // The only assignment is on a finished job, so nobody has open work.
      technicianWorkload: [],
    });
    expect(mine['warrantyMix']).toEqual([
      { serviceType: 'IN_WARRANTY', count: 1 },
      { serviceType: 'OUT_OF_WARRANTY', count: 1 },
    ]);
    const all = (await http().get('/api/v1/reports/dashboard').set(as('super')).expect(200))
      .body as { newJobsToday: number; overdueJobs: number };
    expect(all).toMatchObject({ newJobsToday: 3, overdueJobs: 2 });
    await http()
      .get(`/api/v1/reports/dashboard?branchId=${org.branches['A2']}`)
      .set(as('accounts'))
      .expect(404);
    await http().get('/api/v1/reports/dashboard').set(as('reception')).expect(403);
  });

  it('ages outstanding balances on the approved-estimate basis', async () => {
    const a = await job('reception', 'A1', { approvedAmount: '2300' });
    const b = await job('reception', 'A1', { approvedAmount: '500' });
    const c = await job('reception', 'A1', { approvedAmount: '700' });
    await complete(a.jobId, 45, 50);
    await complete(b.jobId, 5, 6);
    // c is still in repair: not yet receivable.
    await http()
      .post('/api/v1/payments')
      .set(as('accounts'))
      .set('Idempotency-Key', newKey())
      .send({
        branchId: org.branches['A1'],
        customerId: a.customerId,
        jobId: a.jobId,
        amount: '300',
        method: 'CASH',
      })
      .expect(201);
    const report = (await http().get('/api/v1/reports/outstanding').set(as('accounts')).expect(200))
      .body as {
      total: string;
      rows: { jobId: string; due: string; bucket: string; ageDays: number }[];
      buckets: { bucket: string; jobs: number; due: string }[];
    };
    expect(report.total).toBe('2500.0000');
    expect(report.rows.map((r) => [r.jobId, r.due, r.bucket])).toEqual([
      [a.jobId, '2000.0000', '31-60'],
      [b.jobId, '500.0000', '0-30'],
    ]);
    expect(report.rows.find((r) => r.jobId === c.jobId)).toBeUndefined();
    expect(report.buckets).toEqual([
      { bucket: '0-30', jobs: 1, due: '500.0000' },
      { bucket: '31-60', jobs: 1, due: '2000.0000' },
      { bucket: '61-90', jobs: 0, due: '0.0000' },
      { bucket: '90+', jobs: 0, due: '0.0000' },
    ]);
    await http().get('/api/v1/reports/outstanding').set(as('tech1')).expect(403);
  });

  it('filters and pages the job register, and reports technician turnaround', async () => {
    const a = await job('reception', 'A1', { approvedAmount: '100' });
    await job('reception', 'A1', { serviceType: 'IN_WARRANTY' });
    await job('receptionA2', 'A2');
    await complete(a.jobId, 1, 3);
    const q = new URLSearchParams({ ...period(), pageSize: '1' });
    const page1 = (
      await http().get(`/api/v1/reports/jobs?${q.toString()}`).set(as('accounts')).expect(200)
    ).body as { total: number; items: { jobNumber: string; branchCode: string }[] };
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    const filtered = (
      await http()
        .get(
          `/api/v1/reports/jobs?${new URLSearchParams({ ...period(), technicianId: users['tech1'] ?? '' }).toString()}`,
        )
        .set(as('accounts'))
        .expect(200)
    ).body as {
      items: { id: string; technicians: string; status: string; completedAt: string | null }[];
    };
    expect(filtered.items).toMatchObject([
      { id: a.jobId, technicians: 'tech1', status: 'REPAIR_COMPLETED' },
    ]);
    const warranty = (
      await http()
        .get(
          `/api/v1/reports/jobs?${new URLSearchParams({ ...period(), serviceType: 'IN_WARRANTY' }).toString()}`,
        )
        .set(as('super'))
        .expect(200)
    ).body as { total: number };
    expect(warranty.total).toBe(1);
    const bad = await http()
      .get('/api/v1/reports/jobs?from=2026-01-01T00:00:00Z&to=2025-01-01T00:00:00Z')
      .set(as('accounts'))
      .expect(400);
    expect((bad.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');

    const tech = (
      await http()
        .get(`/api/v1/reports/technicians?${new URLSearchParams(period()).toString()}`)
        .set(as('accounts'))
        .expect(200)
    ).body as {
      user: { fullName: string };
      completedJobs: number;
      averageTurnaroundHours: string;
      medianTurnaroundHours: string;
    }[];
    expect(tech).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ fullName: 'tech1' }) as object,
        completedJobs: 1,
        averageTurnaroundHours: '48.0',
        medianTurnaroundHours: '48.0',
      }),
    ]);
  });

  it('reports parts usage and indicative valuation', async () => {
    const { jobId } = await job('reception', 'A1');
    const part = (
      await http()
        .post('/api/v1/parts')
        .set(as('manager'))
        .send({ sku: 'SCR-1', name: 'Screen', reorderLevel: '5' })
        .expect(201)
    ).body as { id: string };
    await http()
      .post('/api/v1/inventory/receipts')
      .set(as('manager'))
      .send({ branchId: org.branches['A1'], partId: part.id, quantity: '4', unitCost: '100' })
      .expect(201);
    await http()
      .post('/api/v1/inventory/receipts')
      .set(as('manager'))
      .send({ branchId: org.branches['A1'], partId: part.id, quantity: '6', unitCost: '120.5' })
      .expect(201);
    await t.prisma.serviceJob.update({
      where: { id: jobId },
      data: { status: 'REPAIR_IN_PROGRESS' },
    });
    await http()
      .post(`/api/v1/jobs/${jobId}/parts`)
      .set(as('manager'))
      .send({ partId: part.id, action: 'CONSUME', quantity: '3' })
      .expect(201);
    await http()
      .post(`/api/v1/jobs/${jobId}/parts`)
      .set(as('manager'))
      .send({ partId: part.id, action: 'RETURN', quantity: '1', reason: 'Not needed' })
      .expect(201);
    const report = (
      await http()
        .get(`/api/v1/reports/parts?${new URLSearchParams(period()).toString()}`)
        .set(as('manager'))
        .expect(200)
    ).body as {
      usage: object[];
      valuation: object[];
      valuationTotal: string;
    };
    expect(report.usage).toEqual([
      expect.objectContaining({
        sku: 'SCR-1',
        consumed: '3.0000',
        returned: '1.0000',
        netUsed: '2.0000',
      }),
    ]);
    expect(report.valuation).toEqual([
      expect.objectContaining({
        sku: 'SCR-1',
        onHand: '8.0000',
        latestUnitCost: '120.5000',
        value: '964.0000',
        belowReorderLevel: false,
      }),
    ]);
    expect(report.valuationTotal).toBe('964.0000');
    await http()
      .get(`/api/v1/reports/parts?${new URLSearchParams(period()).toString()}`)
      .set(as('accounts'))
      .expect(403);
  });

  describe('exports', () => {
    const exportUrl = (report: string, format: string, extra: Record<string, string> = {}) =>
      `/api/v1/reports/${report}/export?${new URLSearchParams({ format, ...period(), ...extra }).toString()}`;
    const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };

    it('exports CSV with injection guard, as an audited attachment', async () => {
      await job('reception', 'A1', { name: '=HYPERLINK("http://x")' });
      await job('receptionA2', 'A2', { name: 'Other Branch Customer' });
      const res = await http()
        .get(exportUrl('jobs', 'csv'))
        .set(as('accounts'))
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="jobs-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      const csv = (res.body as Buffer).toString('utf8');
      expect(csv.startsWith('﻿Job,Branch,Received,Customer')).toBe(true);
      expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
      expect(csv).not.toContain('Other Branch Customer');
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'report.exported' },
      });
      expect(audit).toMatchObject({ actorUserId: users['accounts'], entityType: 'report' });
      expect(audit.after).toMatchObject({ report: 'jobs', format: 'csv', rows: 1 });
    });

    it('exports XLSX and PDF', async () => {
      await job('reception', 'A1');
      const xlsx = await http()
        .get(exportUrl('deliveries', 'xlsx'))
        .set(as('accounts'))
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const pdf = await http()
        .get(exportUrl('collections', 'pdf'))
        .set(as('accounts'))
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.headers['content-type']).toBe('application/pdf');
      const outstanding = await http()
        .get(`/api/v1/reports/outstanding/export?format=csv`)
        .set(as('accounts'))
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((outstanding.body as Buffer).toString()).toContain(
        'Job,Branch,Customer,Status,Approved,Paid,Due,Age (days),Bucket',
      );
    }, 60_000);

    it('enforces export permissions and validates input', async () => {
      await http().get(exportUrl('jobs', 'csv')).set(as('reception')).expect(403);
      // Accounts can export reports but has no inventory access.
      const parts = await http().get(exportUrl('parts', 'csv')).set(as('accounts')).expect(403);
      expect((parts.body as ErrorBody).error.code).toBe('FORBIDDEN');
      await http().get(exportUrl('jobs', 'docx')).set(as('accounts')).expect(400);
      await http().get(exportUrl('secrets', 'csv')).set(as('accounts')).expect(400);
      await http()
        .get(exportUrl('jobs', 'csv', { branchId: org.branches['A2'] ?? '' }))
        .set(as('accounts'))
        .expect(404);
      expect(await t.prisma.auditLog.count({ where: { action: 'report.exported' } })).toBe(0);
    });
  });
});
