import { createHmac, randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

const APP_SECRET = 'app-secret-for-tests-0123456789';
const VERIFY_TOKEN = 'verify-token-for-tests-0123';
const PHONE = '+919812345678';
const MAILPIT = process.env['MAILPIT_API_URL'] ?? 'http://127.0.0.1:8025';

interface Captured {
  url: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

/** Stand-in for the Graph API: records requests, replies from a queue (default: accepted). */
class FakeGraph {
  readonly requests: Captured[] = [];
  readonly replies: { status: number; body: unknown }[] = [];
  private server: Server | null = null;
  private counter = 0;

  async start(): Promise<string> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        this.requests.push({
          url: req.url ?? '',
          auth: req.headers.authorization,
          body: JSON.parse(raw || '{}') as Record<string, unknown>,
        });
        const reply = this.replies.shift() ?? {
          status: 200,
          body: { messages: [{ id: `wamid.${++this.counter}` }] },
        };
        res
          .writeHead(reply.status, { 'content-type': 'application/json' })
          .end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`;
  }

  reset(): void {
    this.requests.length = 0;
    this.replies.length = 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
}

describe('Real notification providers: Meta WhatsApp, SMTP, webhooks, WhatsApp OTP', () => {
  const graph = new FakeGraph();
  let t: TestApp;
  let org: OrgFixture;
  let dispatcher: NotificationDispatcher;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const base = await graph.start();
    t = await createTestApp({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_API_BASE_URL: base,
      WHATSAPP_GRAPH_API_VERSION: 'v23.0',
      WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      WHATSAPP_ACCESS_TOKEN: 'EAAG-test-token-0123456789',
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_ORGANIZATION_CODE: 'ORGA',
      OTP_PROVIDER: 'whatsapp',
      WHATSAPP_OTP_TEMPLATE_NAME: 'sign_in_code',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: process.env['SMTP_HOST_PORT'] ?? '1025',
      EMAIL_FROM: 'ICON Test <no-reply@example.test>',
    });
    dispatcher = t.app.get(NotificationDispatcher);
  });

  afterAll(async () => {
    await t.close();
    await graph.stop();
  });

  beforeEach(async () => {
    graph.reset();
    await resetDatabase(t.prisma);
    org = await createOrg(t.prisma, 'ORGA', ['A1']);
    for (const [key, roles] of [
      ['reception', ['RECEPTION']],
      ['super', ['SUPER_ADMIN']],
    ] as const) {
      const user = await createUser(t.prisma, org, {
        email: `${key}@a.test`,
        roles: [...roles],
        branches: key === 'super' ? [] : ['A1'],
      });
      tokens[key] = (await login(t, user.email)).accessToken;
    }
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(tokens[who] ?? '');

  async function configureTemplates(
    whatsapp: Record<string, { name: string; language: string } | null>,
    quietHours: { start: string; end: string } | null = null,
  ) {
    const current = (await http().get('/api/v1/settings').set(as('super')).expect(200)).body as {
      notifications: {
        templates: Record<string, { whatsapp: unknown; emailSubject: string | null }>;
      };
    };
    const templates = Object.fromEntries(
      Object.entries(current.notifications.templates).map(([event, value]) => [
        event,
        { ...value, whatsapp: whatsapp[event] ?? null },
      ]),
    );
    await http()
      .put('/api/v1/settings/notifications')
      .set(as('super'))
      .send({ value: { templates, quietHours }, reason: 'Approved templates' })
      .expect(200);
  }

  async function receivedJob(
    email: string,
  ): Promise<{ jobId: string; customerId: string; outboxId: string }> {
    const customer = await http()
      .post('/api/v1/customers')
      .set(as('reception'))
      .send({
        type: 'INDIVIDUAL',
        name: 'Asha Rao',
        phone: PHONE,
        email,
        consents: [
          { channel: 'WHATSAPP', purpose: 'SERVICE_UPDATES' },
          { channel: 'EMAIL', purpose: 'SERVICE_UPDATES' },
        ],
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
        complaint: 'Does not boot',
      })
      .expect(201);
    const jobId = (job.body as { id: string }).id;
    const outbox = await t.prisma.notificationOutbox.findFirstOrThrow({
      where: { aggregateId: jobId, eventType: 'JOB_RECEIVED' },
    });
    // Due in the past so clock skew between test host and database never delays it.
    await t.prisma.notificationOutbox.update({
      where: { id: outbox.id },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });
    return { jobId, customerId, outboxId: outbox.id };
  }

  async function mailTo(address: string): Promise<{ Subject: string }[]> {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
    );
    return ((await response.json()) as { messages: { Subject: string }[] }).messages;
  }

  it('sends approved WhatsApp templates and SMTP email; unconfigured events are skipped, never free-form', async () => {
    const email = `asha-${randomUUID().slice(0, 8)}@example.test`;
    const { outboxId } = await receivedJob(email);
    // No approved WhatsApp template yet: WhatsApp skipped, email still goes out.
    expect(await dispatcher.dispatchDue()).toBe(1);
    let deliveries = await t.prisma.notificationDelivery.findMany({ where: { outboxId } });
    expect(deliveries.map((d) => `${d.channel}:${d.status}`).sort()).toEqual([
      'EMAIL:ACCEPTED',
      'WHATSAPP:SKIPPED_NOT_CONFIGURED',
    ]);
    expect(graph.requests).toHaveLength(0);
    const mail = await mailTo(email);
    expect(mail.map((m) => m.Subject)).toEqual(['We have received your service request']);

    await configureTemplates({ JOB_RECEIVED: { name: 'job_received_v1', language: 'en' } });
    const second = await receivedJob(`second-${randomUUID().slice(0, 8)}@example.test`);
    await dispatcher.dispatchDue();
    expect(graph.requests).toHaveLength(1);
    const sent = graph.requests[0];
    expect(sent?.url).toBe('/v23.0/123456789012345/messages');
    expect(sent?.auth).toBe('Bearer EAAG-test-token-0123456789');
    expect(sent?.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919812345678',
      type: 'template',
      template: {
        name: 'job_received_v1',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text' }, { type: 'text' }] }],
      },
    });
    deliveries = await t.prisma.notificationDelivery.findMany({
      where: { outboxId: second.outboxId, channel: 'WHATSAPP' },
    });
    expect(deliveries).toMatchObject([
      {
        status: 'ACCEPTED',
        provider: 'meta',
        providerMessageId: 'wamid.1',
        templateName: 'job_received_v1',
      },
    ]);
    expect(deliveries[0]?.deliveredAt).toBeNull();
  });

  it('dead-letters permanent provider errors at once, retries temporary ones, and recovers on manual retry', async () => {
    await configureTemplates({ JOB_RECEIVED: { name: 'job_received_v1', language: 'en' } });
    const { outboxId } = await receivedJob(`p-${randomUUID().slice(0, 8)}@example.test`);
    graph.replies.push({ status: 400, body: { error: { code: 132001 } } });
    await dispatcher.dispatchDue();
    expect(
      await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } }),
    ).toMatchObject({ status: 'DEAD', attempts: 1 });
    expect(
      await t.prisma.notificationDelivery.findFirst({ where: { outboxId, channel: 'WHATSAPP' } }),
    ).toMatchObject({ status: 'FAILED', errorCode: 'META_132001' });

    await http().post(`/api/v1/notifications/${outboxId}/retry`).set(as('super')).expect(201);
    graph.replies.push({ status: 503, body: {} });
    await dispatcher.dispatchDue();
    const failed = await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } });
    expect(failed.status).toBe('FAILED');
    await t.prisma.notificationOutbox.update({
      where: { id: outboxId },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });
    await dispatcher.dispatchDue();
    expect(
      (await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } })).status,
    ).toBe('COMPLETED');
    // Email was accepted on the first attempt and never re-sent.
    expect(
      await t.prisma.notificationDelivery.count({
        where: { outboxId, channel: 'EMAIL', status: 'ACCEPTED' },
      }),
    ).toBe(1);
    expect(
      await t.prisma.notificationDelivery.count({ where: { outboxId, channel: 'WHATSAPP' } }),
    ).toBe(3);
  });

  it('defers sending during quiet hours without spending an attempt', async () => {
    const now = new Date();
    const hh = (h: number) => String((h + 24) % 24).padStart(2, '0');
    await configureTemplates(
      {},
      { start: `${hh(now.getUTCHours() - 1)}:00`, end: `${hh(now.getUTCHours() + 2)}:00` },
    );
    const { outboxId } = await receivedJob(`q-${randomUUID().slice(0, 8)}@example.test`);
    await dispatcher.dispatchDue();
    const row = await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } });
    expect(row).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastError: 'Deferred: quiet hours',
    });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect(await t.prisma.notificationDelivery.count({ where: { outboxId } })).toBe(0);
  });

  describe('webhook', () => {
    async function acceptedDelivery(): Promise<{ outboxId: string; id: string }> {
      await configureTemplates({ JOB_RECEIVED: { name: 'job_received_v1', language: 'en' } });
      const { outboxId } = await receivedJob(`w-${randomUUID().slice(0, 8)}@example.test`);
      await dispatcher.dispatchDue();
      const d = await t.prisma.notificationDelivery.findFirstOrThrow({
        where: { outboxId, channel: 'WHATSAPP' },
      });
      return { outboxId, id: d.providerMessageId ?? '' };
    }

    function post(payload: unknown, signature?: string) {
      const raw = JSON.stringify(payload);
      const r = http().post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json');
      return (
        signature === undefined
          ? r.set('X-Hub-Signature-256', sign(raw))
          : r.set('X-Hub-Signature-256', signature)
      ).send(raw);
    }

    const statuses = (list: unknown[]) => ({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { statuses: list } }] }],
    });

    it('verifies the subscription handshake', async () => {
      const ok = await http()
        .get('/api/v1/webhooks/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1158201444',
        })
        .expect(200);
      expect(ok.text).toBe('1158201444');
      await http()
        .get('/api/v1/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })
        .expect(403);
    });

    it('rejects unsigned or tampered callbacks', async () => {
      const { id } = await acceptedDelivery();
      const payload = statuses([{ id, status: 'delivered', timestamp: '1763500000' }]);
      await post(payload, '').expect(401);
      await post(payload, sign('{"other":true}')).expect(401);
      await http().post('/api/v1/webhooks/whatsapp').send(payload).expect(401);
      expect(
        (await t.prisma.notificationDelivery.findFirstOrThrow({ where: { providerMessageId: id } }))
          .status,
      ).toBe('ACCEPTED');
    });

    it('moves deliveries forward only on signed status callbacks', async () => {
      const { id } = await acceptedDelivery();
      await post(statuses([{ id, status: 'sent', timestamp: '1763500000' }])).expect(200);
      expect(
        (await t.prisma.notificationDelivery.findFirstOrThrow({ where: { providerMessageId: id } }))
          .status,
      ).toBe('ACCEPTED');
      await post(statuses([{ id, status: 'read', timestamp: '1763500100' }])).expect(200);
      await post(
        statuses([
          { id, status: 'delivered', timestamp: '1763500050' },
          { id, status: 'failed', errors: [{ code: 131026 }] },
        ]),
      ).expect(200);
      const d = await t.prisma.notificationDelivery.findFirstOrThrow({
        where: { providerMessageId: id },
      });
      expect(d.status).toBe('READ');
      expect(d.readAt?.toISOString()).toBe(new Date(1763500100 * 1000).toISOString());
      expect(d.deliveredAt).not.toBeNull();
      // Unknown message IDs are ignored.
      await post(statuses([{ id: 'wamid.unknown', status: 'delivered' }])).expect(200);
    });

    it('marks provider-reported failures and surfaces them for manual retry', async () => {
      const { id, outboxId } = await acceptedDelivery();
      await post(
        statuses([{ id, status: 'failed', timestamp: '1763500000', errors: [{ code: 131026 }] }]),
      ).expect(200);
      expect(
        await t.prisma.notificationDelivery.findFirstOrThrow({ where: { providerMessageId: id } }),
      ).toMatchObject({ status: 'FAILED', errorCode: 'META_131026' });
      expect(
        await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } }),
      ).toMatchObject({ status: 'DEAD' });
      await http().post(`/api/v1/notifications/${outboxId}/retry`).set(as('super')).expect(201);
      await dispatcher.dispatchDue();
      expect(
        await t.prisma.notificationDelivery.count({
          where: { outboxId, channel: 'WHATSAPP', status: 'ACCEPTED' },
        }),
      ).toBe(1);
      expect(
        await t.prisma.notificationDelivery.count({ where: { outboxId, channel: 'EMAIL' } }),
      ).toBe(1);
    });

    it('withdraws WhatsApp consent when the customer replies STOP', async () => {
      const { outboxId } = await acceptedDelivery();
      const job = await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } });
      const message = (body: string) => ({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    { from: PHONE.slice(1), id: 'wamid.in', type: 'text', text: { body } },
                  ],
                },
              },
            ],
          },
        ],
      });
      await post(message('stop please')).expect(200);
      expect(
        await t.prisma.customerConsent.count({
          where: { customerId: job.customerId, channel: 'WHATSAPP', withdrawnAt: null },
        }),
      ).toBe(1);
      await post(message('  Stop ')).expect(200);
      const consents = await t.prisma.customerConsent.findMany({
        where: { customerId: job.customerId },
      });
      expect(consents.find((c) => c.channel === 'WHATSAPP')).toMatchObject({
        withdrawnSource: 'WHATSAPP_REPLY',
      });
      expect(consents.find((c) => c.channel === 'EMAIL')?.withdrawnAt).toBeNull();
      expect(
        await t.prisma.auditLog.count({
          where: {
            action: 'customer.consent_withdrawn',
            entityId: job.customerId,
            actorType: 'SYSTEM',
          },
        }),
      ).toBe(1);
      // Later events no longer go to WhatsApp.
      await http()
        .post(`/api/v1/jobs/${job.aggregateId}/status-transitions`)
        .set(as('super'))
        .send({
          to: 'WARRANTY_CHECK',
          version: (await t.prisma.serviceJob.findUniqueOrThrow({ where: { id: job.aggregateId } }))
            .version,
        })
        .expect(200);
      await t.prisma.notificationOutbox.updateMany({
        where: { status: 'PENDING' },
        data: { nextAttemptAt: new Date(Date.now() - 60_000) },
      });
      graph.reset();
      await dispatcher.dispatchDue();
      expect(graph.requests).toHaveLength(0);
    });
  });

  it('sends customer sign-in codes with the WhatsApp authentication template and reports provider failure', async () => {
    const code =
      (await http()
        .post('/api/v1/customer/auth/otp/request')
        .send({ organizationCode: 'ORGA', phone: PHONE })
        .expect(200),
      graph.requests[0]);
    expect(code?.body).toMatchObject({
      to: '919812345678',
      template: {
        name: 'sign_in_code',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: expect.stringMatching(/^\d{6}$/) as string }],
          },
          { type: 'button', sub_type: 'url', index: '0' },
        ],
      },
    });
    graph.replies.push({ status: 400, body: { error: { code: 131030 } } });
    const failed = await http()
      .post('/api/v1/customer/auth/otp/request')
      .send({ organizationCode: 'ORGA', phone: '+919812300000' })
      .expect(503);
    expect((failed.body as { error: { code: string } }).error.code).toBe('OTP_DELIVERY_FAILED');
  });
});
