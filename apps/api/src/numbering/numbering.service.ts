import { Injectable } from '@nestjs/common';
import { type NumberFormat, formatNumber } from '@icon/contracts';
import type { Prisma } from '@icon/database';

/** Calendar year of `at` in an IANA time zone (falls back to UTC). */
export function yearIn(at: Date, timeZone: string | null | undefined): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: timeZone ?? 'UTC', year: 'numeric' }).format(at),
    );
  } catch {
    return at.getUTCFullYear();
  }
}

export interface NextNumberInput {
  readonly organizationId: string;
  /** Branch-scoped sequence when set; organization-wide otherwise. */
  readonly branch?: { id: string; code: string } | undefined;
  readonly documentType: string;
  readonly format: NumberFormat;
  readonly timeZone?: string | null | undefined;
  readonly at?: Date;
}

/**
 * Concurrency-safe numbering (CLAUDE.md §6): a single atomic upsert that
 * increments and returns the counter inside the caller's transaction. The row
 * lock is held until that transaction ends, so numbers are never duplicated.
 */
@Injectable()
export class NumberingService {
  async next(tx: Prisma.TransactionClient, input: NextNumberInput): Promise<string> {
    const at = input.at ?? new Date();
    const year = yearIn(at, input.timeZone);
    const periodKey = input.format.reset === 'YEARLY' ? String(year) : 'ALL';
    const branchScope = input.branch?.id ?? '-';
    const rows = await tx.$queryRaw<{ current_value: bigint }[]>`
      INSERT INTO "number_sequences" ("id", "organization_id", "branch_scope", "document_type", "period_key", "current_value", "updated_at")
      VALUES (gen_random_uuid(), ${input.organizationId}::uuid, ${branchScope}, ${input.documentType}, ${periodKey}, 1, now())
      ON CONFLICT ("organization_id", "branch_scope", "document_type", "period_key")
      DO UPDATE SET "current_value" = "number_sequences"."current_value" + 1, "updated_at" = now()
      RETURNING "current_value"`;
    const sequence = rows[0]?.current_value;
    if (sequence === undefined) {
      throw new Error('Number sequence did not return a value');
    }
    return formatNumber(input.format.template, { sequence, year, branchCode: input.branch?.code });
  }
}
