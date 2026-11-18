import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockOtpProvider } from '../src/customer-auth/otp-provider.js';
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
interface EstimateBody {
  id: string;
  version: number;
  status: string;
  rowVersion: number;
  subtotal: string;
  discountTotal: string;
  total: string;
  customerPayable: string;
  covered: string;
  taxNote: string;
  currency: string;
  lines: { lineTotal: string }[];
}

const LINES = [
  {
    lineType: 'PART',
    description: 'Keyboard assembly',
    quantity: '1',
    unitPrice: '2400.50',
    discount: '100.50',
  },
  {
    lineType: 'LABOUR',
    description: 'Replacement labour',
    quantity: '1.5',
    unitPrice: '400',
    coverage: 'GOODWILL',
  },
];

describe('Estimates and customer approval (real PostgreSQL)', () => {
  let t: TestApp;
  let org: OrgFixture;
  let otp: MockOtpProvider;
  const users: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    otp = t.app.get(MockOtpProvider);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    org = await createOrg(t.prisma, 'ORGA', ['A1']);
    const people: [string, string[]][] = [
      ['reception', ['RECEPTION']],
      ['tech1', ['TECHNICIAN']],
      ['tech2', ['TECHNICIAN']],
      ['accounts', ['ACCOUNTS']],
      ['manager', ['BRANCH_ADMIN']],
      ['super', ['SUPER_ADMIN']],
    ];
    for (const [key, roles] of people) {
      const user = await createUser(t.prisma, org, {
        email: `${key}@a.test`,
        roles,
        branches: ['A1'],
      });
      users[key] = user.id;
      tokens[key] = (await login(t, user.email)).accessToken;
    }
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(tokens[who] ?? '');

  async function setCurrency(code = 'XXX') {
    await http()
      .put('/api/v1/settings/money')
      .set(as('super'))
      .send({ value: { currency: code }, reason: 'Test configuration' })
      .expect(200);
  }

  async function move(jobId: string, who: string, to: string, extra: Record<string, unknown> = {}) {
    const { version } = await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } });
    return http()
      .post(`/api/v1/jobs/${jobId}/status-transitions`)
      .set(as(who))
      .send({ to, version, ...extra });
  }

  async function jobInPreparation(
    phone = '+91 98123 45678',
  ): Promise<{ jobId: string; customerId: string }> {
    const customer = await http()
      .post('/api/v1/customers')
      .set(as('reception'))
      .send({ type: 'INDIVIDUAL', name: 'Asha Rao', phone })
      .expect(201);
    const customerId = (customer.body as { id: string }).id;
    const asset = await http()
      .post('/api/v1/assets')
      .set(as('reception'))
      .send({ customerId, categoryId: org.categories['LAPTOP'], brand: 'Acme', model: 'Book' })
      .expect(201);
    const job = await http()
      .post('/api/v1/jobs')
      .set(as('reception'))
      .set('Idempotency-Key', newKey())
      .send({
        branchId: org.branches['A1'],
        customerId,
        assetId: (asset.body as { asset: { id: string } }).asset.id,
        serviceType: 'OUT_OF_WARRANTY',
        serviceMode: 'AT_SERVICE_CENTRE',
        complaint: 'Keyboard not working',
      })
      .expect(201);
    const jobId = (job.body as { id: string }).id;
    await http()
      .post(`/api/v1/jobs/${jobId}/assignments`)
      .set(as('manager'))
      .send({ technicianUserId: users['tech1'] })
      .expect(201);
    expect((await move(jobId, 'tech1', 'DIAGNOSIS')).status).toBe(200);
    expect((await move(jobId, 'tech1', 'ESTIMATE_PREPARATION')).status).toBe(200);
    return { jobId, customerId };
  }

  async function draft(
    jobId: string,
    who = 'tech1',
    lines: unknown[] = LINES,
  ): Promise<EstimateBody> {
    const response = await http()
      .post(`/api/v1/jobs/${jobId}/estimates`)
      .set(as(who))
      .send({ lines, notes: 'Includes testing' })
      .expect(201);
    return response.body as EstimateBody;
  }

  async function send(estimate: EstimateBody): Promise<{ estimate: EstimateBody; token: string }> {
    const response = await http()
      .post(`/api/v1/estimates/${estimate.id}/send`)
      .set(as('manager'))
      .send({ rowVersion: estimate.rowVersion })
      .expect(200);
    const body = response.body as { estimate: EstimateBody; approvalLink: { token: string } };
    return { estimate: body.estimate, token: body.approvalLink.token };
  }

  async function customerToken(phone = '+91 98123 45678'): Promise<string> {
    await http()
      .post('/api/v1/customer/auth/otp/request')
      .send({ organizationCode: 'ORGA', phone })
      .expect(200);
    const code = otp.sent.get(`+${phone.replace(/\D/g, '')}`) ?? '';
    const response = await http()
      .post('/api/v1/customer/auth/otp/verify')
      .send({ organizationCode: 'ORGA', phone, code })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  describe('drafts', () => {
    it('refuses to price estimates until the business currency is configured', async () => {
      const { jobId } = await jobInPreparation();
      const config = await http().get('/api/v1/estimates/config').set(as('tech1')).expect(200);
      expect(config.body).toEqual({ currency: null, validityDays: 14 });
      const response = await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('tech1'))
        .send({ lines: LINES })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe('CONFIGURATION_REQUIRED');
    });

    it('computes totals on the server, separating customer-payable from goodwill', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const estimate = await draft(jobId);
      expect(estimate).toMatchObject({
        version: 1,
        status: 'DRAFT',
        currency: 'XXX',
        subtotal: '3000.5000',
        discountTotal: '100.5000',
        total: '2900.0000',
        customerPayable: '2300.0000',
        covered: '600.0000',
        taxNote: 'Taxes, if applicable, to be confirmed.',
      });
      expect(estimate.lines.map((l) => l.lineTotal)).toEqual(['2300.0000', '600.0000']);
      const stored = await t.prisma.estimate.findUniqueOrThrow({ where: { id: estimate.id } });
      expect(stored.customerPayable.toFixed(4)).toBe('2300.0000');
    });

    it('rejects invalid lines, duplicate drafts, stale edits and the wrong job state', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const bad = await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('tech1'))
        .send({
          lines: [
            { lineType: 'PART', description: 'x', quantity: '1', unitPrice: '10', discount: '11' },
          ],
        })
        .expect(400);
      expect((bad.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
      await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('tech1'))
        .send({
          lines: [{ lineType: 'LABOUR', description: 'x', quantity: '1.5', unitPrice: '333.3333' }],
        })
        .expect(400);

      const estimate = await draft(jobId);
      await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('tech1'))
        .send({ lines: LINES })
        .expect(409);
      const updated = await http()
        .put(`/api/v1/estimates/${estimate.id}`)
        .set(as('tech1'))
        .send({ rowVersion: estimate.rowVersion, lines: [LINES[0]] })
        .expect(200);
      expect((updated.body as EstimateBody).customerPayable).toBe('2300.0000');
      await http()
        .put(`/api/v1/estimates/${estimate.id}`)
        .set(as('tech1'))
        .send({ rowVersion: estimate.rowVersion, lines: LINES })
        .expect(409);

      const { jobId: other } = await jobInPreparation('+91 98000 00002');
      await move(other, 'tech1', 'ON_HOLD', { reason: 'Waiting' });
      await http()
        .post(`/api/v1/jobs/${other}/estimates`)
        .set(as('tech1'))
        .send({ lines: LINES })
        .expect(409);
    });

    it('limits who may prepare estimates', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('reception'))
        .send({ lines: LINES })
        .expect(403);
      const notAssigned = await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('tech2'))
        .send({ lines: LINES })
        .expect(403);
      expect((notAssigned.body as ErrorBody).error.code).toBe('NOT_ASSIGNED');
      await draft(jobId, 'accounts');
    });
  });

  describe('sending and immutability', () => {
    it('moves the job to awaiting approval and makes the estimate immutable (API and database)', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const { estimate, token } = await send(await draft(jobId));
      expect(estimate.status).toBe('SENT');
      expect(token.length).toBeGreaterThan(30);
      expect((await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
        'AWAITING_CUSTOMER_APPROVAL',
      );
      expect(
        await t.prisma.notificationOutbox.count({
          where: { aggregateId: jobId, eventType: 'ESTIMATE_READY' },
        }),
      ).toBe(1);
      const link = await t.prisma.estimateApprovalLink.findFirstOrThrow();
      expect(link.tokenHash).not.toBe(token);

      const edit = await http()
        .put(`/api/v1/estimates/${estimate.id}`)
        .set(as('tech1'))
        .send({ rowVersion: estimate.rowVersion, lines: LINES })
        .expect(409);
      expect((edit.body as ErrorBody).error.code).toBe('ESTIMATE_NOT_EDITABLE');
      await expect(
        t.prisma.estimate.update({ where: { id: estimate.id }, data: { subtotal: '1' } }),
      ).rejects.toThrow(/immutable/);
      await expect(
        t.prisma.estimateLine.updateMany({
          where: { estimateId: estimate.id },
          data: { unitPrice: '1' },
        }),
      ).rejects.toThrow(/cannot change/);
      await expect(t.prisma.estimate.delete({ where: { id: estimate.id } })).rejects.toThrow(
        /cannot be deleted/,
      );
    });
  });

  describe('customer decisions', () => {
    it('blocks repair until the customer approves in the app, then allows it', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const { estimate } = await send(await draft(jobId));
      const blocked = await move(jobId, 'tech1', 'REPAIR_IN_PROGRESS');
      expect((blocked.body as ErrorBody).error.code).toBe('ESTIMATE_APPROVAL_REQUIRED');

      const customer = await customerToken();
      const listed = await http()
        .get(`/api/v1/customer/jobs/${jobId}/estimates`)
        .set(bearer(customer))
        .expect(200);
      expect((listed.body as { id: string; customerPayable: string }[])[0]).toMatchObject({
        id: estimate.id,
        customerPayable: '2300.0000',
      });

      await http()
        .post(`/api/v1/customer/estimates/${estimate.id}/decision`)
        .set(bearer(customer))
        .send({ decision: 'APPROVED' })
        .expect(400);
      const approved = await http()
        .post(`/api/v1/customer/estimates/${estimate.id}/decision`)
        .set(bearer(customer))
        .send({ decision: 'APPROVED', termsAccepted: true })
        .expect(200);
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        decision: { decision: 'APPROVED', method: 'CUSTOMER_APP' },
      });
      await http()
        .post(`/api/v1/customer/estimates/${estimate.id}/decision`)
        .set(bearer(customer))
        .send({ decision: 'REJECTED' })
        .expect(409);

      const decision = await t.prisma.estimateDecision.findFirstOrThrow();
      expect(decision).toMatchObject({ estimateVersion: 1, termsAccepted: true });
      expect(decision.customerPayable.toFixed(4)).toBe('2300.0000');
      expect(decision.termsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'estimate.approved', entityId: estimate.id },
        }),
      ).toBe(1);
      expect((await move(jobId, 'tech1', 'REPAIR_IN_PROGRESS')).status).toBe(200);
    });

    it('accepts a single-use link decision and supports returning the device unrepaired', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const { estimate, token } = await send(await draft(jobId));
      const view = await http()
        .post('/api/v1/public/estimate-links/view')
        .send({ token })
        .expect(200);
      expect(view.body).toMatchObject({
        id: estimate.id,
        jobNumber: expect.any(String) as string,
        status: 'SENT',
      });
      expect(view.body).not.toHaveProperty('rowVersion');
      await http().post('/api/v1/public/estimate-links/view').send({ token }).expect(200); // viewing does not consume

      const rejected = await http()
        .post('/api/v1/public/estimate-links/decision')
        .send({ token, decision: 'REJECTED', comment: 'Too expensive' })
        .expect(200);
      expect(rejected.body).toMatchObject({
        status: 'REJECTED',
        decision: { method: 'APPROVAL_LINK', comment: 'Too expensive' },
      });
      const reused = await http()
        .post('/api/v1/public/estimate-links/decision')
        .send({ token, decision: 'APPROVED', termsAccepted: true })
        .expect(400);
      expect((reused.body as ErrorBody).error.code).toBe('INVALID_TOKEN');
      await http()
        .post('/api/v1/public/estimate-links/view')
        .send({ token: 'x'.repeat(43) })
        .expect(400);

      expect(
        ((await move(jobId, 'tech1', 'REPAIR_IN_PROGRESS')).body as ErrorBody).error.code,
      ).toBe('ESTIMATE_APPROVAL_REQUIRED');
      expect((await move(jobId, 'tech1', 'READY_FOR_DELIVERY')).status).toBe(400);
      expect(
        (await move(jobId, 'tech1', 'READY_FOR_DELIVERY', { reason: 'Customer declined repair' }))
          .status,
      ).toBe(200);
    });

    it('supersedes the sent version when a revision starts', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const first = await send(await draft(jobId));
      expect(
        (
          await move(jobId, 'tech1', 'ESTIMATE_PREPARATION', {
            reason: 'Customer asked for cheaper part',
          })
        ).status,
      ).toBe(200);
      const v2 = await draft(jobId, 'tech1', [LINES[1]]);
      expect(v2.version).toBe(2);
      expect(
        (await t.prisma.estimate.findUniqueOrThrow({ where: { id: first.estimate.id } })).status,
      ).toBe('SUPERSEDED');
      await http()
        .post('/api/v1/public/estimate-links/view')
        .send({ token: first.token })
        .expect(400);

      const customer = await customerToken();
      const beforeSend = await http()
        .get(`/api/v1/customer/jobs/${jobId}/estimates`)
        .set(bearer(customer))
        .expect(200);
      expect(
        (beforeSend.body as { version: number; status: string }[]).map((e) => [
          e.version,
          e.status,
        ]),
      ).toEqual([[1, 'SUPERSEDED']]);

      const second = await send(v2);
      await http()
        .post(`/api/v1/customer/estimates/${first.estimate.id}/decision`)
        .set(bearer(customer))
        .send({ decision: 'REJECTED' })
        .expect(409);
      await http()
        .post(`/api/v1/customer/estimates/${second.estimate.id}/decision`)
        .set(bearer(customer))
        .send({ decision: 'APPROVED', termsAccepted: true })
        .expect(200);
      expect((await move(jobId, 'tech1', 'REPAIR_IN_PROGRESS')).status).toBe(200);
    });

    it('refuses decisions on expired estimates', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const { estimate, token } = await send(await draft(jobId));
      // Simulate time passing (immutability trigger bypassed in this test session only).
      await t.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
        await tx.$executeRaw`UPDATE "estimates" SET "valid_until" = CURRENT_DATE - 2 WHERE "id" = ${estimate.id}::uuid`;
      });
      const response = await http()
        .post('/api/v1/public/estimate-links/decision')
        .send({ token, decision: 'APPROVED', termsAccepted: true })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe('ESTIMATE_EXPIRED');
      const staffView = await http()
        .get(`/api/v1/estimates/${estimate.id}`)
        .set(as('manager'))
        .expect(200);
      expect(staffView.body).toMatchObject({ status: 'SENT', expired: true });
      // The failed attempt did not consume the link.
      expect((await t.prisma.estimateApprovalLink.findFirstOrThrow()).usedAt).toBeNull();
    });

    it('keeps customers to their own estimates and hides drafts', async () => {
      await setCurrency();
      const { jobId } = await jobInPreparation();
      const estimate = await draft(jobId);
      const owner = await customerToken();
      const listed = await http()
        .get(`/api/v1/customer/jobs/${jobId}/estimates`)
        .set(bearer(owner))
        .expect(200);
      expect(listed.body).toEqual([]);
      await http()
        .post(`/api/v1/customer/estimates/${estimate.id}/decision`)
        .set(bearer(owner))
        .send({ decision: 'REJECTED' })
        .expect(409);

      const { estimate: sent } = await send(estimate);
      await http()
        .post('/api/v1/customers')
        .set(as('reception'))
        .send({ type: 'INDIVIDUAL', name: 'Other', phone: '+91 98000 99999' })
        .expect(201);
      const stranger = await customerToken('+91 98000 99999');
      await http()
        .get(`/api/v1/customer/jobs/${jobId}/estimates`)
        .set(bearer(stranger))
        .expect(404);
      await http()
        .post(`/api/v1/customer/estimates/${sent.id}/decision`)
        .set(bearer(stranger))
        .send({ decision: 'REJECTED' })
        .expect(404);
    });
  });
});
