/**
 * Permission catalogue (CLAUDE.md §2). Codes are stable identifiers stored in
 * the database; add new codes here and seed them — never rename existing ones.
 * Several codes are reserved for features delivered in later phases so that
 * roles can be configured up front.
 */
export const PERMISSIONS = {
  // Identity & administration
  'users.read': 'View staff users',
  'users.manage': 'Create, update, deactivate staff users and issue password set-up links',
  'roles.read': 'View roles and permissions',
  'roles.manage': 'Create roles and change role permissions',
  'branches.read': 'View branches the user can access',
  'branches.manage': 'Create and update branches',
  'branches.all': 'Access every branch of the organization',
  'audit.read': 'View the audit log',
  'settings.read': 'View business settings',
  'settings.manage': 'Change business, tax, numbering and template settings',
  // Customers & assets
  'customers.read': 'View customers',
  'customers.write': 'Create and update customers and consents',
  'assets.read': 'View customer devices',
  'assets.write': 'Create and update customer devices',
  // Jobs & workflow
  'jobs.read': 'View service jobs',
  'jobs.create': 'Register service jobs (intake)',
  'jobs.update': 'Update job details',
  'jobs.assign': 'Assign technicians to jobs',
  'jobs.transition': 'Change job status',
  'jobs.reopen': 'Reopen completed or delivered jobs',
  'jobs.internal_notes.read': 'Read internal technician notes',
  'jobs.internal_notes.write': 'Write internal technician notes',
  'warranty.verify': 'Record warranty verification outcomes',
  'diagnosis.write': 'Record diagnoses',
  'worklogs.write': 'Record work logs and parts usage',
  // Estimates
  'estimates.read': 'View estimates',
  'estimates.write': 'Prepare estimates',
  'estimates.send': 'Send estimates to customers',
  // Inventory
  'inventory.read': 'View parts and stock',
  'inventory.write': 'Manage parts and receive stock',
  'inventory.adjust': 'Adjust and transfer stock',
  'inventory.negative_override': 'Allow stock to go negative (audited)',
  // Billing
  'invoices.read': 'View invoices',
  'invoices.write': 'Prepare draft invoices',
  'invoices.issue': 'Issue invoices',
  'invoices.void': 'Void invoices',
  'credit_notes.issue': 'Issue credit notes',
  'payments.read': 'View payments',
  'payments.record': 'Record payments and print receipts',
  'payments.refund': 'Refund or reverse payments',
  // Delivery
  'deliveries.read': 'View deliveries',
  'deliveries.write': 'Prepare deliveries and challans',
  'deliveries.complete': 'Complete hand-over',
  'deliveries.due_override': 'Approve delivery with balance due',
  // Notifications & reports
  'notifications.read': 'View notification status',
  'notifications.retry': 'Retry failed notifications',
  'reports.read': 'View reports and dashboards',
  'reports.export': 'Export reports',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value);
}

/** Holding any of these makes MFA mandatory when enforcement is on (ADR 0011). */
export const MFA_PRIVILEGED_PERMISSIONS = [
  'roles.manage',
  'users.manage',
  'settings.manage',
  'invoices.issue',
  'invoices.void',
  'credit_notes.issue',
  'payments.refund',
  'branches.all',
] as const satisfies readonly PermissionCode[];
