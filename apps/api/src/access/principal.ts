import type { PermissionCode } from '@icon/contracts';

/** Authenticated staff user, resolved from the database on every request. */
export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly fullName: string;
  readonly mustChangePassword: boolean;
  readonly roleIds: ReadonlySet<string>;
  readonly permissions: ReadonlySet<PermissionCode>;
  /** 'ALL' when the user holds `branches.all`; otherwise explicit branch IDs. */
  readonly branchAccess: 'ALL' | ReadonlySet<string>;
}
