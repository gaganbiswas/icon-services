import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PNG_BYTES,
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
  error: { code: string; details?: { path: string }[] };
}
interface CustomerBody {
  id: string;
  customerCode: string;
  phone: string;
  version: number;
  activeConsents: { channel: string; purpose: string; policyVersion: string }[];
}
interface AssetBody {
  asset: { id: string };
  duplicateSerialWarning: { count: number } | null;
}
interface JobBody {
  id: string;
  jobNumber: string;
  status: string;
  customerStatus: string;
  statusHistory: { toStatus: string; fromStatus: string | null }[];
  attachments: { fileId: string }[];
}

/** Phase 3: customers, consents, devices, idempotent intake, files, receipts. */
describe('Customer, device and job intake (real PostgreSQL + S3)', () => {
  let t: TestApp;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    orgA = await createOrg(t.prisma, 'ORGA', ['A1', 'A2']);
    orgB = await createOrg(t.prisma, 'ORGB', ['B1']);
    await createUser(t.prisma, orgA, {
      email: 'reception@a.test',
      roles: ['RECEPTION'],
      branches: ['A1'],
    });
    await createUser(t.prisma, orgA, {
      email: 'tech@a.test',
      roles: ['TECHNICIAN'],
      branches: ['A1'],
    });
    await createUser(t.prisma, orgA, { email: 'super@a.test', roles: ['SUPER_ADMIN'] });
    await createUser(t.prisma, orgB, {
      email: 'reception@b.test',
      roles: ['RECEPTION'],
      branches: ['B1'],
    });
    for (const who of ['reception@a.test', 'tech@a.test', 'super@a.test', 'reception@b.test']) {
      token[who] = (await login(t, who)).accessToken;
    }
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(token[who] ?? '');

  async function createCustomer(
    who = 'reception@a.test',
    overrides: Record<string, unknown> = {},
  ): Promise<CustomerBody> {
    const response = await http()
      .post('/api/v1/customers')
      .set(as(who))
      .send({
        type: 'INDIVIDUAL',
        name: 'Asha Rao',
        phone: '+91 98123 45678',
        email: 'asha@example.test',
        billingAddress: { line1: '12 Main Rd', city: 'Kolkata', countryCode: 'in' },
        consents: [{ channel: 'WHATSAPP', purpose: 'SERVICE_UPDATES' }],
        ...overrides,
      })
      .expect(201);
    return response.body as CustomerBody;
  }

  async function createAsset(
    customerId: string,
    who = 'reception@a.test',
    serial = 'SN-123 45',
  ): Promise<AssetBody> {
    const response = await http()
      .post('/api/v1/assets')
      .set(as(who))
      .send({
        customerId,
        categoryId: orgA.categories['LAPTOP'],
        brand: 'Acme',
        model: 'Book 14',
        serialNumber: serial,
        attributes: { ram: '16 GB' },
      })
      .expect(201);
    return response.body as AssetBody;
  }

  function jobBody(customerId: string, assetId: string, overrides: Record<string, unknown> = {}) {
    return {
      branchId: orgA.branches['A1'],
      customerId,
      assetId,
      serviceType: 'OUT_OF_WARRANTY',
      serviceMode: 'AT_SERVICE_CENTRE',
      complaint: 'Does not power on after a spill',
      accessoriesReceived: ['Charger'],
      intakeChecklist: [{ item: 'Device powers on', checked: false }],
      acknowledgementMethod: 'SIGNED_PAPER',
      ...overrides,
    };
  }

  describe('customers', () => {
    it('normalizes phone numbers, generates codes and records consent with the policy version', async () => {
      const customer = await createCustomer();
      expect(customer.customerCode).toBe('C000001');
      expect(customer.phone).toBe('+91 98123 45678');
      expect(customer.activeConsents).toEqual([
        expect.objectContaining({
          channel: 'WHATSAPP',
          purpose: 'SERVICE_UPDATES',
          policyVersion: 'UNCONFIRMED-DRAFT',
        }),
      ]);
      const stored = await t.prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(stored.phoneE164).toBe('+919812345678');
      expect(
        (await createCustomer('reception@a.test', { phone: '+91 98000 00001' })).customerCode,
      ).toBe('C000002');
    });

    it('rejects numbers without a country code while no default region is configured', async () => {
      const response = await http()
        .post('/api/v1/customers')
        .set(as('reception@a.test'))
        .send({ type: 'INDIVIDUAL', name: 'X', phone: '98123 45678' })
        .expect(400);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_PHONE');
    });

    it('searches by name, phone and customer code within the organization only', async () => {
      const customer = await createCustomer();
      await createCustomer('reception@b.test', { name: 'Asha Other Org' });
      for (const q of ['asha', '98123', 'C000001']) {
        const result = await http()
          .get(`/api/v1/customers?q=${q}`)
          .set(as('reception@a.test'))
          .expect(200);
        const ids = (result.body as { items: { id: string }[] }).items.map((c) => c.id);
        expect(ids).toEqual([customer.id]);
      }
      await http().get(`/api/v1/customers/${customer.id}`).set(as('reception@b.test')).expect(404);
    });

    it('keeps consent history append-only when withdrawing', async () => {
      const customer = await createCustomer();
      const after = await http()
        .put(`/api/v1/customers/${customer.id}/consents`)
        .set(as('reception@a.test'))
        .send({ channel: 'WHATSAPP', purpose: 'SERVICE_UPDATES', granted: false })
        .expect(200);
      expect(after.body).toEqual([]);
      const rows = await t.prisma.customerConsent.findMany({ where: { customerId: customer.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.withdrawnAt).not.toBeNull();
    });

    it('enforces permissions and optimistic concurrency', async () => {
      await http()
        .post('/api/v1/customers')
        .set(as('tech@a.test'))
        .send({ type: 'INDIVIDUAL', name: 'X', phone: '+919812345678' })
        .expect(403);
      const customer = await createCustomer();
      await http()
        .patch(`/api/v1/customers/${customer.id}`)
        .set(as('reception@a.test'))
        .send({ version: 1, name: 'Asha R.' })
        .expect(200);
      const stale = await http()
        .patch(`/api/v1/customers/${customer.id}`)
        .set(as('reception@a.test'))
        .send({ version: 1, name: 'Stale' })
        .expect(409);
      expect((stale.body as ErrorBody).error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('devices', () => {
    it('validates category attributes and warns about duplicate serial numbers', async () => {
      const customer = await createCustomer();
      const first = await createAsset(customer.id);
      expect(first.duplicateSerialWarning).toBeNull();
      const second = await createAsset(customer.id, 'reception@a.test', 'sn12345');
      expect(second.duplicateSerialWarning).toEqual(expect.objectContaining({ count: 1 }));

      const bad = await http()
        .post('/api/v1/assets')
        .set(as('reception@a.test'))
        .send({
          customerId: customer.id,
          categoryId: orgA.categories['LAPTOP'],
          brand: 'A',
          model: 'B',
          attributes: { inkColour: 'red' },
        })
        .expect(400);
      expect((bad.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('cannot use another organization’s customer or category', async () => {
      const otherCustomer = await createCustomer('reception@b.test');
      await http()
        .post('/api/v1/assets')
        .set(as('reception@a.test'))
        .send({
          customerId: otherCustomer.id,
          categoryId: orgA.categories['LAPTOP'],
          brand: 'A',
          model: 'B',
        })
        .expect(404);
      const customer = await createCustomer();
      await http()
        .post('/api/v1/assets')
        .set(as('reception@a.test'))
        .send({
          customerId: customer.id,
          categoryId: orgB.categories['LAPTOP'],
          brand: 'A',
          model: 'B',
        })
        .expect(404);
    });
  });

  describe('job intake', () => {
    it('creates a numbered job with initial status history, audited', async () => {
      const customer = await createCustomer();
      const { asset } = await createAsset(customer.id);
      const response = await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, asset.id))
        .expect(201);
      const job = response.body as JobBody;
      const year = new Date().getUTCFullYear();
      expect(job.jobNumber).toBe(`A1-${year}-000001`);
      expect(job.status).toBe('RECEIVED');
      expect(job.customerStatus).toBe('RECEIVED');
      expect(job.statusHistory).toEqual([
        expect.objectContaining({ fromStatus: null, toStatus: 'RECEIVED' }),
      ]);
      expect(
        await t.prisma.auditLog.count({ where: { action: 'job.created', entityId: job.id } }),
      ).toBe(1);
    });

    it('requires an Idempotency-Key and replays retries without duplicating the job', async () => {
      const customer = await createCustomer();
      const { asset } = await createAsset(customer.id);
      const body = jobBody(customer.id, asset.id);
      const missing = await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .send(body)
        .expect(400);
      expect((missing.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const key = newKey();
      const first = await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      const retry = await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect((retry.body as JobBody).id).toBe((first.body as JobBody).id);
      expect(await t.prisma.serviceJob.count()).toBe(1);

      const changed = await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', key)
        .send({ ...body, complaint: 'Different complaint text' })
        .expect(422);
      expect((changed.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('creates exactly one job for concurrent retries with the same key', async () => {
      const customer = await createCustomer();
      const { asset } = await createAsset(customer.id);
      const key = newKey();
      const body = jobBody(customer.id, asset.id);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          http()
            .post('/api/v1/jobs')
            .set(as('reception@a.test'))
            .set('Idempotency-Key', key)
            .send(body),
        ),
      );
      const ok = responses.filter((r) => r.status === 201);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      for (const r of responses) expect([201, 409]).toContain(r.status);
      expect(new Set(ok.map((r) => (r.body as JobBody).id)).size).toBe(1);
      expect(await t.prisma.serviceJob.count()).toBe(1);
    });

    it('assigns unique sequential numbers under concurrent intake', async () => {
      const customer = await createCustomer();
      const { asset } = await createAsset(customer.id);
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          http()
            .post('/api/v1/jobs')
            .set(as('reception@a.test'))
            .set('Idempotency-Key', newKey())
            .send(jobBody(customer.id, asset.id)),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
      const numbers = responses.map((r) => (r.body as JobBody).jobNumber).sort();
      const year = new Date().getUTCFullYear();
      expect(numbers).toEqual(
        Array.from({ length: 10 }, (_, i) => `A1-${year}-${String(i + 1).padStart(6, '0')}`),
      );
    });

    it('rejects devices of other customers, other branches and missing on-site addresses', async () => {
      const customer = await createCustomer();
      const other = await createCustomer('reception@a.test', {
        name: 'Other',
        phone: '+919800000002',
      });
      const { asset } = await createAsset(other.id);
      await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, asset.id))
        .expect(404);

      const own = await createAsset(customer.id);
      await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, own.asset.id, { branchId: orgA.branches['A2'] }))
        .expect(404);
      await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, own.asset.id, { serviceMode: 'ON_SITE' }))
        .expect(400);
    });

    it('keeps status history append-only at the database level', async () => {
      const customer = await createCustomer();
      const { asset } = await createAsset(customer.id);
      await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, asset.id))
        .expect(201);
      await expect(
        t.prisma.jobStatusHistory.updateMany({ data: { reason: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(t.prisma.jobStatusHistory.deleteMany()).rejects.toThrow(/append-only/);
    });

    it('lists and searches jobs within branch scope', async () => {
      const customer = await createCustomer();
      const { asset } = await createAsset(customer.id);
      const created = await http()
        .post('/api/v1/jobs')
        .set(as('super@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, asset.id, { branchId: orgA.branches['A2'] }))
        .expect(201);
      const job = created.body as JobBody;

      const superList = await http()
        .get('/api/v1/jobs?q=SN-123')
        .set(as('super@a.test'))
        .expect(200);
      expect((superList.body as { items: { id: string }[] }).items.map((j) => j.id)).toEqual([
        job.id,
      ]);
      const scoped = await http().get('/api/v1/jobs').set(as('reception@a.test')).expect(200);
      expect((scoped.body as { total: number }).total).toBe(0);
      await http().get(`/api/v1/jobs/${job.id}`).set(as('reception@a.test')).expect(404);
      await http().get(`/api/v1/jobs/${job.id}`).set(as('reception@b.test')).expect(404);
      for (const q of [job.jobNumber, '98123', 'asha']) {
        const found = await http()
          .get(`/api/v1/jobs?q=${encodeURIComponent(q)}`)
          .set(as('super@a.test'))
          .expect(200);
        expect((found.body as { total: number }).total).toBe(1);
      }
    });
  });

  describe('files and receipts', () => {
    it('accepts sniffed images, rejects disguised HTML, and serves attachments via signed URLs', async () => {
      const rejected = await http()
        .post('/api/v1/files')
        .set(as('reception@a.test'))
        .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(415);
      expect((rejected.body as ErrorBody).error.code).toBe('UNSUPPORTED_FILE');

      const uploaded = await http()
        .post('/api/v1/files')
        .set(as('reception@a.test'))
        .attach('file', PNG_BYTES, {
          filename: '../../front.png',
          contentType: 'application/octet-stream',
        })
        .expect(201);
      const file = uploaded.body as { id: string; mimeType: string; originalName: string };
      expect(file).toMatchObject({ mimeType: 'image/png', originalName: 'front.png' });

      const customer = await createCustomer();
      const { asset } = await createAsset(customer.id);
      const created = await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, asset.id, { attachmentFileIds: [file.id] }))
        .expect(201);
      const job = created.body as JobBody;
      expect(job.attachments.map((a) => a.fileId)).toEqual([file.id]);

      const link = await http()
        .get(`/api/v1/jobs/${job.id}/attachments/${file.id}/url`)
        .set(as('reception@a.test'))
        .expect(200);
      const download = await fetch((link.body as { url: string }).url);
      expect(download.status).toBe(200);
      expect(Buffer.from(await download.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
      expect(download.headers.get('content-disposition')).toContain('attachment');

      // Another organization cannot reach it, and files cannot be attached twice.
      await http()
        .get(`/api/v1/jobs/${job.id}/attachments/${file.id}/url`)
        .set(as('reception@b.test'))
        .expect(404);
      await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, asset.id, { attachmentFileIds: [file.id] }))
        .expect(404);
    });

    it('generates an immutable PDF receipt once and reuses it for reprints', async () => {
      const customer = await createCustomer('reception@a.test', { name: 'राम <b>Kumar</b>' });
      const { asset } = await createAsset(customer.id);
      const created = await http()
        .post('/api/v1/jobs')
        .set(as('reception@a.test'))
        .set('Idempotency-Key', newKey())
        .send(jobBody(customer.id, asset.id))
        .expect(201);
      const job = created.body as JobBody;

      const first = await http()
        .post(`/api/v1/jobs/${job.id}/receipt`)
        .set(as('reception@a.test'))
        .expect(201);
      const link = first.body as { documentId: string; documentNumber: string; url: string };
      expect(link.documentNumber).toBe(job.jobNumber);
      const pdf = Buffer.from(await (await fetch(link.url)).arrayBuffer());
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1000);

      // Changing the customer later does not change the reprint.
      await t.prisma.customer.update({ where: { id: customer.id }, data: { name: 'Renamed' } });
      const again = await http()
        .post(`/api/v1/jobs/${job.id}/receipt`)
        .set(as('reception@a.test'))
        .expect(201);
      expect((again.body as { documentId: string }).documentId).toBe(link.documentId);
      const document = await t.prisma.document.findUniqueOrThrow({
        where: { id: link.documentId },
      });
      expect(JSON.stringify(document.snapshot)).toContain('राम <b>Kumar</b>');
      await expect(t.prisma.document.deleteMany()).rejects.toThrow(/immutable/);

      const thermal = await http()
        .post(`/api/v1/jobs/${job.id}/receipt?layout=THERMAL_80`)
        .set(as('reception@a.test'))
        .expect(201);
      expect((thermal.body as { documentId: string }).documentId).not.toBe(link.documentId);
      await http().post(`/api/v1/jobs/${job.id}/receipt`).set(as('reception@b.test')).expect(404);
    }, 60_000);
  });
});
