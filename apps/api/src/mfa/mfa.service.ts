import { randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { MFA_PRIVILEGED_PERMISSIONS, type MfaEnrollment, type MfaStatus } from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import { canManageUser } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AppException } from '../common/app-exception.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SecretBox } from './secret-box.js';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp.js';

type Db = Prisma.TransactionClient | PrismaClient;

const RECOVERY_CODES = 10;
const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

const purpose = (userId: string) => `mfa-totp:${userId}`;

/** 50-bit single-use code, e.g. "k7d2m-q4xpa". */
function recoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b & 31]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
}

export function isPrivileged(permissions: Iterable<string>): boolean {
  const held = new Set(permissions);
  return MFA_PRIVILEGED_PERMISSIONS.some((p) => held.has(p));
}

/** TOTP enrolment, verification and reset (ADR 0011). Secrets never leave this service after enrolment. */
@Injectable()
export class MfaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  private box(): SecretBox {
    if (!this.env.MFA_ENCRYPTION_KEY) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CONFIGURATION_REQUIRED',
        'Two-step sign-in is not configured on this server.',
      );
    }
    return new SecretBox(this.env.MFA_ENCRYPTION_KEY);
  }

  /** True when the user must enrol before using anything else. */
  enrollmentRequired(permissions: Iterable<string>, enabled: boolean): boolean {
    return this.env.MFA_ENFORCEMENT === 'required' && !enabled && isPrivileged(permissions);
  }

  async enabled(userId: string, db: Db = this.prisma): Promise<boolean> {
    const mfa = await db.userMfa.findUnique({ where: { userId }, select: { enabledAt: true } });
    return Boolean(mfa?.enabledAt);
  }

  async status(principal: Principal): Promise<MfaStatus> {
    const [mfa, remaining] = await Promise.all([
      this.prisma.userMfa.findUnique({
        where: { userId: principal.userId },
        select: { enabledAt: true },
      }),
      this.prisma.userMfaRecoveryCode.count({ where: { userId: principal.userId, usedAt: null } }),
    ]);
    return {
      enabled: Boolean(mfa?.enabledAt),
      required: this.env.MFA_ENFORCEMENT === 'required' && isPrivileged(principal.permissions),
      recoveryCodesRemaining: mfa?.enabledAt ? remaining : 0,
    };
  }

  async startEnrollment(principal: Principal): Promise<MfaEnrollment> {
    const box = this.box();
    const secret = generateTotpSecret();
    const sealed = box.seal(secret, purpose(principal.userId));
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userMfa.findUnique({
        where: { userId: principal.userId },
        select: { enabledAt: true },
      });
      if (existing?.enabledAt)
        throw AppException.conflict(
          'Two-step sign-in is already on. Ask an administrator to reset it.',
        );
      await tx.userMfa.upsert({
        where: { userId: principal.userId },
        create: { userId: principal.userId, secretSealed: sealed },
        update: { secretSealed: sealed, lastUsedStep: null },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'mfa.enrollment_started',
        entityType: 'user',
        entityId: principal.userId,
      });
    });
    return {
      secret: base32Encode(secret),
      otpauthUri: otpauthUri(secret, principal.email, this.env.MFA_ISSUER),
    };
  }

  /** Confirms the first code, enables MFA and returns recovery codes (shown once). */
  async confirmEnrollment(
    principal: Principal,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const box = this.box();
    const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
    const hashes = await Promise.all(codes.map((c) => this.passwords.hash(c)));
    await this.prisma.$transaction(async (tx) => {
      const pending = await tx.userMfa.findUnique({ where: { userId: principal.userId } });
      if (!pending || pending.enabledAt) throw AppException.conflict('Start set-up first.');
      const step = matchTotp(
        box.open(pending.secretSealed, purpose(principal.userId)),
        code,
        new Date(),
      );
      if (step === null)
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          'MFA_INVALID',
          'That code is not correct. Check the time on your phone and try again.',
        );
      await tx.userMfa.update({
        where: { userId: principal.userId },
        data: { enabledAt: new Date(), lastUsedStep: step },
      });
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId: principal.userId } });
      await tx.userMfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId: principal.userId, codeHash })),
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'mfa.enabled',
        entityType: 'user',
        entityId: principal.userId,
      });
    });
    return { recoveryCodes: codes };
  }

  /**
   * Checks a sign-in code. TOTP steps are accepted once (replay protection,
   * enforced with a conditional update); recovery codes are single-use.
   */
  async verify(
    tx: Prisma.TransactionClient,
    userId: string,
    code: string,
  ): Promise<'TOTP' | 'RECOVERY_CODE' | null> {
    const mfa = await tx.userMfa.findUnique({ where: { userId } });
    if (!mfa?.enabledAt) return null;
    if (/^\d{6}$/.test(code)) {
      const step = matchTotp(this.box().open(mfa.secretSealed, purpose(userId)), code, new Date());
      if (step === null) return null;
      const updated = await tx.userMfa.updateMany({
        where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
        data: { lastUsedStep: step },
      });
      return updated.count === 1 ? 'TOTP' : null;
    }
    const unused = await tx.userMfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    for (const candidate of unused) {
      if (await this.passwords.verify(candidate.codeHash, code)) {
        const used = await tx.userMfaRecoveryCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return used.count === 1 ? 'RECOVERY_CODE' : null;
      }
    }
    return null;
  }

  /** Removes another user's MFA (lost phone). Signs the user out everywhere. */
  async reset(actor: Principal, userId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: userId, organizationId: actor.organizationId },
        select: {
          id: true,
          roles: {
            select: {
              role: {
                select: { permissions: { select: { permission: { select: { code: true } } } } },
              },
            },
          },
        },
      });
      if (!target) throw AppException.notFound('User');
      const permissions = new Set(
        target.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)),
      );
      if (!canManageUser(actor, { id: target.id, permissions })) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'You cannot reset two-step sign-in for this user.',
        );
      }
      const removed = await tx.userMfa.deleteMany({ where: { userId } });
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ADMIN' },
      });
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: 'mfa.reset',
        entityType: 'user',
        entityId: userId,
        after: { hadMfa: removed.count > 0 },
        reason,
      });
    });
  }
}
