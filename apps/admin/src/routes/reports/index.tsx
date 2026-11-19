import { Link, createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../../components/AppShell';
import { RequireAuth } from '../../components/RequireAuth';
import { useCan } from '../../lib/permissions';

export const Route = createFileRoute('/reports/')({
  component: () => (
    <RequireAuth>
      <ReportsIndex />
    </RequireAuth>
  ),
});

/** Lists only the reports the user may open (the API enforces the same rules). */
export function ReportsIndex() {
  const reports = useCan('reports.read');
  const jobs = useCan('jobs.read');
  const inventory = useCan('inventory.read');
  const payments = useCan('payments.read');
  const deliveries = useCan('deliveries.read');
  const items = [
    reports && jobs
      ? {
          to: '/reports/jobs',
          label: 'Job register',
          text: 'Jobs by date, status, branch, technician and category.',
        }
      : null,
    reports && jobs
      ? {
          to: '/reports/technicians',
          label: 'Technician performance',
          text: 'Open work, completed jobs and turnaround time.',
        }
      : null,
    reports && inventory
      ? {
          to: '/reports/parts',
          label: 'Parts usage and stock',
          text: 'Parts used, stock on hand and indicative value.',
        }
      : null,
    reports && payments
      ? {
          to: '/reports/collections',
          label: 'Collections',
          text: 'Payments by method and cashier.',
        }
      : null,
    reports && payments
      ? {
          to: '/reports/outstanding',
          label: 'Outstanding balances',
          text: 'Amounts due on finished jobs, with aging.',
        }
      : null,
    deliveries
      ? {
          to: '/deliveries',
          label: 'Delivery register',
          text: 'Dispatches and hand-overs with challan numbers.',
        }
      : null,
  ].filter((i) => i !== null);
  return (
    <AppShell title="Reports">
      {items.length === 0 ? (
        <p className="muted">You do not have access to any reports.</p>
      ) : (
        <ul className="link-list">
          {items.map((i) => (
            <li key={i.to}>
              <Link to={i.to}>{i.label}</Link> — <span className="muted">{i.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Invoice and tax summaries will be added with invoicing (Phase 7).
      </p>
    </AppShell>
  );
}
