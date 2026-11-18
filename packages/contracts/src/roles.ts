import { PERMISSION_CODES, type PermissionCode } from './permissions.js';

/** Codes of the seeded system roles (CLAUDE.md §2). */
export const SYSTEM_ROLE_CODES = [
  'SUPER_ADMIN',
  'BRANCH_ADMIN',
  'RECEPTION',
  'TECHNICIAN',
  'ACCOUNTS',
  'DELIVERY',
  'CUSTOMER',
  'AUDITOR',
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export interface SystemRoleDefinition {
  readonly code: SystemRoleCode;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly PermissionCode[];
}

const readOnly = PERMISSION_CODES.filter((code) => code.endsWith('.read'));

/**
 * Default permission sets. These are seeded once per organization; afterwards
 * administrators with `roles.manage` may change them (except SUPER_ADMIN).
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'All branches, settings, users, audit and configuration.',
    permissions: PERMISSION_CODES,
  },
  {
    code: 'BRANCH_ADMIN',
    name: 'Branch Admin / Manager',
    description: 'Branch operations, approvals, reports, staff and jobs.',
    permissions: PERMISSION_CODES.filter(
      (code) =>
        ![
          'roles.manage',
          'branches.manage',
          'branches.all',
          'settings.manage',
          'inventory.negative_override',
        ].includes(code),
    ),
  },
  {
    code: 'RECEPTION',
    name: 'Reception',
    description: 'Customers, devices, intake, job receipts and customer communication.',
    permissions: [
      'branches.read',
      'customers.read',
      'customers.write',
      'assets.read',
      'assets.write',
      'jobs.read',
      'jobs.create',
      'jobs.update',
      'estimates.read',
      'deliveries.read',
      'notifications.read',
    ],
  },
  {
    code: 'TECHNICIAN',
    name: 'Technician',
    description: 'Assigned jobs, diagnosis, internal notes, parts used and progress.',
    permissions: [
      'branches.read',
      'customers.read',
      'assets.read',
      'jobs.read',
      'jobs.transition',
      'jobs.internal_notes.read',
      'jobs.internal_notes.write',
      'diagnosis.write',
      'worklogs.write',
      'estimates.read',
      'estimates.write',
      'inventory.read',
    ],
  },
  {
    code: 'ACCOUNTS',
    name: 'Accounts',
    description: 'Estimates where allowed, invoices, credit notes, payments and reports.',
    permissions: [
      'branches.read',
      'customers.read',
      'assets.read',
      'jobs.read',
      'estimates.read',
      'estimates.write',
      'invoices.read',
      'invoices.write',
      'invoices.issue',
      'credit_notes.issue',
      'payments.read',
      'payments.record',
      'payments.refund',
      'deliveries.read',
      'reports.read',
      'reports.export',
    ],
  },
  {
    code: 'DELIVERY',
    name: 'Delivery Staff',
    description: 'Delivery assignment, hand-over checklist, signature/proof.',
    permissions: [
      'branches.read',
      'customers.read',
      'assets.read',
      'jobs.read',
      'deliveries.read',
      'deliveries.write',
      'deliveries.complete',
    ],
  },
  {
    code: 'CUSTOMER',
    name: 'Customer',
    description:
      'Customer principals. Holds no staff permissions; customer access is limited to the authenticated customer’s own records.',
    permissions: [],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor / Read Only',
    description: 'Read permitted records and the audit trail.',
    // Every `*.read` permission, which includes `jobs.internal_notes.read`.
    permissions: readOnly,
  },
];
