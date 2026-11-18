import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AccessTokenResponse } from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { currentRequestContext } from '../common/request-context.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { TokenService, generateOpaqueToken, hashToken } from './token.service.js';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Single generic message: never reveal whether the account exists or is locked. */
const INVALID_CREDENTIALS_MESSAGE =
  'Invalid email or password, or the account is temporarily locked.';

export type SessionRevocationReason =
  | 'LOGOUT'
  | 'REFRESH_TOKEN_REUSE'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'USER_DEACTIVATED'
  | 'ADMIN';

export interface IssuedSession {
  readonly response: AccessTokenResponse;
  /** Raw refresh token for the HttpOnly cookie. Never logged or stored. */
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

function invalidCredentials(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS',
    INVALID_CREDENTIALS_MESSAGE,
  );
}

function invalidToken(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    'INVALID_TOKEN',
    'Session expired. Sign in again.',
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- login

  async login(email: string, password: string): Promise<IssuedSession> {
    const emailNormalized = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
      select: {
        id: true,
        organizationId: true,
        passwordHash: true,
        isActive: true,
        lockedUntil: true,
        mustChangePassword: true,
        organization: { select: { isActive: true } },
      },
    });

    // Always verify a hash (real or dummy) so timing does not reveal accounts.
    const passwordOk = await this.passwords.verify(user?.passwordHash ?? null, password);
    const now = new Date();

    if (!user) {
      await this.prisma.$transaction((tx) =>
        this.audit.record(tx, {
          organizationId: null,
          actorUserId: null,
          action: 'auth.login.failed',
          entityType: 'auth',
          after: { reason: 'UNKNOWN_ACCOUNT' },
        }),
      );
      throw invalidCredentials();
    }

    const locked = user.lockedUntil !== null && user.lockedUntil > now;
    const blocked = !user.isActive || !user.organization.isActive || !user.passwordHash;

    if (locked || blocked || !passwordOk) {
      await this.prisma.$transaction(async (tx) => {
        let lockedNow = false;
        // Count wrong passwords only; locked/blocked attempts do not extend the lock.
        if (!passwordOk && !locked && !blocked) {
          const updated = await tx.user.update({
            where: { id: user.id },
            data: { failedLoginCount: { increment: 1 } },
            select: { failedLoginCount: true },
          });
          if (updated.failedLoginCount >= this.env.LOGIN_MAX_FAILED_ATTEMPTS) {
            lockedNow = true;
            await tx.user.update({
              where: { id: user.id },
              data: {
                failedLoginCount: 0,
                lockedUntil: new Date(now.getTime() + this.env.LOGIN_LOCKOUT_MINUTES * MINUTE_MS),
              },
            });
          }
        }
        const reason = locked
          ? 'ACCOUNT_LOCKED'
          : blocked
            ? 'ACCOUNT_UNAVAILABLE'
            : 'WRONG_PASSWORD';
        await this.audit.record(tx, {
          organizationId: user.organizationId,
          actorUserId: null,
          action: 'auth.login.failed',
          entityType: 'user',
          entityId: user.id,
          after: { reason },
        });
        if (lockedNow) {
          await this.audit.record(tx, {
            organizationId: user.organizationId,
            actorUserId: null,
            actorType: 'SYSTEM',
            action: 'auth.account.locked',
            entityType: 'user',
            entityId: user.id,
            after: { lockoutMinutes: this.env.LOGIN_LOCKOUT_MINUTES },
          });
        }
      });
      throw invalidCredentials();
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      const issued = await this.createSession(
        tx,
        user.id,
        user.organizationId,
        user.mustChangePassword,
      );
      await this.audit.record(tx, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'auth.login.succeeded',
        entityType: 'user',
        entityId: user.id,
      });
      return issued;
    });
  }

  // -------------------------------------------------------------- refresh

  async refresh(rawToken: string): Promise<IssuedSession> {
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          usedAt: true,
          expiresAt: true,
          session: {
            select: {
              id: true,
              revokedAt: true,
              expiresAt: true,
              user: {
                select: {
                  id: true,
                  organizationId: true,
                  isActive: true,
                  mustChangePassword: true,
                  organization: { select: { isActive: true } },
                },
              },
            },
          },
        },
      });
      if (!token) {
        return { kind: 'invalid' as const };
      }
      const { session } = token;
      const { user } = session;

      // Atomically claim the token; a second use (replay or race) gets count 0.
      const claimed =
        token.usedAt === null
          ? (
              await tx.refreshToken.updateMany({
                where: { id: token.id, usedAt: null },
                data: { usedAt: now },
              })
            ).count === 1
          : false;

      if (!claimed) {
        if (session.revokedAt === null) {
          await this.revokeSessions(tx, { sessionId: session.id }, 'REFRESH_TOKEN_REUSE');
          await this.audit.record(tx, {
            organizationId: user.organizationId,
            actorUserId: null,
            actorType: 'SYSTEM',
            action: 'auth.refresh_token.reuse_detected',
            entityType: 'auth_session',
            entityId: session.id,
            after: { userId: user.id },
          });
        }
        return { kind: 'reuse' as const };
      }

      if (
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        token.expiresAt <= now ||
        !user.isActive ||
        !user.organization.isActive
      ) {
        return { kind: 'invalid' as const };
      }

      await tx.authSession.update({ where: { id: session.id }, data: { lastUsedAt: now } });
      const issued = await this.issueTokens(tx, {
        sessionId: session.id,
        sessionExpiresAt: session.expiresAt,
        userId: user.id,
        organizationId: user.organizationId,
        mustChangePassword: user.mustChangePassword,
      });
      return { kind: 'ok' as const, issued };
    });

    if (outcome.kind !== 'ok') {
      throw invalidToken();
    }
    return outcome.issued;
  }

  // --------------------------------------------------------------- logout

  /** Idempotent: unknown or already-revoked tokens succeed silently. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        select: {
          session: {
            select: {
              id: true,
              revokedAt: true,
              user: { select: { id: true, organizationId: true } },
            },
          },
        },
      });
      if (!token || token.session.revokedAt !== null) {
        return;
      }
      await this.revokeSessions(tx, { sessionId: token.session.id }, 'LOGOUT');
      await this.audit.record(tx, {
        organizationId: token.session.user.organizationId,
        actorUserId: token.session.user.id,
        action: 'auth.logout',
        entityType: 'auth_session',
        entityId: token.session.id,
      });
    });
  }

  // ------------------------------------------------------ password change

  async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { passwordHash: true, emailNormalized: true },
    });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The request is invalid',
        [{ path: 'currentPassword', message: 'Current password is incorrect' }],
      );
    }
    this.assertAcceptablePassword(newPassword, user.emailNormalized, currentPassword);
    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: principal.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          version: { increment: 1 },
        },
      });
      // Sign out every other device; keep the current session.
      await this.revokeSessions(
        tx,
        { userId: principal.userId, exceptSessionId: principal.sessionId },
        'PASSWORD_CHANGED',
      );
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'auth.password.changed',
        entityType: 'user',
        entityId: principal.userId,
      });
    });
  }

  // ------------------------------------------------ password set-up/reset

  /** Issues a one-time set-up token, revoking earlier unused ones. Returns the raw token. */
  async issuePasswordSetupToken(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: 'INITIAL_SETUP' | 'ADMIN_RESET',
    issuedById: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = new Date();
    await tx.passwordSetupToken.updateMany({
      where: { userId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const token = generateOpaqueToken();
    const expiresAt = new Date(
      now.getTime() + this.env.PASSWORD_SETUP_TOKEN_TTL_MINUTES * MINUTE_MS,
    );
    await tx.passwordSetupToken.create({
      data: { userId, tokenHash: hashToken(token), purpose, issuedById, expiresAt },
    });
    return { token, expiresAt };
  }

  async completePasswordSetup(rawToken: string, newPassword: string): Promise<void> {
    const now = new Date();
    const record = await this.prisma.passwordSetupToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        purpose: true,
        user: { select: { id: true, organizationId: true, isActive: true, emailNormalized: true } },
      },
    });
    if (
      !record ||
      record.usedAt !== null ||
      record.revokedAt !== null ||
      record.expiresAt <= now ||
      !record.user.isActive
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TOKEN',
        'This password set-up link is invalid or has expired. Ask an administrator for a new one.',
      );
    }
    this.assertAcceptablePassword(newPassword, record.user.emailNormalized);
    const passwordHash = await this.passwords.hash(newPassword);
    const { user } = record;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordSetupToken.updateMany({
        where: { id: record.id, usedAt: null, revokedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          'INVALID_TOKEN',
          'This password set-up link has already been used.',
        );
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      });
      await this.revokeSessions(tx, { userId: user.id }, 'PASSWORD_RESET');
      await this.audit.record(tx, {
        organizationId: user.organizationId,
        actorUserId: null,
        action: 'auth.password.setup_completed',
        entityType: 'user',
        entityId: user.id,
        after: { purpose: record.purpose },
      });
    });
  }

  // -------------------------------------------------------------- helpers

  async revokeSessions(
    tx: Prisma.TransactionClient,
    target: { sessionId: string } | { userId: string; exceptSessionId?: string },
    reason: SessionRevocationReason,
  ): Promise<number> {
    const where: Prisma.AuthSessionWhereInput =
      'sessionId' in target
        ? { id: target.sessionId, revokedAt: null }
        : {
            userId: target.userId,
            revokedAt: null,
            ...(target.exceptSessionId ? { id: { not: target.exceptSessionId } } : {}),
          };
    const result = await tx.authSession.updateMany({
      where,
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  private assertAcceptablePassword(
    password: string,
    emailNormalized: string,
    previous?: string,
  ): void {
    const lower = password.toLowerCase();
    const localPart = emailNormalized.split('@')[0] ?? '';
    const problems: { path: string; message: string }[] = [];
    // Short local parts (e.g. "a@…") would reject almost any password; only check from 4 chars.
    if (lower === emailNormalized || (localPart.length >= 4 && lower.includes(localPart))) {
      problems.push({ path: 'newPassword', message: 'Password must not contain your e-mail name' });
    }
    if (previous !== undefined && password === previous) {
      problems.push({
        path: 'newPassword',
        message: 'New password must differ from the current one',
      });
    }
    if (problems.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The request is invalid',
        problems,
      );
    }
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    userId: string,
    organizationId: string,
    mustChangePassword: boolean,
  ): Promise<IssuedSession> {
    const context = currentRequestContext();
    const storeClient = this.env.AUDIT_STORE_CLIENT_METADATA;
    const sessionExpiresAt = new Date(Date.now() + this.env.SESSION_ABSOLUTE_TTL_DAYS * DAY_MS);
    const session = await tx.authSession.create({
      data: {
        userId,
        expiresAt: sessionExpiresAt,
        ipAddress: storeClient ? context.ipAddress : null,
        userAgent: storeClient ? context.userAgent : null,
      },
      select: { id: true },
    });
    return this.issueTokens(tx, {
      sessionId: session.id,
      sessionExpiresAt,
      userId,
      organizationId,
      mustChangePassword,
    });
  }

  private async issueTokens(
    tx: Prisma.TransactionClient,
    input: {
      sessionId: string;
      sessionExpiresAt: Date;
      userId: string;
      organizationId: string;
      mustChangePassword: boolean;
    },
  ): Promise<IssuedSession> {
    const refreshToken = generateOpaqueToken();
    const idleExpiry = Date.now() + this.env.REFRESH_TOKEN_IDLE_TTL_DAYS * DAY_MS;
    const refreshExpiresAt = new Date(Math.min(idleExpiry, input.sessionExpiresAt.getTime()));
    await tx.refreshToken.create({
      data: {
        sessionId: input.sessionId,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });
    const accessToken = await this.tokens.signAccessToken({
      userId: input.userId,
      sessionId: input.sessionId,
      organizationId: input.organizationId,
    });
    return {
      refreshToken,
      refreshExpiresAt,
      response: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: this.tokens.accessTokenTtlSeconds,
        mustChangePassword: input.mustChangePassword,
      },
    };
  }
}
