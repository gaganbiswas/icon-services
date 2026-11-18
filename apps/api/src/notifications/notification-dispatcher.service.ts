import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@icon/database';

import { PRISMA } from '../prisma/prisma.service.js';
import { CHANNEL_ADAPTERS, type ChannelAdapter, ProviderError } from './channel-adapter.js';

export const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60;

/** Exponential backoff: 30 s, 60 s, 120 s, 240 s … */
export function backoffSeconds(attempt: number): number {
  return 30 * 2 ** Math.max(0, attempt - 1);
}

/** Template names (placeholders until WhatsApp templates are approved, Phase 10). */
const TEMPLATES: Record<string, string> = {
  JOB_RECEIVED: 'job_received_v1',
  JOB_STATUS_CHANGED: 'job_status_changed_v1',
  JOB_UPDATE_POSTED: 'job_update_v1',
  REPAIR_COMPLETED: 'repair_completed_v1',
  READY_FOR_DELIVERY: 'ready_for_delivery_v1',
};

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
    const template = TEMPLATES[row.event_type] ?? 'generic_update_v1';
    let failed = false;
    let anySent = previouslyAccepted.size > 0;

    for (const adapter of this.adapters) {
      if (previouslyAccepted.has(adapter.channel)) continue;
      const address = adapter.channel === 'WHATSAPP' ? customer?.phoneE164 : customer?.email;
      const base = {
        outboxId: row.id,
        channel: adapter.channel,
        provider: adapter.provider,
        templateName: template,
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
      try {
        const result = await adapter.send({
          to: address,
          template,
          parameters: row.payload,
          idempotencyKey: `${row.id}:${adapter.channel}`,
        });
        await this.prisma.notificationDelivery.create({
          data: { ...base, status: 'ACCEPTED', providerMessageId: result.providerMessageId },
        });
        anySent = true;
      } catch (error) {
        failed = true;
        await this.prisma.notificationDelivery.create({
          data: {
            ...base,
            status: 'FAILED',
            errorCode: error instanceof ProviderError ? error.code : 'UNEXPECTED_ERROR',
          },
        });
      }
    }

    const now = Date.now();
    await this.prisma.notificationOutbox.update({
      where: { id: row.id },
      data: failed
        ? row.attempts >= MAX_ATTEMPTS
          ? { status: 'DEAD', lockedUntil: null, lastError: 'Maximum attempts reached' }
          : {
              status: 'FAILED',
              lockedUntil: null,
              lastError: 'Provider error; will retry',
              nextAttemptAt: new Date(now + backoffSeconds(row.attempts) * 1000),
            }
        : { status: anySent ? 'COMPLETED' : 'SKIPPED', lockedUntil: null, lastError: null },
    });
  }
}
