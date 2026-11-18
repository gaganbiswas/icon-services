import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@icon/database';

import type { CustomerTokenClaims } from '../auth/token.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import type { CustomerPrincipal } from './customer-principal.js';

@Injectable()
export class CustomerPrincipalLoader {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async load(claims: CustomerTokenClaims): Promise<CustomerPrincipal | null> {
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sessionId,
        subjectType: 'CUSTOMER',
        customerId: claims.customerId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        customer: {
          organizationId: claims.organizationId,
          status: 'ACTIVE',
          organization: { isActive: true },
        },
      },
      select: { id: true },
    });
    return session
      ? {
          customerId: claims.customerId,
          sessionId: session.id,
          organizationId: claims.organizationId,
        }
      : null;
  }
}
