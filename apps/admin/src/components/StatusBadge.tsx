import type { JobStatus } from '@icon/contracts';

const LABELS: Record<JobStatus, string> = {
  AWAITING_DEVICE: 'Awaiting device',
  RECEIVED: 'Received',
  WARRANTY_CHECK: 'Warranty check',
  DIAGNOSIS: 'Diagnosis',
  ESTIMATE_PREPARATION: 'Estimate preparation',
  AWAITING_CUSTOMER_APPROVAL: 'Awaiting approval',
  WAITING_FOR_PARTS: 'Waiting for parts',
  REPAIR_IN_PROGRESS: 'Repair in progress',
  QUALITY_CHECK: 'Quality check',
  REPAIR_COMPLETED: 'Repair completed',
  READY_FOR_DELIVERY: 'Ready for delivery',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  ON_HOLD: 'On hold',
};

export function statusLabel(status: JobStatus): string {
  return LABELS[status];
}

/** Status is always conveyed by text; colour is supplementary (CLAUDE.md §5). */
export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{LABELS[status]}</span>;
}
