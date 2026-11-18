import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string;
}

export interface CustomerTokenClaims {
  readonly customerId: string;
  readonly sessionId: string;
  readonly organizationId: string;
}

/** 256-bit random opaque token, URL-safe. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest. Opaque tokens are stored only as hashes. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  get accessTokenTtlSeconds(): number {
    return this.env.ACCESS_TOKEN_TTL_SECONDS;
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId, org: claims.organizationId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Customer access token: separate audience, so it never authorizes staff routes. */
  async signCustomerAccessToken(claims: CustomerTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId, org: claims.organizationId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.customerId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.CUSTOMER_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyCustomerAccessToken(token: string): Promise<CustomerTokenClaims | null> {
    const claims = await this.verify(token, this.env.CUSTOMER_JWT_AUDIENCE);
    return claims
      ? {
          customerId: claims.subject,
          sessionId: claims.sessionId,
          organizationId: claims.organizationId,
        }
      : null;
  }

  /** Returns the claims, or null for any invalid, expired or malformed token. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    const claims = await this.verify(token, this.env.JWT_AUDIENCE);
    return claims
      ? {
          userId: claims.subject,
          sessionId: claims.sessionId,
          organizationId: claims.organizationId,
        }
      : null;
  }

  private async verify(
    token: string,
    audience: string,
  ): Promise<{ subject: string; sessionId: string; organizationId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.env.JWT_ISSUER,
        audience,
        requiredClaims: ['sub', 'sid', 'org', 'exp', 'iat'],
      });
      const { sub, sid, org } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string' || typeof org !== 'string') {
        return null;
      }
      return { subject: sub, sessionId: sid, organizationId: org };
    } catch (error) {
      if (error instanceof joseErrors.JOSEError) {
        return null;
      }
      throw error;
    }
  }
}
