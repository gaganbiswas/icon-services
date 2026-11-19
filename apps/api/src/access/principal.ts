import type { PermissionCode } from '@icon/contracts';

/** Authenticated staff user, resolved from the database on every request. */
export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly fullName: string;
  readonly mustChangePassword: boolean;
  /** Privileged user who has not set up MFA while it is enforced (ADR 0011). */
  readonly mfaEnrollmentRequired: boolean;
  readonly mfaEnabled: boolean;
  readonly roleIds: ReadonlySet<string>;
  readonly permissions: ReadonlySet<PermissionCode>;
  /** 'ALL' when the user holds `branches.all`; otherwise explicit branch IDs. */
  readonly branchAccess: 'ALL' | ReadonlySet<string>;
}
