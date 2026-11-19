import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@icon/database';

import {
  NOTIFICATION_EVENTS,
  type NotificationEventName,
  type NotificationSettings,
  NotificationSettingsSchema,
  SETTINGS,
  templateParameters,
} from '@icon/contracts';

import { PRISMA } from '../prisma/prisma.service.js';
import {
  CHANNEL_ADAPTERS,
  type ChannelAdapter,
  type ChannelMessage,
  ProviderError,
} from './channel-adapter.js';
import { minutesUntilQuietEnd } from './providers.js';

export const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60;

/** Exponential backoff: 30 s, 60 s, 120 s, 240 s … */
export function backoffSeconds(attempt: number): number {
  return 30 * 2 ** Math.max(0, attempt - 1);
}

/** Reads notification settings without the HTTP-only SettingsService (worker context). */
async function notificationSettings(
  prisma: PrismaClient,
  organizationId: string,
): Promise<NotificationSettings> {
  const row = await prisma.businessSetting.findUnique({
    where: { organizationId_key: { organizationId, key: 'notifications' } },
    select: { value: true },
  });
  const parsed = row ? NotificationSettingsSchema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data : SETTINGS.notifications.default;
}

/** Plain-text email body from customer-safe payload fields only (no internal notes). */
function emailText(event: NotificationEventName, payload: Record<string, string | null>): string {
  const lines = [`Service request ${payload['jobNumber'] ?? ''}`.trim()];
  if (payload['statusLabel']) lines.push(`Status: ${payload['statusLabel']}`);
  if (payload['message']) lines.push(payload['message']);
  if (payload['decision']) lines.push(`Decision: ${payload['decision']}`);
  if (payload['receiptNumber'])
    lines.push(
      `Receipt ${payload['receiptNumber']}: ${payload['amount'] ?? ''} ${payload['currency'] ?? ''}`.trim(),
    );
  if (event === 'ESTIMATE_READY')
    lines.push('Please review the estimate in the customer app or portal.');
  lines.push('', 'This is an automated message.');
  return lines.join('\n');
}

function isEvent(value: string): value is NotificationEventName {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

interface ClaimedRow {
  id: string;
  organization_id: string;
  event_type: string;
  customer_id: string;
  payload: Record<string, string | null>;
  attempts: number;
}

/**
 * Sends outbox notifications. Safe to run in several processes: rows are
 * claimed with FOR UPDATE SKIP LOCKED and a lease. Channels already ACCEPTED
 * are never re-sent on retry (idempotent retries).
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CHANNEL_ADAPTERS) private readonly adapters: readonly ChannelAdapter[],
  ) {}

  /** Processes up to `batchSize` due notifications. Returns how many were handled. */
  async dispatchDue(batchSize = 20): Promise<number> {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "notification_outbox" SET
        "status" = 'PROCESSING',
        "attempts" = "attempts" + 1,
        "locked_until" = now() + make_interval(secs => ${LOCK_SECONDS}),
        "updated_at" = now()
      WHERE "id" IN (
        SELECT "id" FROM "notification_outbox"
        WHERE ("status" IN ('PENDING', 'FAILED') AND "next_attempt_at" <= now())
           OR ("status" = 'PROCESSING' AND "locked_until" < now())
        ORDER BY "next_attempt_at"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "organization_id", "event_type", "customer_id", "payload", "attempts"`;
    for (const row of rows) {
      await this.process(row).catch((error: unknown) => {
        this.logger.error(
          `Notification ${row.id} processing error: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      });
    }
    return rows.length;
  }

  private async process(row: ClaimedRow): Promise<void> {
    const settings = await notificationSettings(this.prisma, row.organization_id);
    const org = await this.prisma.organization.findUnique({
      where: { id: row.organization_id },
      select: { timezone: true },
    });
    const quietMinutes = minutesUntilQuietEnd(
      new Date(),
      org?.timezone ?? 'UTC',
      settings.quietHours,
    );
    if (quietMinutes > 0) {
      // Deferred, not attempted: the claim does not count as an attempt.
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: 'PENDING',
          attempts: row.attempts - 1,
          lockedUntil: null,
          lastError: 'Deferred: quiet hours',
          nextAttemptAt: new Date(Date.now() + quietMinutes * 60_000),
        },
      });
      return;
    }
    const event = isEvent(row.event_type) ? row.event_type : null;
    const eventTemplates = event ? settings.templates[event] : undefined;
    const customer = await this.prisma.customer.findFirst({
      where: { id: row.customer_id, organizationId: row.organization_id },
      select: {
        status: true,
        phoneE164: true,
        email: true,
        consents: {
          where: { withdrawnAt: null, purpose: 'SERVICE_UPDATES' },
          select: { channel: true },
        },
      },
    });
    const previouslyAccepted = new Set(
      (
        await this.prisma.notificationDelivery.findMany({
          where: { outboxId: row.id, status: 'ACCEPTED' },
          select: { channel: true },
        })
      ).map((d) => d.channel),
    );
    const consented = new Set(customer?.consents.map((c) => c.channel) ?? []);
    let retryableFailure = false;
    let permanentFailure = false;
    let anySent = previouslyAccepted.size > 0;

    for (const adapter of this.adapters) {
      if (previouslyAccepted.has(adapter.channel)) continue;
      const address = adapter.channel === 'WHATSAPP' ? customer?.phoneE164 : customer?.email;
      // What would be sent on this channel, or null when not configured for the event.
      let message: Omit<ChannelMessage, 'to' | 'idempotencyKey' | 'event'> | null = null;
      let templateName = `${adapter.channel.toLowerCase()}:${row.event_type}`;
      if (event && eventTemplates && adapter.configured) {
        if (adapter.channel === 'WHATSAPP') {
          // Mock (development/tests only; refused in production) may run without approved templates.
          const ref =
            eventTemplates.whatsapp ??
            (adapter.provider === 'mock'
              ? { name: `${event.toLowerCase()}_v1`, language: 'en' }
              : null);
          if (ref) {
            templateName = ref.name;
            message = { template: { ...ref, parameters: templateParameters(event, row.payload) } };
          }
        } else if (eventTemplates.emailSubject) {
          message = { subject: eventTemplates.emailSubject, text: emailText(event, row.payload) };
        }
      }
      const base = {
        outboxId: row.id,
        channel: adapter.channel,
        provider: adapter.provider,
        templateName: templateName.slice(0, 100),
        attempt: row.attempts,
      };
      // Consent is re-checked at send time: withdrawals after the event are respected.
      if (!customer || customer.status !== 'ACTIVE' || !consented.has(adapter.channel)) {
        await this.prisma.notificationDelivery.create({
          data: { ...base, status: 'SKIPPED_NO_CONSENT' },
        });
        continue;
      }
      if (!address) {
        await this.prisma.notificationDelivery.create({
          data: { ...base, status: 'SKIPPED_NO_ADDRESS' },
        });
        continue;
      }
      if (!message) {
        await this.prisma.notificationDelivery.create({
          data: { ...base, status: 'SKIPPED_NOT_CONFIGURED' },
        });
        continue;
      }
      try {
        const result = await adapter.send({
          ...message,
          to: address,
          event: row.event_type,
          idempotencyKey: `${row.id}:${adapter.channel}`,
        });
        await this.prisma.notificationDelivery.create({
          data: { ...base, status: 'ACCEPTED', providerMessageId: result.providerMessageId },
        });
        anySent = true;
      } catch (error) {
        const providerError = error instanceof ProviderError ? error : null;
        if (providerError && !providerError.retryable) permanentFailure = true;
        else retryableFailure = true;
        await this.prisma.notificationDelivery.create({
          data: { ...base, status: 'FAILED', errorCode: providerError?.code ?? 'UNEXPECTED_ERROR' },
        });
      }
    }

    const now = Date.now();
    await this.prisma.notificationOutbox.update({
      where: { id: row.id },
      data: retryableFailure
        ? row.attempts >= MAX_ATTEMPTS
          ? { status: 'DEAD', lockedUntil: null, lastError: 'Maximum attempts reached' }
          : {
              status: 'FAILED',
              lockedUntil: null,
              lastError: 'Provider error; will retry',
              nextAttemptAt: new Date(now + backoffSeconds(row.attempts) * 1000),
            }
        : permanentFailure
          ? // Retrying cannot help (e.g. template rejected); an operator retries after fixing it.
            {
              status: 'DEAD',
              lockedUntil: null,
              lastError: 'Provider rejected the message; check configuration',
            }
          : { status: anySent ? 'COMPLETED' : 'SKIPPED', lockedUntil: null, lastError: null },
    });
  }
}
