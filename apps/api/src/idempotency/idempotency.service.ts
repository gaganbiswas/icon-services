import { createHash } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@icon/database';

import { AppException } from '../common/app-exception.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const RETENTION_MS = 7 * 86_400_000;

export interface IdempotencyScope {
  readonly organizationId: string;
  readonly actorKey: string;
  readonly operation: string;
}

/** Stable hash of a JSON request body (key order independent). */
export function hashRequest(body: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
      );
    }
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(body)))
    .digest('hex');
}

export function requireIdempotencyKey(header: string | undefined): string {
  if (!header) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header is required for this request',
    );
  }
  if (!KEY_PATTERN.test(header)) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key must be 8–100 letters, digits, "-" or "_"',
    );
  }
  return header;
}

/**
 * Idempotent execution (CLAUDE.md §7). The key row is inserted in the same
 * transaction as the operation; a concurrent duplicate blocks on the unique
 * index until the first commits, then replays the stored response.
 */
export async function runIdempotent<T>(
  tx: Prisma.TransactionClient,
  scope: IdempotencyScope,
  key: string,
  body: unknown,
  operation: () => Promise<{ status: number; body: T; resourceId?: string }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  const requestHash = hashRequest(body);
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "idempotency_keys" ("id", "organization_id", "actor_key", "operation", "key", "request_hash", "created_at", "expires_at")
    VALUES (gen_random_uuid(), ${scope.organizationId}::uuid, ${scope.actorKey}, ${scope.operation}, ${key}, ${requestHash}, now(), ${new Date(Date.now() + RETENTION_MS)})
    ON CONFLICT ("actor_key", "operation", "key") DO NOTHING
    RETURNING "id"`;

  if (inserted.length === 0) {
    const existing = await tx.idempotencyKey.findUniqueOrThrow({
      where: {
        actorKey_operation_key: { actorKey: scope.actorKey, operation: scope.operation, key },
      },
    });
    if (existing.requestHash !== requestHash) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request',
      );
    }
    if (existing.responseStatus === null) {
      throw AppException.conflict('The original request is still being processed. Retry shortly.');
    }
    return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true };
  }

  const result = await operation();
  await tx.idempotencyKey.update({
    where: { id: inserted[0]?.id ?? '' },
    data: {
      responseStatus: result.status,
      responseBody: result.body as Prisma.InputJsonValue,
      resourceId: result.resourceId ?? null,
    },
  });
  return { ...result, replayed: false };
}
