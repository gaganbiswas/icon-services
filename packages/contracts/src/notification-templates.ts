import type { NotificationEventName } from './settings.js';

/**
 * Body parameter order for each event's WhatsApp template ({{1}}, {{2}}, …).
 * Register templates with Meta using exactly this order (docs/notification-templates.md).
 * Values come from the outbox payload; missing values are sent as "-".
 */
export const TEMPLATE_PARAMETERS: Record<NotificationEventName, readonly string[]> = {
  JOB_RECEIVED: ['jobNumber', 'statusLabel'],
  JOB_STATUS_CHANGED: ['jobNumber', 'statusLabel'],
  JOB_UPDATE_POSTED: ['jobNumber', 'message'],
  REPAIR_COMPLETED: ['jobNumber'],
  READY_FOR_DELIVERY: ['jobNumber'],
  ESTIMATE_READY: ['jobNumber'],
  ESTIMATE_DECISION_RECORDED: ['jobNumber', 'decision'],
  PAYMENT_RECEIVED: ['jobNumber', 'receiptNumber', 'amount', 'currency'],
  DELIVERY_CONFIRMED: ['jobNumber'],
};

export function templateParameters(
  event: NotificationEventName,
  payload: Record<string, string | null>,
): string[] {
  return TEMPLATE_PARAMETERS[event].map((key) => {
    const value = payload[key] ?? null;
    // WhatsApp rejects empty parameters, newlines/tabs and long runs of spaces.
    return value
      ? value
          .replace(/[\n\t]+/g, ' ')
          .replace(/ {4,}/g, '   ')
          .slice(0, 1000)
      : '-';
  });
}
