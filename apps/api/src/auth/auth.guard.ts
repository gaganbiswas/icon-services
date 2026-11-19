import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@icon/contracts';
import type { Request } from 'express';

import { holdsAll } from '../access/access-policy.js';
import { AppException } from '../common/app-exception.js';
import { CUSTOMER_ROUTE, setCustomerPrincipal } from '../customer-auth/customer-principal.js';
import { CustomerPrincipalLoader } from '../customer-auth/customer-principal.loader.js';
import {
  ALLOW_PENDING_MFA_ENROLLMENT,
  ALLOW_PENDING_PASSWORD_CHANGE,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  setPrincipal,
} from './decorators.js';
import { PrincipalLoader } from './principal.loader.js';
import { TokenService } from './token.service.js';

/**
 * Global guard: every route is authenticated unless marked @Public(), and
 * declared permissions are enforced on every request (CLAUDE.md §2).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalLoader,
    private readonly customers: CustomerPrincipalLoader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization');
    const match = header ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
    if (!match?.[1]) {
      throw AppException.unauthenticated();
    }

    if (this.reflector.getAllAndOverride<boolean>(CUSTOMER_ROUTE, targets)) {
      const customerClaims = await this.tokens.verifyCustomerAccessToken(match[1]);
      const customer = customerClaims ? await this.customers.load(customerClaims) : null;
      if (!customer) {
        throw AppException.unauthenticated('Session expired or invalid');
      }
      setCustomerPrincipal(request, customer);
      return true;
    }

    const claims = await this.tokens.verifyAccessToken(match[1]);
    const principal = claims ? await this.principals.load(claims) : null;
    if (!principal) {
      throw AppException.unauthenticated('Session expired or invalid');
    }
    setPrincipal(request, principal);

    if (
      principal.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, targets)
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'PASSWORD_CHANGE_REQUIRED',
        'You must change your password before continuing',
      );
    }

    if (
      principal.mfaEnrollmentRequired &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_MFA_ENROLLMENT, targets)
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'MFA_ENROLLMENT_REQUIRED',
        'Set up two-step sign-in before continuing',
      );
    }

    const required =
      this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (!holdsAll(principal, required)) {
      throw AppException.forbidden();
    }
    return true;
  }
}
