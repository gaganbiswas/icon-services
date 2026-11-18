import { Inject, Injectable, Logger } from '@nestjs/common';
import { SETTINGS, type SettingKey, type SettingValue } from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { PRISMA } from '../prisma/prisma.service.js';

type Db = Prisma.TransactionClient | PrismaClient;

/** Organization settings with schema validation and code defaults (ADR 0012). */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(
    organizationId: string,
    key: K,
    db: Db = this.prisma,
  ): Promise<SettingValue<K>> {
    const row = await db.businessSetting.findUnique({
      where: { organizationId_key: { organizationId, key } },
      select: { value: true },
    });
    const definition = SETTINGS[key];
    if (row) {
      const parsed = definition.schema.safeParse(row.value);
      if (parsed.success) {
        return parsed.data as SettingValue<K>;
      }
      // Never fail a business operation on a corrupt setting; fall back loudly.
      this.logger.error(`Stored setting "${key}" is invalid; using default`);
    }
    return definition.default as SettingValue<K>;
  }

  async list(organizationId: string): Promise<Record<SettingKey, unknown>> {
    const entries = await Promise.all(
      (Object.keys(SETTINGS) as SettingKey[]).map(
        async (key) => [key, await this.get(organizationId, key)] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<SettingKey, unknown>;
  }

  async set(actor: Principal, key: SettingKey, value: unknown, reason: string): Promise<unknown> {
    const parsed = SETTINGS[key].schema.safeParse(value);
    if (!parsed.success) {
      throw new AppException(
        400,
        'VALIDATION_FAILED',
        'The setting value is invalid',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await this.get(actor.organizationId, key, tx);
      const json = parsed.data as Prisma.InputJsonValue;
      await tx.businessSetting.upsert({
        where: { organizationId_key: { organizationId: actor.organizationId, key } },
        create: {
          organizationId: actor.organizationId,
          key,
          value: json,
          updatedById: actor.userId,
        },
        update: { value: json, updatedById: actor.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: 'setting.updated',
        entityType: 'setting',
        entityId: key,
        before,
        after: parsed.data,
        reason,
      });
      return parsed.data;
    });
  }
}
