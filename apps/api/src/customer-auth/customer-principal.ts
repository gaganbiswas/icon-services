import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

/** Authenticated customer, resolved from the database on every request. */
export interface CustomerPrincipal {
  readonly customerId: string;
  readonly sessionId: string;
  readonly organizationId: string;
}

export const CUSTOMER_ROUTE = 'icon:customerRoute';

/** Route authenticated with a customer token instead of a staff token. */
export const CustomerRoute = () => SetMetadata(CUSTOMER_ROUTE, true);

const KEY = Symbol('icon:customerPrincipal');
type RequestWithCustomer = Request & { [KEY]?: CustomerPrincipal };

export function setCustomerPrincipal(request: Request, principal: CustomerPrincipal): void {
  (request as RequestWithCustomer)[KEY] = principal;
}

export const CurrentCustomer = createParamDecorator(
  (_: unknown, context: ExecutionContext): CustomerPrincipal => {
    const principal = (context.switchToHttp().getRequest<Request>() as RequestWithCustomer)[KEY];
    if (!principal) {
      throw new Error('CurrentCustomer used on a route without customer authentication');
    }
    return principal;
  },
);
