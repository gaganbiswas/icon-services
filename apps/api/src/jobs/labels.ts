export const SERVICE_TYPE_LABELS = {
  IN_WARRANTY: 'In warranty',
  OUT_OF_WARRANTY: 'Out of warranty',
  WARRANTY_UNVERIFIED: 'Warranty not yet verified',
} as const;

export const SERVICE_MODE_LABELS = {
  AT_SERVICE_CENTRE: 'At service centre',
  ON_SITE: 'On-site',
} as const;

/** Display a timestamp in a time zone, e.g. "18 Nov 2026, 14:05". */
export function formatDateTime(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString();
  }
}
