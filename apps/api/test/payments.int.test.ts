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
interface PaymentBody {
  id: string;
  receiptNumber: string;
  amount: string;
  status: string;
  refunded: string;
  onAccount: string;
  allocated: string;
}
interface Account {
  received: string;
  refunded: string;
  allocated: string;
  onAccount: string;
  paymentCount: number;
}

describe('Payments, refunds, reversals and receipts (real PostgreSQL)', () => {
  let t: TestApp;
  let org: OrgFixture;
  const tokens: Record<string, string> = {};
  let customerId: string;
  let jobId: string;

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
      ['accounts', ['ACCOUNTS'], ['A1']],
      ['reception', ['RECEPTION'], ['A1']],
      ['manager', ['BRANCH_ADMIN'], ['A1']],
      ['super', ['SUPER_ADMIN'], []],
    ];
    for (const [key, roles, branches] of people) {
      const user = await createUser(t.prisma, org, { email: `${key}@a.test`, roles, branches });
      tokens[key] = (await login(t, user.email)).accessToken;
    }
    const customer = await http()
      .post('/api/v1/customers')
      .set(as('reception'))
      .send({ type: 'INDIVIDUAL', name: 'Asha', phone: '+919812345678' })
      .expect(201);
    customerId = (customer.body as { id: string }).id;
    const asset = await http()
      .post('/api/v1/assets')
      .set(as('reception'))
      .send({ customerId, categoryId: org.categories['LAPTOP'], brand: 'A', model: 'B' })
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
        complaint: 'Screen broken',
      })
      .expect(201);
    jobId = (job.body as { id: string }).id;
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(tokens[who] ?? '');

  async function setCurrency() {
    await http()
      .put('/api/v1/settings/money')
      .set(as('super'))
      .send({ value: { currency: 'XXX' }, reason: 'test' })
      .expect(200);
  }

  function pay(body: Record<string, unknown>, key = newKey(), who = 'accounts') {
    return http()
      .post('/api/v1/payments')
      .set(as(who))
      .set('Idempotency-Key', key)
      .send({ branchId: org.branches['A1'], customerId, jobId, ...body });
  }

  async function account(): Promise<Account> {
    return (
      await http().get(`/api/v1/customers/${customerId}/account`).set(as('accounts')).expect(200)
    ).body as Account;
  }

  /** Every payment must satisfy amount = allocated + refunded + on-account (or be reversed). */
  async function assertPaymentsReconcile() {
    const rows = await t.prisma.payment.findMany({ include: { refunds: true } });
    for (const p of rows) {
      const refunds = p.refunds.reduce((acc, r) => acc.plus(r.amount), p.amount.minus(p.amount));
      expect(refunds.toFixed(4)).toBe(p.refundedTotal.toFixed(4));
      if (p.status === 'RECORDED')
        expect(p.allocatedTotal.plus(p.refundedTotal).lte(p.amount)).toBe(true);
    }
  }

  describe('recording', () => {
    it('requires the business currency', async () => {
      const response = await pay({ amount: '100', method: 'CASH' }).expect(409);
      expect((response.body as ErrorBody).error.code).toBe('CONFIGURATION_REQUIRED');
    });

    it('records idempotently with branch receipt numbers and queues a customer receipt notification', async () => {
      await setCurrency();
      const key = newKey();
      const first = await pay({ amount: '500', method: 'CASH' }, key).expect(201);
      const replay = await pay({ amount: '500', method: 'CASH' }, key).expect(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect((replay.body as PaymentBody).id).toBe((first.body as PaymentBody).id);
      expect((first.body as PaymentBody).receiptNumber).toBe(
        `RCPT-A1-${new Date().getUTCFullYear()}-000001`,
      );
      expect(await t.prisma.payment.count()).toBe(1);
      expect(
        await t.prisma.notificationOutbox.count({ where: { eventType: 'PAYMENT_RECEIVED' } }),
      ).toBe(1);
      expect(await t.prisma.auditLog.count({ where: { action: 'payment.recorded' } })).toBe(1);
    });

    it('validates references, dates, methods, permissions and ownership', async () => {
      await setCurrency();
      expect((await pay({ amount: '100', method: 'UPI' })).status).toBe(400);
      const card = await pay({
        amount: '100',
        method: 'CARD_TERMINAL',
        reference: '4111 1111 1111 1111',
      }).expect(400);
      expect(JSON.stringify(card.body)).toContain('Do not enter card numbers');
      expect(await t.prisma.payment.count()).toBe(0);
      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect((await pay({ amount: '100', method: 'CASH', receivedAt: future })).status).toBe(400);
      expect((await pay({ amount: '100', method: 'CASH' }, newKey(), 'reception')).status).toBe(
        403,
      );
      expect(
        (await pay({ amount: '100', method: 'CASH', branchId: org.branches['A2'] })).status,
      ).toBe(404);

      await http()
        .put('/api/v1/settings/payments')
        .set(as('super'))
        .send({ value: { methods: ['CASH'], receiptFooter: 'x' }, reason: 'test' })
        .expect(200);
      const disabled = await pay({ amount: '100', method: 'UPI', reference: 'UTR1' }).expect(400);
      expect((disabled.body as ErrorBody).error.code).toBe('PAYMENT_METHOD_DISABLED');

      const other = await http()
        .post('/api/v1/customers')
        .set(as('reception'))
        .send({ type: 'INDIVIDUAL', name: 'B', phone: '+919800000002' })
        .expect(201);
      expect(
        (
          await pay({
            amount: '100',
            method: 'CASH',
            customerId: (other.body as { id: string }).id,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('balances', () => {
    it('reconciles split payments, overpayment, refunds and reversals', async () => {
      await setCurrency();
      const cash = (await pay({ amount: '500', method: 'CASH' }).expect(201)).body as PaymentBody;
      const upi = (
        await pay({ amount: '700.50', method: 'UPI', reference: 'UTR998877' }).expect(201)
      ).body as PaymentBody;
      expect(await account()).toMatchObject({
        received: '1200.5000',
        refunded: '0.0000',
        allocated: '0.0000',
        onAccount: '1200.5000',
        paymentCount: 2,
      });

      const refunded = await http()
        .post(`/api/v1/payments/${upi.id}/refunds`)
        .set(as('accounts'))
        .send({ amount: '200.50', method: 'UPI', reference: 'RFUTR1', reason: 'Overpaid' })
        .expect(201);
      expect(refunded.body).toMatchObject({ refunded: '200.5000', onAccount: '500.0000' });
      const tooMuch = await http()
        .post(`/api/v1/payments/${upi.id}/refunds`)
        .set(as('accounts'))
        .send({ amount: '500.01', method: 'CASH', reason: 'x' })
        .expect(409);
      expect((tooMuch.body as ErrorBody).error.code).toBe('REFUND_EXCEEDS_BALANCE');

      const reversed = await http()
        .post(`/api/v1/payments/${cash.id}/reversal`)
        .set(as('accounts'))
        .send({ reason: 'Entered twice' })
        .expect(201);
      expect(reversed.body).toMatchObject({ status: 'REVERSED', onAccount: '0.0000' });
      const notReversible = await http()
        .post(`/api/v1/payments/${upi.id}/reversal`)
        .set(as('accounts'))
        .send({ reason: 'x' })
        .expect(409);
      expect((notReversible.body as ErrorBody).error.code).toBe('PAYMENT_NOT_REVERSIBLE');
      await http()
        .post(`/api/v1/payments/${cash.id}/refunds`)
        .set(as('accounts'))
        .send({ amount: '1', method: 'CASH', reason: 'x' })
        .expect(409);

      expect(await account()).toMatchObject({
        received: '700.5000',
        refunded: '200.5000',
        onAccount: '500.0000',
        paymentCount: 1,
      });
      await assertPaymentsReconcile();
    });

    it('never refunds more than available under concurrency', async () => {
      await setCurrency();
      const payment = (await pay({ amount: '500', method: 'CASH' }).expect(201))
        .body as PaymentBody;
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          http()
            .post(`/api/v1/payments/${payment.id}/refunds`)
            .set(as('accounts'))
            .send({ amount: '200', method: 'CASH', reason: 'Split refund' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409, 409]);
      expect(await account()).toMatchObject({ refunded: '400.0000', onAccount: '100.0000' });
      await assertPaymentsReconcile();
    });

    it('protects recorded payments and refunds at the database level', async () => {
      await setCurrency();
      const payment = (await pay({ amount: '500', method: 'CASH' }).expect(201))
        .body as PaymentBody;
      await expect(
        t.prisma.payment.update({ where: { id: payment.id }, data: { amount: '1' } }),
      ).rejects.toThrow(/immutable/);
      await expect(t.prisma.payment.delete({ where: { id: payment.id } })).rejects.toThrow(
        /cannot be deleted/,
      );
      await http()
        .post(`/api/v1/payments/${payment.id}/refunds`)
        .set(as('accounts'))
        .send({ amount: '10', method: 'CASH', reason: 'x' })
        .expect(201);
      await expect(t.prisma.paymentRefund.deleteMany()).rejects.toThrow(/append-only/);
    });
  });

  describe('receipts and reports', () => {
    it('prints a receipt and issues a new version when the payment is reversed', async () => {
      await setCurrency();
      const payment = (await pay({ amount: '500', method: 'CASH' }).expect(201))
        .body as PaymentBody;
      const first = (
        await http().post(`/api/v1/payments/${payment.id}/receipt`).set(as('accounts')).expect(201)
      ).body as { documentId: string; version: number; url: string };
      const pdf = Buffer.from(await (await fetch(first.url)).arrayBuffer());
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const again = (
        await http().post(`/api/v1/payments/${payment.id}/receipt`).set(as('accounts')).expect(201)
      ).body as { documentId: string };
      expect(again.documentId).toBe(first.documentId);

      await http()
        .post(`/api/v1/payments/${payment.id}/reversal`)
        .set(as('accounts'))
        .send({ reason: 'Cheque bounced' })
        .expect(201);
      const afterReversal = (
        await http().post(`/api/v1/payments/${payment.id}/receipt`).set(as('accounts')).expect(201)
      ).body as { documentId: string; version: number };
      expect(afterReversal.version).toBe(2);
      const v2 = await t.prisma.document.findUniqueOrThrow({
        where: { id: afterReversal.documentId },
      });
      expect(v2.snapshot).toMatchObject({
        status: 'REVERSED',
        reversalReason: 'Cheque bounced',
        footer: '', // no tax footer on receipts (owner Q27a, ADR 0024)
        footerIsPlaceholder: false,
      });
      const v1 = await t.prisma.document.findUniqueOrThrow({ where: { id: first.documentId } });
      expect(v1.snapshot).toMatchObject({ status: 'RECORDED' });
    }, 60_000);

    it('summarizes collections by method and cashier within branch scope', async () => {
      await setCurrency();
      await pay({ amount: '500', method: 'CASH' }).expect(201);
      const upi = (await pay({ amount: '300', method: 'UPI', reference: 'UTR1' }).expect(201))
        .body as PaymentBody;
      const reversed = (await pay({ amount: '999', method: 'CASH' }).expect(201))
        .body as PaymentBody;
      await http()
        .post(`/api/v1/payments/${reversed.id}/reversal`)
        .set(as('accounts'))
        .send({ reason: 'Mistake' })
        .expect(201);
      await http()
        .post(`/api/v1/payments/${upi.id}/refunds`)
        .set(as('accounts'))
        .send({ amount: '100', method: 'UPI', reference: 'R1', reason: 'x' })
        .expect(201);

      const from = new Date(Date.now() - 3_600_000).toISOString();
      const to = new Date(Date.now() + 3_600_000).toISOString();
      const report = await http()
        .get(`/api/v1/reports/collections?from=${from}&to=${to}`)
        .set(as('accounts'))
        .expect(200);
      expect(report.body).toMatchObject({
        received: '800.0000',
        refunded: '100.0000',
        net: '700.0000',
      });
      const byMethod = (
        report.body as { byMethod: { method: string; received: string; refunded: string }[] }
      ).byMethod;
      expect(byMethod).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'CASH', received: '500.0000', refunded: '0.0000' }),
          expect.objectContaining({ method: 'UPI', received: '300.0000', refunded: '100.0000' }),
        ]),
      );
      expect((report.body as { byCashier: { received: string }[] }).byCashier).toEqual([
        expect.objectContaining({ received: '800.0000' }),
      ]);
      await http()
        .get(`/api/v1/reports/collections?from=${from}&to=${to}&branchId=${org.branches['A2']}`)
        .set(as('manager'))
        .expect(404);
      await http()
        .get(`/api/v1/reports/collections?from=${from}&to=${to}`)
        .set(as('reception'))
        .expect(403);
    });

    it('lets customers see and download only their own receipts', async () => {
      await setCurrency();
      const payment = (await pay({ amount: '500', method: 'CASH' }).expect(201))
        .body as PaymentBody;
      const otp = t.app.get(MockOtpProvider);
      const signIn = async (phone: string, fullName?: string) => {
        await http()
          .post('/api/v1/customer/auth/otp/request')
          .send({ organizationCode: 'ORGA', phone })
          .expect(200);
        const code = otp.sent.get(phone) ?? '';
        const r = await http()
          .post('/api/v1/customer/auth/otp/verify')
          .send({ organizationCode: 'ORGA', phone, code, ...(fullName ? { fullName } : {}) })
          .expect(200);
        return (r.body as { accessToken: string }).accessToken;
      };
      const owner = await signIn('+919812345678');
      const mine = await http().get('/api/v1/customer/payments').set(bearer(owner)).expect(200);
      expect((mine.body as { receiptNumber: string }[]).map((p) => p.receiptNumber)).toEqual([
        payment.receiptNumber,
      ]);
      expect(Object.keys((mine.body as object[])[0] ?? {})).not.toContain('receivedBy');
      const stranger = await signIn('+919800000099', 'Stranger');
      await http()
        .post(`/api/v1/customer/payments/${payment.id}/receipt`)
        .set(bearer(stranger))
        .expect(404);
      expect(
        await http()
          .get('/api/v1/customer/payments')
          .set(bearer(stranger))
          .expect(200)
          .then((r) => r.body as unknown[]),
      ).toEqual([]);
    });
  });
});
