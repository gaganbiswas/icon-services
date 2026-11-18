import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionCode } from '@icon/contracts';
import type { Request } from 'express';

import type { Principal } from '../access/principal.js';

export const IS_PUBLIC = 'icon:isPublic';
export const REQUIRED_PERMISSIONS = 'icon:requiredPermissions';
export const ALLOW_PENDING_PASSWORD_CHANGE = 'icon:allowPendingPasswordChange';

/** Route needs no authentication. Use sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires every listed permission (checked server-side on each request). */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Route stays available while the user must change their password. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

const PRINCIPAL_KEY = Symbol('icon:principal');

type RequestWithPrincipal = Request & { [PRINCIPAL_KEY]?: Principal };

export function setPrincipal(request: Request, principal: Principal): void {
  (request as RequestWithPrincipal)[PRINCIPAL_KEY] = principal;
}

export function getPrincipal(request: Request): Principal | undefined {
  return (request as RequestWithPrincipal)[PRINCIPAL_KEY];
}

/** Injects the authenticated principal into a controller method. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = getPrincipal(context.switchToHttp().getRequest<Request>());
    if (!principal) {
      // Only reachable if a route is wrongly marked @Public() and uses this decorator.
      throw new Error('CurrentPrincipal used on a route without authentication');
    }
    return principal;
  },
);
