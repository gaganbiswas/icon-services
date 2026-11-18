import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@icon/database';

import { redact } from '../common/redact.js';
import { currentRequestContext } from '../common/request-context.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export interface AuditEntry {
  readonly organizationId: string | null;
  readonly branchId?: string | null;
  /** Null for system or anonymous actions. */
  readonly actorUserId: string | null;
  readonly actorType?: 'USER' | 'SYSTEM' | 'ANONYMOUS';
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
}

const toJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined || value === null ? undefined : (redact(value) as Prisma.InputJsonValue);

/**
 * Writes append-only audit rows. Always pass the transaction client of the
 * change being audited so the audit row commits (or rolls back) with it.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const context = currentRequestContext();
    const actorType = entry.actorType ?? (entry.actorUserId ? 'USER' : 'ANONYMOUS');
    const storeClient = this.env.AUDIT_STORE_CLIENT_METADATA;
    await tx.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        branchId: entry.branchId ?? null,
        actorType,
        actorUserId: actorType === 'USER' ? entry.actorUserId : null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        requestId: context.requestId,
        ipAddress: storeClient ? context.ipAddress : null,
        userAgent: storeClient ? context.userAgent : null,
      },
    });
  }
}
