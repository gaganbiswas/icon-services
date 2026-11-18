import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockEmailAdapter, MockWhatsAppAdapter } from '../src/notifications/channel-adapter.js';
import { NotificationDispatcher } from '../src/notifications/notification-dispatcher.service.js';
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
interface JobBody {
  id: string;
  status: string;
  version: number;
  receivedAt: string | null;
  statusHistory: { fromStatus: string | null; toStatus: string; reason: string | null }[];
}
interface WorkspaceBody {
  assignments: { id: string; technician: { id: string }; endedAt: string | null }[];
  diagnoses: { internalNotes?: string | null }[];
  workLogs: { visibility: string; description: string }[];
  allowedTransitions: { to: string }[];
  canWork: boolean;
  canSeeInternalNotes: boolean;
}

const QC = ['Reported problem resolved', 'Device powers on and boots normally'];

describe('Job lifecycle, technician work and notifications (real PostgreSQL)', () => {
  let t: TestApp;
  let org: OrgFixture;
  let dispatcher: NotificationDispatcher;
  let whatsapp: MockWhatsAppAdapter;
  let email: MockEmailAdapter;
  const users: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    dispatcher = t.app.get(NotificationDispatcher);
    whatsapp = t.app.get(MockWhatsAppAdapter);
    email = t.app.get(MockEmailAdapter);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    whatsapp.sent.length = 0;
    email.sent.length = 0;
    whatsapp.failNext(0);
    org = await createOrg(t.prisma, 'ORGA', ['A1', 'A2']);
    const people: [string, string[], string[]][] = [
      ['reception', ['RECEPTION'], ['A1']],
      ['tech1', ['TECHNICIAN'], ['A1']],
      ['tech2', ['TECHNICIAN'], ['A1']],
      ['techA2', ['TECHNICIAN'], ['A2']],
      ['manager', ['BRANCH_ADMIN'], ['A1']],
    ];
    for (const [key, roles, branches] of people) {
      const user = await createUser(t.prisma, org, { email: `${key}@a.test`, roles, branches });
      users[key] = user.id;
      tokens[key] = (await login(t, user.email)).accessToken;
    }
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(tokens[who] ?? '');

  async function newJob(): Promise<JobBody> {
    const customer = await http()
      .post('/api/v1/customers')
      .set(as('reception'))
      .send({
        type: 'INDIVIDUAL',
        name: 'Asha Rao',
        phone: '+91 98123 45678',
        consents: [{ channel: 'WHATSAPP', purpose: 'SERVICE_UPDATES' }],
      })
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
    return job.body as JobBody;
  }

  async function assign(jobId: string, who: string) {
    return http()
      .post(`/api/v1/jobs/${jobId}/assignments`)
      .set(as('manager'))
      .send({ technicianUserId: users[who] });
  }

  async function move(jobId: string, who: string, to: string, extra: Record<string, unknown> = {}) {
    const current = await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } });
    return http()
      .post(`/api/v1/jobs/${jobId}/status-transitions`)
      .set(as(who))
      .send({ to, version: current.version, ...extra });
  }

  describe('status transitions', () => {
    it('runs the workflow with history and audit, and enforces approval, completion and delivery rules', async () => {
      const job = await newJob();
      expect((await assign(job.id, 'tech1')).status).toBe(201);
      expect((await move(job.id, 'tech1', 'DIAGNOSIS')).status).toBe(200);
      expect((await move(job.id, 'tech1', 'ESTIMATE_PREPARATION')).status).toBe(200);
      expect((await move(job.id, 'tech1', 'AWAITING_CUSTOMER_APPROVAL')).status).toBe(200);

      const blocked = await move(job.id, 'tech1', 'REPAIR_IN_PROGRESS');
      expect(blocked.status).toBe(409);
      expect((blocked.body as ErrorBody).error.code).toBe('ESTIMATE_APPROVAL_REQUIRED');

      // Simulate the Phase 5 approval step to continue the workflow.
      await t.prisma.serviceJob.update({
        where: { id: job.id },
        data: { status: 'REPAIR_IN_PROGRESS' },
      });
      expect((await move(job.id, 'tech1', 'QUALITY_CHECK')).status).toBe(200);
      const direct = await move(job.id, 'tech1', 'REPAIR_COMPLETED');
      expect((direct.body as ErrorBody).error.code).toBe('COMPLETION_REQUIRED');

      const version = (await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } }))
        .version;
      const failedQc = await http()
        .post(`/api/v1/jobs/${job.id}/completion`)
        .set(as('tech1'))
        .send({
          version,
          repairSummary: 'Replaced keyboard ribbon cable',
          qcChecklist: [
            { item: QC[0], passed: true },
            { item: QC[1], passed: false },
          ],
        })
        .expect(400);
      expect((failedQc.body as ErrorBody).error.code).toBe('COMPLETION_REQUIRED');
      const completed = await http()
        .post(`/api/v1/jobs/${job.id}/completion`)
        .set(as('tech1'))
        .send({
          version,
          repairSummary: 'Replaced keyboard ribbon cable',
          qcChecklist: QC.map((item) => ({ item, passed: true })),
          customerMessage: 'Your laptop is repaired.',
        })
        .expect(200);
      expect((completed.body as JobBody).status).toBe('REPAIR_COMPLETED');

      expect((await move(job.id, 'tech1', 'READY_FOR_DELIVERY')).status).toBe(200);
      const delivered = await move(job.id, 'manager', 'DELIVERED');
      expect((delivered.body as ErrorBody).error.code).toBe('USE_DELIVERY_WORKFLOW');

      const history = await t.prisma.jobStatusHistory.findMany({
        where: { jobId: job.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((h) => h.toStatus)).toEqual([
        'RECEIVED',
        'DIAGNOSIS',
        'ESTIMATE_PREPARATION',
        'AWAITING_CUSTOMER_APPROVAL',
        'QUALITY_CHECK',
        'REPAIR_COMPLETED',
        'READY_FOR_DELIVERY',
      ]);
      expect(
        history.every((h) => h.toStatus === 'RECEIVED' || h.actorUserId === users['tech1']),
      ).toBe(true);
      expect(
        await t.prisma.auditLog.count({
          where: { entityId: job.id, action: 'job.status_changed' },
        }),
      ).toBe(5);
    });

    it('rejects invalid jumps and stale versions', async () => {
      const job = await newJob();
      await assign(job.id, 'tech1');
      const jump = await move(job.id, 'tech1', 'READY_FOR_DELIVERY');
      expect((jump.body as ErrorBody).error.code).toBe('INVALID_TRANSITION');
      const stale = await http()
        .post(`/api/v1/jobs/${job.id}/status-transitions`)
        .set(as('tech1'))
        .send({ to: 'DIAGNOSIS', version: 99 })
        .expect(409);
      expect((stale.body as ErrorBody).error.code).toBe('VERSION_CONFLICT');
    });

    it('requires reasons for hold and cancel, resumes only to the previous status, and gates reopening', async () => {
      const job = await newJob();
      await assign(job.id, 'tech1');
      await move(job.id, 'tech1', 'DIAGNOSIS');
      expect(((await move(job.id, 'tech1', 'ON_HOLD')).body as ErrorBody).error.code).toBe(
        'REASON_REQUIRED',
      );
      expect(
        (await move(job.id, 'tech1', 'ON_HOLD', { reason: 'Customer travelling' })).status,
      ).toBe(200);
      expect(
        ((await move(job.id, 'tech1', 'ESTIMATE_PREPARATION')).body as ErrorBody).error.code,
      ).toBe('INVALID_TRANSITION');
      expect((await move(job.id, 'tech1', 'DIAGNOSIS')).status).toBe(200);

      expect(
        (await move(job.id, 'tech1', 'CANCELLED', { reason: 'Customer withdrew' })).status,
      ).toBe(200);
      expect((await move(job.id, 'tech1', 'RECEIVED', { reason: 'Changed mind' })).status).toBe(
        403,
      );
      const reopened = await move(job.id, 'manager', 'RECEIVED', {
        reason: 'Customer changed mind',
      });
      expect(reopened.status).toBe(200);
      expect(
        await t.prisma.auditLog.count({
          where: { entityId: job.id, action: 'job.reopened', reason: 'Customer changed mind' },
        }),
      ).toBe(1);
    });
  });

  describe('technician scope and assignments', () => {
    it('lets only assigned technicians (or managers) work on a job', async () => {
      const job = await newJob();
      await assign(job.id, 'tech1');
      const other = await move(job.id, 'tech2', 'DIAGNOSIS');
      expect(other.status).toBe(403);
      expect((other.body as ErrorBody).error.code).toBe('NOT_ASSIGNED');
      await http()
        .post(`/api/v1/jobs/${job.id}/diagnoses`)
        .set(as('tech2'))
        .send({ symptom: 'x', findings: 'y' })
        .expect(403);
      await http().get(`/api/v1/jobs/${job.id}`).set(as('techA2')).expect(404);
      expect((await move(job.id, 'manager', 'DIAGNOSIS')).status).toBe(200);

      const ws = await http().get(`/api/v1/jobs/${job.id}/workspace`).set(as('tech2')).expect(200);
      expect(ws.body).toMatchObject({ canWork: false, allowedTransitions: [] });

      const mine = await http().get('/api/v1/jobs?assignedToMe=true').set(as('tech1')).expect(200);
      expect((mine.body as { items: { id: string }[] }).items.map((j) => j.id)).toEqual([job.id]);
      const none = await http().get('/api/v1/jobs?assignedToMe=true').set(as('tech2')).expect(200);
      expect((none.body as { total: number }).total).toBe(0);

      const assignment = (ws.body as WorkspaceBody).assignments[0];
      await http()
        .delete(`/api/v1/jobs/${job.id}/assignments/${assignment?.id}?reason=Reassigned`)
        .set(as('manager'))
        .expect(200);
      expect((await move(job.id, 'tech1', 'ESTIMATE_PREPARATION')).status).toBe(403);
    });

    it('only assigns active staff who can do technical work in the job branch', async () => {
      const job = await newJob();
      const eligible = await http()
        .get(`/api/v1/jobs/${job.id}/assignable-technicians`)
        .set(as('manager'))
        .expect(200);
      const names = (eligible.body as { id: string }[]).map((u) => u.id);
      expect(names).toEqual(
        expect.arrayContaining([users['tech1'], users['tech2'], users['manager']]),
      );
      expect(names).not.toContain(users['reception']);
      expect(names).not.toContain(users['techA2']);
      expect((await assign(job.id, 'reception')).status).toBe(409);
      expect((await assign(job.id, 'techA2')).status).toBe(409);
      expect((await assign(job.id, 'tech1')).status).toBe(201);
      expect((await assign(job.id, 'tech1')).status).toBe(409);
      await http()
        .post(`/api/v1/jobs/${job.id}/assignments`)
        .set(as('tech1'))
        .send({ technicianUserId: users['tech2'] })
        .expect(403);
    });
  });

  describe('notes visibility', () => {
    it('keeps internal notes away from reception and customers', async () => {
      const job = await newJob();
      await assign(job.id, 'tech1');
      await http()
        .post(`/api/v1/jobs/${job.id}/diagnoses`)
        .set(as('tech1'))
        .send({
          symptom: 'Keys dead',
          findings: 'Ribbon cable torn',
          internalNotes: 'SECRET-INTERNAL-NOTE',
        })
        .expect(201);
      await http()
        .post(`/api/v1/jobs/${job.id}/work-logs`)
        .set(as('tech1'))
        .send({ description: 'SECRET-INTERNAL-LOG', visibility: 'INTERNAL', durationMinutes: 30 })
        .expect(201);
      await http()
        .post(`/api/v1/jobs/${job.id}/work-logs`)
        .set(as('tech1'))
        .send({ description: 'Replacement part ordered', visibility: 'CUSTOMER' })
        .expect(201);

      const techView = (
        await http().get(`/api/v1/jobs/${job.id}/workspace`).set(as('tech1')).expect(200)
      ).body as WorkspaceBody;
      expect(techView.canSeeInternalNotes).toBe(true);
      expect(techView.diagnoses[0]?.internalNotes).toBe('SECRET-INTERNAL-NOTE');
      expect(techView.workLogs).toHaveLength(2);

      const receptionView = await http()
        .get(`/api/v1/jobs/${job.id}/workspace`)
        .set(as('reception'))
        .expect(200);
      expect(JSON.stringify(receptionView.body)).not.toContain('SECRET-INTERNAL');
      expect((receptionView.body as WorkspaceBody).workLogs.map((w) => w.visibility)).toEqual([
        'CUSTOMER',
      ]);

      // Customer API: only the customer-visible update.
      const code = await (async () => {
        const otp = t.app.get(
          (await import('../src/customer-auth/otp-provider.js')).MockOtpProvider,
        );
        await http()
          .post('/api/v1/customer/auth/otp/request')
          .send({ organizationCode: 'ORGA', phone: '+91 98123 45678' })
          .expect(200);
        return otp.sent.get('+919812345678') ?? '';
      })();
      const tokensBody = await http()
        .post('/api/v1/customer/auth/otp/verify')
        .send({ organizationCode: 'ORGA', phone: '+91 98123 45678', code })
        .expect(200);
      const customerJob = await http()
        .get(`/api/v1/customer/jobs/${job.id}`)
        .set(bearer((tokensBody.body as { accessToken: string }).accessToken))
        .expect(200);
      expect(JSON.stringify(customerJob.body)).not.toContain('SECRET-INTERNAL');
      expect(
        (customerJob.body as { updates: { message: string }[] }).updates.map((u) => u.message),
      ).toEqual(['Replacement part ordered']);
    });

    it('keeps diagnoses and work logs append-only', async () => {
      const job = await newJob();
      await assign(job.id, 'tech1');
      await http()
        .post(`/api/v1/jobs/${job.id}/work-logs`)
        .set(as('tech1'))
        .send({ description: 'x', visibility: 'INTERNAL' })
        .expect(201);
      await expect(
        t.prisma.workLog.updateMany({ data: { description: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(t.prisma.workLog.deleteMany()).rejects.toThrow(/append-only/);
    });
  });

  describe('receiving devices for app requests', () => {
    it('requires the receive action and records intake details', async () => {
      const job = await newJob();
      await t.prisma.serviceJob.update({
        where: { id: job.id },
        data: { status: 'AWAITING_DEVICE', receivedAt: null },
      });
      const generic = await move(job.id, 'manager', 'RECEIVED');
      expect((generic.body as ErrorBody).error.code).toBe('USE_RECEIVE_ACTION');
      const version = (await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } }))
        .version;
      const received = await http()
        .post(`/api/v1/jobs/${job.id}/receive`)
        .set(as('reception'))
        .send({
          version,
          acknowledgementMethod: 'SIGNED_PAPER',
          accessoriesReceived: ['Charger'],
          intakeChecklist: [{ item: 'Device powers on', checked: true }],
        })
        .expect(200);
      expect(received.body).toMatchObject({ status: 'RECEIVED', accessoriesReceived: ['Charger'] });
      expect((received.body as JobBody).receivedAt).not.toBeNull();
      expect(
        await t.prisma.notificationOutbox.count({
          where: { aggregateId: job.id, eventType: 'JOB_RECEIVED' },
        }),
      ).toBe(2);
    });
  });

  describe('notifications', () => {
    it('queues customer-relevant events and sends only to consented channels, never claiming delivery', async () => {
      const job = await newJob();
      await assign(job.id, 'tech1');
      await move(job.id, 'tech1', 'DIAGNOSIS');
      const events = await t.prisma.notificationOutbox.findMany({
        where: { aggregateId: job.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.eventType)).toEqual(['JOB_RECEIVED', 'JOB_STATUS_CHANGED']);

      expect(await dispatcher.dispatchDue()).toBe(2);
      expect(whatsapp.sent).toHaveLength(2);
      expect(whatsapp.sent.map((m) => m.template).sort()).toEqual([
        'job_received_v1',
        'job_status_changed_v1',
      ]);
      expect(whatsapp.sent.every((m) => m.to === '+919812345678')).toBe(true);
      expect(email.sent).toHaveLength(0);
      const deliveries = await t.prisma.notificationDelivery.findMany();
      expect(
        deliveries.filter((d) => d.channel === 'WHATSAPP').every((d) => d.status === 'ACCEPTED'),
      ).toBe(true);
      expect(
        deliveries
          .filter((d) => d.channel === 'EMAIL')
          .every((d) => d.status === 'SKIPPED_NO_CONSENT'),
      ).toBe(true);
      expect(deliveries.some((d) => d.status === 'DELIVERED')).toBe(false);
      expect(
        (await t.prisma.notificationOutbox.findMany()).every((o) => o.status === 'COMPLETED'),
      ).toBe(true);
    });

    it('retries failures with backoff without re-sending accepted channels, then goes dead; staff can retry', async () => {
      await newJob();
      whatsapp.failNext(1);
      await dispatcher.dispatchDue();
      let row = await t.prisma.notificationOutbox.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      await t.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { nextAttemptAt: new Date(Date.now() - 60_000) },
      });
      await dispatcher.dispatchDue();
      row = await t.prisma.notificationOutbox.findFirstOrThrow();
      expect(row.status).toBe('COMPLETED');
      expect(whatsapp.sent).toHaveLength(1);
      await t.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: 'FAILED', nextAttemptAt: new Date(Date.now() - 60_000) },
      });
      await dispatcher.dispatchDue();
      expect(whatsapp.sent).toHaveLength(1); // already accepted → not sent twice

      whatsapp.failNext(10);
      await t.prisma.notificationDelivery.deleteMany();
      await t.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(Date.now() - 60_000) },
      });
      for (let i = 0; i < 5; i += 1) {
        await dispatcher.dispatchDue();
        await t.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { nextAttemptAt: new Date(Date.now() - 60_000) },
        });
      }
      expect((await t.prisma.notificationOutbox.findFirstOrThrow()).status).toBe('DEAD');

      await http().post(`/api/v1/notifications/${row.id}/retry`).set(as('reception')).expect(403);
      await http().post(`/api/v1/notifications/${row.id}/retry`).set(as('manager')).expect(201);
      const list = await http().get('/api/v1/notifications').set(as('reception')).expect(200);
      expect((list.body as { items: { status: string }[] }).items[0]?.status).toBe('PENDING');
      whatsapp.failNext(0);
    });

    it('respects consent withdrawn after the event was queued', async () => {
      const job = await newJob();
      const customer = await t.prisma.serviceJob.findUniqueOrThrow({
        where: { id: job.id },
        select: { customerId: true },
      });
      await http()
        .put(`/api/v1/customers/${customer.customerId}/consents`)
        .set(as('reception'))
        .send({ channel: 'WHATSAPP', purpose: 'SERVICE_UPDATES', granted: false })
        .expect(200);
      await dispatcher.dispatchDue();
      expect(whatsapp.sent).toHaveLength(0);
      expect((await t.prisma.notificationOutbox.findFirstOrThrow()).status).toBe('SKIPPED');
    });

    it('never double-sends when several workers dispatch concurrently', async () => {
      for (let i = 0; i < 4; i += 1) await newJob();
      const queued = await t.prisma.notificationOutbox.count();
      await Promise.all([
        dispatcher.dispatchDue(),
        dispatcher.dispatchDue(),
        dispatcher.dispatchDue(),
      ]);
      expect(whatsapp.sent).toHaveLength(queued);
    });
  });
});
