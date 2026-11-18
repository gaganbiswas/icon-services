/** Keys whose values must never be written to audit logs (case-insensitive substrings). */
const SENSITIVE_KEY_PARTS = [
  'password',
  'token',
  'secret',
  'hash',
  'otp',
  'cookie',
  'authorization',
];

export const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

/**
 * Deep-copies a value replacing sensitive fields with a marker. Dates become
 * ISO strings so the result is JSON-safe. Depth-limited for safety.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '[TRUNCATED]';
  }
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redact(item, depth + 1),
      ]),
    );
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}
