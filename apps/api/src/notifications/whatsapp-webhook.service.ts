import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@icon/database';
import { z } from 'zod';

import { AuditService } from '../audit/audit.service.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PRISMA } from '../prisma/prisma.service.js';

/** Replies that withdraw WhatsApp consent (ADR 0018). */
const OPT_OUT_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'STOP ALL']);

const StatusSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.string(),
  timestamp: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
  errors: z.array(z.object({ code: z.number().int().optional() })).optional(),
});
const MessageSchema = z.object({
  from: z.string().regex(/^\d{5,20}$/),
  type: z.string(),
  text: z.object({ body: z.string().max(4096) }).optional(),
  button: z.object({ text: z.string().max(256) }).optional(),
});
const PayloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  statuses: z.array(z.unknown()).optional(),
                  messages: z.array(z.unknown()).optional(),
                })
                .passthrough(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Meta WhatsApp webhook processing: signature verification, delivery status
 * callbacks and opt-out replies. Message content is never stored or logged.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.env.WHATSAPP_APP_SECRET && this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
  }

  /** GET subscription handshake. Returns the challenge, or null when refused. */
  verifySubscription(mode: unknown, token: unknown, challenge: unknown): string | null {
    const expected = this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (
      !expected ||
      mode !== 'subscribe' ||
      typeof token !== 'string' ||
      typeof challenge !== 'string'
    )
      return null;
    if (!/^[\w-]{1,200}$/.test(challenge)) return null;
    return sameSecret(token, expected) ? challenge : null;
  }

  /** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(raw body, app secret). */
  verifySignature(rawBody: Buffer | undefined, header: unknown): boolean {
    const secret = this.env.WHATSAPP_APP_SECRET;
    if (!secret || !rawBody || typeof header !== 'string' || !header.startsWith('sha256='))
      return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    return sameSecret(header, expected);
  }

  async handle(body: unknown): Promise<{ statuses: number; optOuts: number }> {
    const parsed = PayloadSchema.safeParse(body);
    if (!parsed.success || parsed.data.object !== 'whatsapp_business_account')
      return { statuses: 0, optOuts: 0 };
    let statuses = 0;
    let optOuts = 0;
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        for (const raw of change.value.statuses ?? []) {
          const status = StatusSchema.safeParse(raw);
          if (status.success && (await this.applyStatus(status.data))) statuses += 1;
        }
        for (const raw of change.value.messages ?? []) {
          const message = MessageSchema.safeParse(raw);
          if (!message.success) continue;
          const words = (message.data.text?.body ?? message.data.button?.text ?? '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, ' ');
          if (OPT_OUT_WORDS.has(words)) optOuts += await this.optOut(message.data.from);
        }
      }
    }
    return { statuses, optOuts };
  }

  /** Moves a delivery forward only (ACCEPTED → DELIVERED → READ; ACCEPTED/DELIVERED → FAILED never downgrades READ). */
  private async applyStatus(status: z.infer<typeof StatusSchema>): Promise<boolean> {
    const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
    const where = { provider: 'meta', channel: 'WHATSAPP' as const, providerMessageId: status.id };
    switch (status.status) {
      case 'delivered':
        return (
          (
            await this.prisma.notificationDelivery.updateMany({
              where: { ...where, status: 'ACCEPTED' },
              data: { status: 'DELIVERED', deliveredAt: at },
            })
          ).count > 0
        );
      case 'read': {
        await this.prisma.notificationDelivery.updateMany({
          where: { ...where, status: 'ACCEPTED' },
          data: { deliveredAt: at },
        });
        return (
          (
            await this.prisma.notificationDelivery.updateMany({
              where: { ...where, status: { in: ['ACCEPTED', 'DELIVERED'] } },
              data: { status: 'READ', readAt: at },
            })
          ).count > 0
        );
      }
      case 'failed': {
        const code = status.errors?.[0]?.code;
        return this.prisma.$transaction(async (tx) => {
          const delivery = await tx.notificationDelivery.findFirst({
            where: { ...where, status: 'ACCEPTED' },
            select: { id: true, outboxId: true },
          });
          if (!delivery) return false;
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'FAILED',
              errorCode: code !== undefined ? `META_${code}` : 'META_FAILED',
            },
          });
          // Surfaces in the notification centre for an authorized manual retry.
          await tx.notificationOutbox.updateMany({
            where: { id: delivery.outboxId, status: { in: ['COMPLETED', 'SKIPPED'] } },
            data: { status: 'DEAD', lastError: 'WhatsApp reported the message as not delivered' },
          });
          return true;
        });
      }
      default:
        // "sent" adds nothing beyond ACCEPTED; unknown values are ignored.
        return false;
    }
  }

  /** Withdraws WhatsApp consents for every customer with this number in the configured organization. */
  private async optOut(fromDigits: string): Promise<number> {
    const code = this.env.WHATSAPP_ORGANIZATION_CODE;
    if (!code) return 0;
    const organization = await this.prisma.organization.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!organization) {
      this.logger.error('WHATSAPP_ORGANIZATION_CODE does not match an organization');
      return 0;
    }
    return this.prisma.$transaction(async (tx) => {
      const consents = await tx.customerConsent.findMany({
        where: {
          organizationId: organization.id,
          channel: 'WHATSAPP',
          withdrawnAt: null,
          customer: { phoneE164: `+${fromDigits}` },
        },
        select: { id: true, customerId: true, purpose: true },
      });
      if (consents.length === 0) return 0;
      await tx.customerConsent.updateMany({
        where: { id: { in: consents.map((c) => c.id) } },
        data: { withdrawnAt: new Date(), withdrawnSource: 'WHATSAPP_REPLY' },
      });
      for (const customerId of new Set(consents.map((c) => c.customerId))) {
        await this.audit.record(tx, {
          organizationId: organization.id,
          actorUserId: null,
          actorType: 'SYSTEM',
          action: 'customer.consent_withdrawn',
          entityType: 'customer',
          entityId: customerId,
          after: {
            channel: 'WHATSAPP',
            purposes: consents.filter((c) => c.customerId === customerId).map((c) => c.purpose),
          },
          reason: 'Customer replied STOP on WhatsApp',
        });
      }
      return consents.length;
    });
  }
}
