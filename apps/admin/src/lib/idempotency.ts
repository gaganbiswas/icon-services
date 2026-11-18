/** Random Idempotency-Key for one intended submission (reused on retry). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
