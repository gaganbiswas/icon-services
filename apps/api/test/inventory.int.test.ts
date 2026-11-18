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
interface Level {
  onHand: string;
  reserved: string;
  available: string;
  belowReorder: boolean;
  part: { id: string; sku: string };
}
interface JobPartBody {
  part: { id: string };
  reserved: string;
  consumed: string;
  returned: string;
  disposition: string | null;
}

describe('Inventory and job parts (real PostgreSQL)', () => {
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
      ['super', ['SUPER_ADMIN'], []],
      ['manager', ['BRANCH_ADMIN'], ['A1']],
      ['reception', ['RECEPTION'], ['A1']],
      ['tech1', ['TECHNICIAN'], ['A1']],
      ['tech2', ['TECHNICIAN'], ['A1']],
    ];
    for (const [key, roles, branches] of people) {
      const user = await createUser(t.prisma, org, { email: `${key}@a.test`, roles, branches });
      users[key] = user.id;
      tokens[key] = (await login(t, user.email)).accessToken;
    }
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(tokens[who] ?? '');
  const A1 = () => org.branches['A1'] ?? '';
  const A2 = () => org.branches['A2'] ?? '';

  async function part(
    sku = 'kb-x1',
    reorderLevel = '2',
    sellingPrice = '1500.00',
  ): Promise<string> {
    const response = await http()
      .post('/api/v1/parts')
      .set(as('manager'))
      .send({ sku, name: 'Keyboard X1', reorderLevel, sellingPrice })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function receive(partId: string, quantity: string, branchId = A1()) {
    return http()
      .post('/api/v1/inventory/receipts')
      .set(as('manager'))
      .send({ branchId, partId, quantity, unitCost: '900.00' })
      .expect(201);
  }

  async function level(partId: string, branchId = A1()): Promise<Level> {
    const response = await http()
      .get(`/api/v1/inventory/stock?branchId=${branchId}`)
      .set(as('super'))
      .expect(200);
    const found = (response.body as Level[]).find((l) => l.part.id === partId);
    if (!found) throw new Error('level not found');
    return found;
  }

  async function jobFor(technician = 'tech1'): Promise<string> {
    const customer = await http()
      .post('/api/v1/customers')
      .set(as('reception'))
      .send({ type: 'INDIVIDUAL', name: 'C', phone: '+919812345678' })
      .expect(201);
    const customerId = (customer.body as { id: string }).id;
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
        branchId: A1(),
        customerId,
        assetId: (asset.body as { asset: { id: string } }).asset.id,
        serviceType: 'OUT_OF_WARRANTY',
        serviceMode: 'AT_SERVICE_CENTRE',
        complaint: 'Keyboard broken',
      })
      .expect(201);
    const jobId = (job.body as { id: string }).id;
    await http()
      .post(`/api/v1/jobs/${jobId}/assignments`)
      .set(as('manager'))
      .send({ technicianUserId: users[technician] })
      .expect(201);
    await t.prisma.serviceJob.update({ where: { id: jobId }, data: { status: 'DIAGNOSIS' } });
    return jobId;
  }

  const partAction = (jobId: string, who: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/jobs/${jobId}/parts`).set(as(who)).send(body);

  async function assertReconciled(branchId = A1()) {
    const response = await http()
      .get(`/api/v1/inventory/reconciliation?branchId=${branchId}`)
      .set(as('super'))
      .expect(200);
    expect(response.body).toEqual([]);
  }

  describe('catalogue', () => {
    it('creates parts with normalized SKUs, rejects duplicates and enforces permissions', async () => {
      const id = await part();
      const list = await http().get('/api/v1/parts?q=kb').set(as('tech1')).expect(200);
      expect((list.body as { id: string; sku: string }[]).map((p) => [p.id, p.sku])).toEqual([
        [id, 'KB-X1'],
      ]);
      expect(
        (await http().post('/api/v1/parts').set(as('manager')).send({ sku: 'KB-X1', name: 'Dup' }))
          .status,
      ).toBe(409);
      expect(
        (await http().post('/api/v1/parts').set(as('reception')).send({ sku: 'X', name: 'X' }))
          .status,
      ).toBe(403);
      expect(
        (
          await http()
            .post('/api/v1/inventory/receipts')
            .set(as('tech1'))
            .send({ branchId: A1(), partId: id, quantity: '1' })
        ).status,
      ).toBe(403);
    });

    it('never changes estimate prices when the catalogue price changes', async () => {
      await http()
        .put('/api/v1/settings/money')
        .set(as('super'))
        .send({ value: { currency: 'XXX' }, reason: 'test' })
        .expect(200);
      const partId = await part();
      const jobId = await jobFor();
      await t.prisma.serviceJob.update({
        where: { id: jobId },
        data: { status: 'ESTIMATE_PREPARATION' },
      });
      const catalogue = (await http().get('/api/v1/parts?q=KB').set(as('tech1')).expect(200))
        .body as { sku: string; name: string; sellingPrice: string }[];
      const picked = catalogue[0];
      const estimate = await http()
        .post(`/api/v1/jobs/${jobId}/estimates`)
        .set(as('tech1'))
        .send({
          lines: [
            {
              lineType: 'PART',
              sku: picked?.sku,
              description: picked?.name,
              quantity: '1',
              unitPrice: picked?.sellingPrice,
            },
          ],
        })
        .expect(201);
      const { version } = await t.prisma.part.findUniqueOrThrow({ where: { id: partId } });
      await http()
        .patch(`/api/v1/parts/${partId}`)
        .set(as('manager'))
        .send({ version, sellingPrice: '9999.00' })
        .expect(200);
      const reread = await http()
        .get(`/api/v1/estimates/${(estimate.body as { id: string }).id}`)
        .set(as('tech1'))
        .expect(200);
      expect(
        (reread.body as { lines: { unitPrice: string; sku: string }[] }).lines[0],
      ).toMatchObject({ unitPrice: '1500.0000', sku: 'KB-X1' });
    });
  });

  describe('stock ledger', () => {
    it('receives stock and reports low stock including reservations', async () => {
      const partId = await part();
      await receive(partId, '5');
      expect(await level(partId)).toMatchObject({
        onHand: '5.0000',
        reserved: '0.0000',
        available: '5.0000',
        belowReorder: false,
      });
      const jobId = await jobFor();
      expect(
        (await partAction(jobId, 'tech1', { partId, action: 'RESERVE', quantity: '4' })).status,
      ).toBe(201);
      expect(await level(partId)).toMatchObject({
        onHand: '5.0000',
        reserved: '4.0000',
        available: '1.0000',
        belowReorder: true,
      });
      const low = await http()
        .get(`/api/v1/inventory/stock?branchId=${A1()}&belowReorder=true`)
        .set(as('tech1'))
        .expect(200);
      expect((low.body as Level[]).map((l) => l.part.id)).toEqual([partId]);
      await assertReconciled();
    });

    it('refuses negative stock unless an authorized override with a reason is given', async () => {
      const partId = await part();
      await receive(partId, '5');
      const decrease = {
        branchId: A1(),
        partId,
        direction: 'DECREASE',
        quantity: '10',
        reason: 'Stock count',
      };
      const refused = await http()
        .post('/api/v1/inventory/adjustments')
        .set(as('manager'))
        .send(decrease)
        .expect(409);
      expect((refused.body as ErrorBody).error.code).toBe('INSUFFICIENT_STOCK');
      await http()
        .post('/api/v1/inventory/adjustments')
        .set(as('manager'))
        .send({ ...decrease, allowNegative: true })
        .expect(403);
      await http()
        .post('/api/v1/inventory/adjustments')
        .set(as('super'))
        .send({ ...decrease, allowNegative: true })
        .expect(201);
      expect((await level(partId)).onHand).toBe('-5.0000');
      const movement = await t.prisma.stockMovement.findFirstOrThrow({ where: { type: 'ADJUST' } });
      expect(movement).toMatchObject({ negativeOverride: true, reason: 'Stock count' });
      expect(
        await t.prisma.auditLog.count({ where: { action: 'stock.adjusted_with_override' } }),
      ).toBe(1);
      await assertReconciled();
    });

    it('never oversells under concurrent reservations', async () => {
      const partId = await part();
      await receive(partId, '5');
      const jobId = await jobFor();
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          partAction(jobId, 'tech1', { partId, action: 'RESERVE', quantity: '1' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        201, 201, 201, 201, 201, 409, 409, 409, 409, 409,
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      expect(await level(partId)).toMatchObject({ reserved: '5.0000', available: '0.0000' });
      const jobParts = (
        await http().get(`/api/v1/jobs/${jobId}/parts`).set(as('tech1')).expect(200)
      ).body as JobPartBody[];
      expect(jobParts[0]?.reserved).toBe('5.0000');
      await assertReconciled();
    });

    it('transfers between branches with paired movements and branch checks', async () => {
      const partId = await part();
      await receive(partId, '3');
      await http()
        .post('/api/v1/inventory/transfers')
        .set(as('manager'))
        .send({ fromBranchId: A1(), toBranchId: A2(), partId, quantity: '1' })
        .expect(404);
      const tooMany = await http()
        .post('/api/v1/inventory/transfers')
        .set(as('super'))
        .send({ fromBranchId: A1(), toBranchId: A2(), partId, quantity: '4' })
        .expect(409);
      expect((tooMany.body as ErrorBody).error.code).toBe('INSUFFICIENT_STOCK');
      await http()
        .post('/api/v1/inventory/transfers')
        .set(as('super'))
        .send({ fromBranchId: A1(), toBranchId: A2(), partId, quantity: '2' })
        .expect(201);
      expect((await level(partId, A1())).onHand).toBe('1.0000');
      expect((await level(partId, A2())).onHand).toBe('2.0000');
      const moves = await t.prisma.stockMovement.findMany({
        where: { type: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } },
      });
      expect(moves).toHaveLength(2);
      expect(moves[0]?.transferId).toBe(moves[1]?.transferId);
      await assertReconciled(A1());
      await assertReconciled(A2());
    });

    it('keeps the ledger append-only', async () => {
      const partId = await part();
      await receive(partId, '1');
      await expect(
        t.prisma.stockMovement.updateMany({ data: { reason: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(t.prisma.stockMovement.deleteMany()).rejects.toThrow(/append-only/);
    });
  });

  describe('job parts', () => {
    it('reserves, consumes (reservation first), returns and releases in step with stock', async () => {
      const partId = await part();
      await receive(partId, '5');
      const jobId = await jobFor();
      expect(
        (await partAction(jobId, 'tech1', { partId, action: 'RESERVE', quantity: '2' })).status,
      ).toBe(201);
      const early = await partAction(jobId, 'tech1', { partId, action: 'CONSUME', quantity: '1' });
      expect(early.status).toBe(409);

      await t.prisma.serviceJob.update({
        where: { id: jobId },
        data: { status: 'REPAIR_IN_PROGRESS' },
      });
      const consumed = await partAction(jobId, 'tech1', {
        partId,
        action: 'CONSUME',
        quantity: '3',
      });
      expect(consumed.status).toBe(201);
      expect((consumed.body as JobPartBody[])[0]).toMatchObject({
        reserved: '0.0000',
        consumed: '3.0000',
      });
      expect(await level(partId)).toMatchObject({ onHand: '2.0000', reserved: '0.0000' });

      expect(
        (await partAction(jobId, 'tech1', { partId, action: 'RETURN', quantity: '1' })).status,
      ).toBe(201);
      expect(
        (await partAction(jobId, 'tech1', { partId, action: 'RETURN', quantity: '3' })).status,
      ).toBe(409);
      expect(
        (await partAction(jobId, 'tech1', { partId, action: 'RELEASE', quantity: '1' })).status,
      ).toBe(409);
      expect((await level(partId)).onHand).toBe('3.0000');

      const removed = await http()
        .put(`/api/v1/jobs/${jobId}/parts/removed`)
        .set(as('tech1'))
        .send({
          partId,
          removedPartDescription: 'Original keyboard, liquid damaged',
          removedPartSerial: 'OLD-1',
          disposition: 'RETURNED_TO_CUSTOMER',
        })
        .expect(200);
      expect((removed.body as JobPartBody[])[0]).toMatchObject({
        disposition: 'RETURNED_TO_CUSTOMER',
        returned: '1.0000',
      });

      const ledger = await http()
        .get(`/api/v1/inventory/movements?jobId=${jobId}`)
        .set(as('tech1'))
        .expect(200);
      expect(
        (ledger.body as { items: { type: string }[] }).items.map((m) => m.type).sort(),
      ).toEqual(['CONSUME', 'RESERVE', 'RETURN']);
      await assertReconciled();
    });

    it('limits job parts to assigned technicians and blocks over-consumption', async () => {
      const partId = await part();
      await receive(partId, '1');
      const jobId = await jobFor();
      const other = await partAction(jobId, 'tech2', { partId, action: 'RESERVE', quantity: '1' });
      expect((other.body as ErrorBody).error.code).toBe('NOT_ASSIGNED');
      await t.prisma.serviceJob.update({
        where: { id: jobId },
        data: { status: 'REPAIR_IN_PROGRESS' },
      });
      const over = await partAction(jobId, 'tech1', { partId, action: 'CONSUME', quantity: '2' });
      expect((over.body as ErrorBody).error.code).toBe('INSUFFICIENT_STOCK');
      const overrideByTech = await partAction(jobId, 'tech1', {
        partId,
        action: 'CONSUME',
        quantity: '2',
        allowNegative: true,
        reason: 'Booked late',
      });
      expect(overrideByTech.status).toBe(403);
      expect((await level(partId)).onHand).toBe('1.0000');
      await assertReconciled();
    });
  });
});
