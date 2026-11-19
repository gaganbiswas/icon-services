import type { Prisma } from '@icon/database';

export type NotificationEvent =
  | 'JOB_RECEIVED'
  | 'JOB_STATUS_CHANGED'
  | 'JOB_UPDATE_POSTED'
  | 'REPAIR_COMPLETED'
  | 'READY_FOR_DELIVERY'
  | 'ESTIMATE_READY'
  | 'ESTIMATE_DECISION_RECORDED'
  | 'PAYMENT_RECEIVED'
  | 'DELIVERY_CONFIRMED'
  | 'INVOICE_ISSUED';

export interface OutboxEntry {
  readonly organizationId: string;
  readonly branchId: string;
  readonly jobId: string;
  readonly customerId: string;
  readonly eventType: NotificationEvent;
  /** Template parameters (job number, customer-facing labels, short message). */
  readonly payload: Record<string, string | null>;
  /** Unique per logical event, e.g. "<historyId>" — duplicates are ignored. */
  readonly dedupeKey: string;
}

/**
 * Persists notification intent inside the caller's business transaction
 * (CLAUDE.md §4.10). Sending happens later in the worker; business
 * transactions never wait for a provider.
 */
export async function enqueueNotification(
  tx: Prisma.TransactionClient,
  entry: OutboxEntry,
): Promise<void> {
  await tx.notificationOutbox.createMany({
    data: [
      {
        organizationId: entry.organizationId,
        branchId: entry.branchId,
        eventType: entry.eventType,
        aggregateType: 'service_job',
        aggregateId: entry.jobId,
        customerId: entry.customerId,
        payload: entry.payload,
        idempotencyKey: `${entry.eventType}:${entry.dedupeKey}`,
      },
    ],
    skipDuplicates: true,
  });
}
