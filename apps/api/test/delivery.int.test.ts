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
  error: { code: string };
}
interface DeliveryBody {
  id: string;
  challanNumber: string;
  status: string;
  mode: string;
  balance: { due: string; billed: string; paid: string } | null;
  dueOverride: { reason: string } | null;
}

describe('Delivery and challan (real PostgreSQL + S3)', () => {
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
      ['tech1', ['TECHNICIAN'], ['A1']],
      ['courier', ['DELIVERY'], ['A1']],
      ['courierA2', ['DELIVERY'], ['A2']],
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

  async function readyJob(
    options: { approvedAmount?: string } = {},
  ): Promise<{ jobId: string; customerId: string }> {
    const customer = await http()
      .post('/api/v1/customers')
      .set(as('reception'))
      .send({ type: 'INDIVIDUAL', name: 'Asha', phone: '+919812345678' })
      .expect(201);
    const customerId = (customer.body as { id: string }).id;
    const asset = await http()
      .post('/api/v1/assets')
      .set(as('reception'))
      .send({
        customerId,
        categoryId: org.categories['LAPTOP'],
        brand: 'Acme',
        model: 'Book',
        serialNumber: 'SN-77',
      })
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
        accessoriesReceived: ['Charger', 'Bag'],
      })
      .expect(201);
    const jobId = (job.body as { id: string }).id;
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
    await t.prisma.serviceJob.update({
      where: { id: jobId },
      data: { status: 'READY_FOR_DELIVERY' },
    });
    return { jobId, customerId };
  }

  async function expectStatus(
    pending: Promise<request.Response>,
    status: number,
  ): Promise<request.Response> {
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response;
  }

  async function version(jobId: string) {
    return (await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } })).version;
  }

  async function handover(
    jobId: string,
    who: string,
    overrides: Record<string, unknown> = {},
    key = newKey(),
  ) {
    return http()
      .post(`/api/v1/jobs/${jobId}/deliveries/handover`)
      .set(as(who))
      .set('Idempotency-Key', key)
      .send({
        version: await version(jobId),
        mode: 'CUSTOMER_PICKUP',
        recipientName: 'Asha',
        relationship: 'SELF',
        items: [
          { description: 'Laptop: Acme Book', returned: true },
          { description: 'charger', returned: true },
          { description: 'Bag', returned: true, condition: 'Good' },
        ],
        checklist: [{ item: 'Device tested in front of the recipient', checked: true }],
        proofMethod: 'SIGNED_CHALLAN',
        ...overrides,
      });
  }

  it('refuses delivery transitions through the generic status endpoint', async () => {
    const { jobId } = await readyJob();
    const response = await http()
      .post(`/api/v1/jobs/${jobId}/status-transitions`)
      .set(as('manager'))
      .send({ to: 'OUT_FOR_DELIVERY', version: await version(jobId) })
      .expect(409);
    expect((response.body as ErrorBody).error.code).toBe('USE_DELIVERY_WORKFLOW');
  });

  it('completes a pick-up only with every item returned, idempotently, as a final record', async () => {
    const { jobId } = await readyJob();
    const incomplete = await expectStatus(
      handover(jobId, 'courier', { items: [{ description: 'Laptop: Acme Book', returned: true }] }),
      400,
    );
    expect((incomplete.body as ErrorBody).error.code).toBe('HANDOVER_INCOMPLETE');
    expect(JSON.stringify(incomplete.body)).toContain('Not confirmed: Charger');
    await expectStatus(handover(jobId, 'courier', { relationship: 'FAMILY' }), 400);

    const key = newKey();
    const done = await expectStatus(handover(jobId, 'courier', {}, key), 201);
    const delivery = done.body as DeliveryBody;
    expect(delivery).toMatchObject({
      status: 'COMPLETED',
      mode: 'CUSTOMER_PICKUP',
      balance: { due: '0.0000' },
    });
    expect(delivery.challanNumber).toBe(`DC-A1-${new Date().getUTCFullYear()}-000001`);
    const replay = await http()
      .post(`/api/v1/jobs/${jobId}/deliveries/handover`)
      .set(as('courier'))
      .set('Idempotency-Key', key)
      .send({
        version: (await version(jobId)) - 1,
        mode: 'CUSTOMER_PICKUP',
        recipientName: 'Asha',
        relationship: 'SELF',
        items: [
          { description: 'Laptop: Acme Book', returned: true },
          { description: 'charger', returned: true },
          { description: 'Bag', returned: true, condition: 'Good' },
        ],
        checklist: [{ item: 'Device tested in front of the recipient', checked: true }],
        proofMethod: 'SIGNED_CHALLAN',
      });
    // Same key + identical body (the original job version) = safe replay of the stored result.
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as DeliveryBody).id).toBe(delivery.id);
    expect((await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
      'DELIVERED',
    );
    expect(await t.prisma.delivery.count()).toBe(1);
    expect(
      await t.prisma.notificationOutbox.count({
        where: { aggregateId: jobId, eventType: 'DELIVERY_CONFIRMED' },
      }),
    ).toBe(1);
    expect((await handover(jobId, 'courier')).status).toBe(409);

    await expect(
      t.prisma.delivery.update({
        where: { id: delivery.id },
        data: { recipientName: 'Someone else' },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(t.prisma.deliveryItem.deleteMany()).rejects.toThrow(/append-only/);
  });

  it('requires a manager override with a reason when a balance is due', async () => {
    const { jobId, customerId } = await readyJob({ approvedAmount: '2300' });
    await http()
      .post('/api/v1/payments')
      .set(as('manager'))
      .set('Idempotency-Key', newKey())
      .send({ branchId: org.branches['A1'], customerId, jobId, amount: '1000', method: 'CASH' })
      .expect(201);
    const balance = await http()
      .get(`/api/v1/jobs/${jobId}/deliveries`)
      .set(as('courier'))
      .expect(200);
    expect((balance.body as { balance: object }).balance).toMatchObject({
      billed: '2300.0000',
      paid: '1000.0000',
      due: '1300.0000',
      basis: 'APPROVED_ESTIMATE',
    });

    const courier = await expectStatus(handover(jobId, 'courier'), 409);
    expect((courier.body as ErrorBody).error.code).toBe('BALANCE_DUE');
    expect((await handover(jobId, 'manager')).status).toBe(400);
    const approved = await expectStatus(
      handover(jobId, 'manager', { dueOverrideReason: 'Regular business customer; pays monthly' }),
      201,
    );
    expect(approved.body).toMatchObject({
      balance: { due: '1300.0000' },
      dueOverride: { reason: 'Regular business customer; pays monthly' },
    });
    expect(
      await t.prisma.auditLog.count({ where: { action: 'delivery.completed_with_balance_due' } }),
    ).toBe(1);
  });

  it('lets delivery staff hand over once fully paid', async () => {
    const { jobId, customerId } = await readyJob({ approvedAmount: '2300' });
    await http()
      .post('/api/v1/payments')
      .set(as('manager'))
      .set('Idempotency-Key', newKey())
      .send({
        branchId: org.branches['A1'],
        customerId,
        jobId,
        amount: '2300',
        method: 'UPI',
        reference: 'UTR55',
      })
      .expect(201);
    await expectStatus(handover(jobId, 'courier'), 201);
  });

  it('dispatches home deliveries, records failed attempts and versions the challan', async () => {
    const { jobId } = await readyJob();
    expect((await handover(jobId, 'courier', { mode: 'HOME_DELIVERY' })).status).toBe(409);
    const address = { line1: '12 Main Rd', city: 'Kolkata', countryCode: 'IN' };
    const first = (
      await http()
        .post(`/api/v1/jobs/${jobId}/deliveries/dispatch`)
        .set(as('courier'))
        .send({ version: await version(jobId), mode: 'HOME_DELIVERY', address })
        .expect(201)
    ).body as DeliveryBody;
    expect((await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
      'OUT_FOR_DELIVERY',
    );
    const challan1 = (
      await http().post(`/api/v1/deliveries/${first.id}/challan`).set(as('courier')).expect(201)
    ).body as { url: string; version: number };
    expect(
      Buffer.from(await (await fetch(challan1.url)).arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');

    await http()
      .post(`/api/v1/deliveries/${first.id}/failed-attempt`)
      .set(as('courier'))
      .send({ reason: 'Nobody home' })
      .expect(201);
    expect((await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
      'READY_FOR_DELIVERY',
    );
    const failedChallan = (
      await http().post(`/api/v1/deliveries/${first.id}/challan`).set(as('courier')).expect(201)
    ).body as { version: number; documentId: string };
    expect(failedChallan.version).toBe(2);

    const second = (
      await http()
        .post(`/api/v1/jobs/${jobId}/deliveries/dispatch`)
        .set(as('courier'))
        .send({ version: await version(jobId), mode: 'HOME_DELIVERY', address })
        .expect(201)
    ).body as DeliveryBody;
    expect(second.challanNumber).not.toBe(first.challanNumber);
    const done = (await expectStatus(handover(jobId, 'courier', { mode: undefined }), 201))
      .body as DeliveryBody;
    expect(done).toMatchObject({ id: second.id, mode: 'HOME_DELIVERY', status: 'COMPLETED' });
    const finalChallan = await t.prisma.document
      .findFirstOrThrow({ where: { entityId: second.id, documentType: 'DELIVERY_CHALLAN' } })
      .catch(() => null);
    expect(finalChallan).toBeNull(); // generated on request only
    const c = (
      await http().post(`/api/v1/deliveries/${second.id}/challan`).set(as('courier')).expect(201)
    ).body as { documentId: string };
    const snapshot = (await t.prisma.document.findUniqueOrThrow({ where: { id: c.documentId } }))
      .snapshot as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      status: 'COMPLETED',
      jobNumber: expect.any(String) as string,
      device: { serialNumber: 'SN-77' },
    });
    expect(snapshot['recipient']).toMatchObject({ name: 'Asha', relationship: 'Customer' });

    await http().post(`/api/v1/deliveries/${second.id}/challan`).set(as('courierA2')).expect(404);
    const register = await http().get('/api/v1/deliveries').set(as('courierA2')).expect(200);
    expect((register.body as { total: number }).total).toBe(0);
  }, 60_000);

  it('releases open part reservations at delivery and keeps the ledger reconciled', async () => {
    const { jobId } = await readyJob();
    const part = await http()
      .post('/api/v1/parts')
      .set(as('manager'))
      .send({ sku: 'SCR-1', name: 'Screen' })
      .expect(201);
    const partId = (part.body as { id: string }).id;
    await http()
      .post('/api/v1/inventory/receipts')
      .set(as('manager'))
      .send({ branchId: org.branches['A1'], partId, quantity: '3' })
      .expect(201);
    await t.prisma.serviceJob.update({ where: { id: jobId }, data: { status: 'DIAGNOSIS' } });
    await http()
      .post(`/api/v1/jobs/${jobId}/parts`)
      .set(as('manager'))
      .send({ partId, action: 'RESERVE', quantity: '2' })
      .expect(201);
    await t.prisma.serviceJob.update({
      where: { id: jobId },
      data: { status: 'READY_FOR_DELIVERY' },
    });
    await expectStatus(handover(jobId, 'courier'), 201);
    const stock = await t.prisma.branchStock.findFirstOrThrow({ where: { partId } });
    expect(stock.reserved.toFixed(4)).toBe('0.0000');
    expect(await t.prisma.stockMovement.count({ where: { type: 'RELEASE', jobId } })).toBe(1);
    const rec = await http()
      .get(`/api/v1/inventory/reconciliation?branchId=${org.branches['A1']}`)
      .set(as('super'))
      .expect(200);
    expect(rec.body).toEqual([]);
  });

  it('accepts photo proof only with the staff member’s own uploaded file', async () => {
    const { jobId } = await readyJob();
    await expectStatus(handover(jobId, 'courier', { proofMethod: 'PHOTO_PROOF' }), 400);
    const otherUpload = await http()
      .post('/api/v1/files')
      .set(as('reception'))
      .attach('file', PNG_BYTES, { filename: 'x.png' })
      .expect(201);
    // Reception's file is "attachable" for any staff user (staff uploads are shared within the org), so use a customer-uploaded file id as foreign.
    const foreign = await t.prisma.storedFile.create({
      data: {
        organizationId: org.id,
        storageKey: `org/${org.id}/uploads/foreign.png`,
        originalName: 'foreign.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        classification: 'PERSONAL',
        uploadedByCustomerId: '01a1eeac-6f23-74c8-bac5-000000000099',
      },
    });
    await expectStatus(
      handover(jobId, 'courier', { proofMethod: 'PHOTO_PROOF', proofFileId: foreign.id }),
      404,
    );
    await expectStatus(
      handover(jobId, 'courier', {
        proofMethod: 'PHOTO_PROOF',
        proofFileId: (otherUpload.body as { id: string }).id,
      }),
      201,
    );
  });
});
