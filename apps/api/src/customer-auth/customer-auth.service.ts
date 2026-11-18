import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CustomerTokenResponse } from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import { AuditService } from '../audit/audit.service.js';
import { TokenService, generateOpaqueToken, hashToken } from '../auth/token.service.js';
import { AppException } from '../common/app-exception.js';
import { currentRequestContext } from '../common/request-context.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CustomersService } from '../customers/customers.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

const DAY_MS = 86_400_000;
/** Cap on codes sent to one number per hour (SMS-pumping defence). */
const MAX_CODES_PER_HOUR = 5;

function otpInvalid(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    'OTP_INVALID',
    'The code is incorrect or has expired. Request a new code.',
  );
}

function invalidToken(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    'INVALID_TOKEN',
    'Session expired. Sign in again.',
  );
}

@Injectable()
export class CustomerAuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(OTP_PROVIDER) private readonly otp: OtpProvider,
    private readonly tokens: TokenService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  private codeHash(organizationId: string, phoneE164: string, code: string): string {
    return createHmac('sha256', this.env.OTP_PEPPER)
      .update(`${organizationId}|${phoneE164}|${code}`)
      .digest('hex');
  }

  private async organizationByCode(code: string) {
    return this.prisma.organization.findFirst({
      where: { code: code.toUpperCase(), isActive: true },
      select: { id: true },
    });
  }

  /**
   * Sends a code. Always answers the same way (unknown organization, throttled
   * or not) so the endpoint cannot be used to discover registered numbers.
   */
  async requestCode(
    organizationCode: string,
    rawPhone: string,
  ): Promise<{ sent: true; expiresInSeconds: number }> {
    const response = { sent: true as const, expiresInSeconds: this.env.OTP_TTL_SECONDS };
    const organization = await this.organizationByCode(organizationCode);
    if (!organization) return response;
    const phone = await this.customers.phone(organization.id, rawPhone, 'phone');

    const now = Date.now();
    const recent = await this.prisma.customerOtpChallenge.findMany({
      where: {
        organizationId: organization.id,
        phoneE164: phone.e164,
        createdAt: { gt: new Date(now - 3_600_000) },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const last = recent[0]?.createdAt.getTime();
    if (
      recent.length >= MAX_CODES_PER_HOUR ||
      (last !== undefined && now - last < this.env.OTP_RESEND_INTERVAL_SECONDS * 1000)
    ) {
      return response;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.$transaction(async (tx) => {
      // A new code supersedes older unused ones.
      await tx.customerOtpChallenge.updateMany({
        where: { organizationId: organization.id, phoneE164: phone.e164, consumedAt: null },
        data: { consumedAt: new Date(now) },
      });
      await tx.customerOtpChallenge.create({
        data: {
          organizationId: organization.id,
          phoneE164: phone.e164,
          codeHash: this.codeHash(organization.id, phone.e164, code),
          expiresAt: new Date(now + this.env.OTP_TTL_SECONDS * 1000),
        },
      });
    });
    await this.otp.send(phone.e164, code);
    return response;
  }

  async verifyCode(
    organizationCode: string,
    rawPhone: string,
    code: string,
    fullName: string | undefined,
  ): Promise<CustomerTokenResponse> {
    const organization = await this.organizationByCode(organizationCode);
    if (!organization) throw otpInvalid();
    const phone = await this.customers.phone(organization.id, rawPhone, 'phone');
    const now = new Date();

    const challenge = await this.prisma.customerOtpChallenge.findFirst({
      where: {
        organizationId: organization.id,
        phoneE164: phone.e164,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= this.env.OTP_MAX_ATTEMPTS) throw otpInvalid();

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.codeHash(organization.id, phone.e164, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await this.prisma.customerOtpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw otpInvalid();
    }

    const matches = await this.prisma.customer.findMany({
      where: { organizationId: organization.id, phoneE164: phone.e164, status: 'ACTIVE' },
      select: { id: true },
      take: 2,
    });
    if (matches.length > 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'ACCOUNT_AMBIGUOUS',
        'More than one customer record uses this number. Please contact the service centre.',
      );
    }
    if (matches.length === 0 && !fullName) {
      // Code is correct but not consumed, so the app can resubmit with a name.
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'PROFILE_REQUIRED',
        'Enter your name to create your account',
        [{ path: 'fullName', message: 'Required for new customers' }],
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.customerOtpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) throw otpInvalid();

      const customerId =
        matches[0]?.id ??
        (
          await this.customers.createInTx(
            tx,
            { organizationId: organization.id, userId: null, source: 'CUSTOMER_APP' },
            { type: 'INDIVIDUAL', name: fullName ?? '', phone: phone.e164, consents: [] },
          )
        ).id;

      const issued = await this.createSession(tx, customerId, organization.id);
      await this.audit.record(tx, {
        organizationId: organization.id,
        actorUserId: null,
        action: 'customer.signed_in',
        entityType: 'customer',
        entityId: customerId,
        after: { newCustomer: matches.length === 0 },
      });
      return issued;
    });
  }

  async refresh(rawToken: string): Promise<CustomerTokenResponse> {
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        select: {
          id: true,
          usedAt: true,
          expiresAt: true,
          session: {
            select: {
              id: true,
              subjectType: true,
              revokedAt: true,
              expiresAt: true,
              customer: { select: { id: true, organizationId: true, status: true } },
            },
          },
        },
      });
      const customer = token?.session.customer;
      // Staff refresh tokens are never accepted here.
      if (!token || !customer || token.session.subjectType !== 'CUSTOMER') return null;
      const { session } = token;

      const claimed =
        token.usedAt === null &&
        (
          await tx.refreshToken.updateMany({
            where: { id: token.id, usedAt: null },
            data: { usedAt: now },
          })
        ).count === 1;
      if (!claimed) {
        if (session.revokedAt === null) {
          await tx.authSession.update({
            where: { id: session.id },
            data: { revokedAt: now, revokedReason: 'REFRESH_TOKEN_REUSE' },
          });
          await this.audit.record(tx, {
            organizationId: customer.organizationId,
            actorUserId: null,
            actorType: 'SYSTEM',
            action: 'auth.refresh_token.reuse_detected',
            entityType: 'auth_session',
            entityId: session.id,
            after: { customerId: customer.id },
          });
        }
        return null;
      }
      if (
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        token.expiresAt <= now ||
        customer.status !== 'ACTIVE'
      ) {
        return null;
      }
      await tx.authSession.update({ where: { id: session.id }, data: { lastUsedAt: now } });
      return this.issueTokens(
        tx,
        session.id,
        session.expiresAt,
        customer.id,
        customer.organizationId,
      );
    });
    if (!outcome) throw invalidToken();
    return outcome;
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        select: {
          session: {
            select: {
              id: true,
              subjectType: true,
              revokedAt: true,
              customer: { select: { id: true, organizationId: true } },
            },
          },
        },
      });
      const customer = token?.session.customer;
      if (
        !token ||
        !customer ||
        token.session.subjectType !== 'CUSTOMER' ||
        token.session.revokedAt !== null
      )
        return;
      await tx.authSession.update({
        where: { id: token.session.id },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      await this.audit.record(tx, {
        organizationId: customer.organizationId,
        actorUserId: null,
        action: 'customer.signed_out',
        entityType: 'customer',
        entityId: customer.id,
      });
    });
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    customerId: string,
    organizationId: string,
  ): Promise<CustomerTokenResponse> {
    const context = currentRequestContext();
    const storeClient = this.env.AUDIT_STORE_CLIENT_METADATA;
    const expiresAt = new Date(Date.now() + this.env.CUSTOMER_SESSION_ABSOLUTE_TTL_DAYS * DAY_MS);
    const session = await tx.authSession.create({
      data: {
        subjectType: 'CUSTOMER',
        customerId,
        expiresAt,
        ipAddress: storeClient ? context.ipAddress : null,
        userAgent: storeClient ? context.userAgent : null,
      },
      select: { id: true },
    });
    return this.issueTokens(tx, session.id, expiresAt, customerId, organizationId);
  }

  private async issueTokens(
    tx: Prisma.TransactionClient,
    sessionId: string,
    sessionExpiresAt: Date,
    customerId: string,
    organizationId: string,
  ): Promise<CustomerTokenResponse> {
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = new Date(
      Math.min(
        Date.now() + this.env.CUSTOMER_REFRESH_TOKEN_IDLE_TTL_DAYS * DAY_MS,
        sessionExpiresAt.getTime(),
      ),
    );
    await tx.refreshToken.create({
      data: { sessionId, tokenHash: hashToken(refreshToken), expiresAt: refreshExpiresAt },
    });
    return {
      accessToken: await this.tokens.signCustomerAccessToken({
        customerId,
        sessionId,
        organizationId,
      }),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }
}
