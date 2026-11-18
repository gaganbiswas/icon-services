import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { useCan } from '../lib/permissions';

export function AppShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { state, signOut } = useAuth();
  const canJobs = useCan('jobs.read');
  const canCustomers = useCan('customers.read');
  const canCreateJob = useCan('jobs.create');
  const canWork = useCan('worklogs.write');
  const canNotifications = useCan('notifications.read');
  const canInventory = useCan('inventory.read');
  const canReports = useCan('reports.read');
  const canPayments = useCan('payments.read');
  const canCollections = canReports && canPayments;
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          ICON Service
        </Link>
        <nav aria-label="Main">
          <ul>
            {canJobs ? (
              <li>
                <Link to="/jobs" activeProps={{ 'aria-current': 'page' }}>
                  Jobs
                </Link>
              </li>
            ) : null}
            {canWork ? (
              <li>
                <Link to="/my-jobs" activeProps={{ 'aria-current': 'page' }}>
                  My jobs
                </Link>
              </li>
            ) : null}
            {canCreateJob ? (
              <li>
                <Link to="/jobs/new" activeProps={{ 'aria-current': 'page' }}>
                  New job
                </Link>
              </li>
            ) : null}
            {canCustomers ? (
              <li>
                <Link to="/customers" activeProps={{ 'aria-current': 'page' }}>
                  Customers
                </Link>
              </li>
            ) : null}
            {canInventory ? (
              <li>
                <Link to="/inventory" activeProps={{ 'aria-current': 'page' }}>
                  Inventory
                </Link>
              </li>
            ) : null}
            {canCollections ? (
              <li>
                <Link to="/reports/collections" activeProps={{ 'aria-current': 'page' }}>
                  Collections
                </Link>
              </li>
            ) : null}
            {canNotifications ? (
              <li>
                <Link to="/notifications" activeProps={{ 'aria-current': 'page' }}>
                  Notifications
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
        <div className="account">
          {state.status === 'authenticated' ? (
            <span className="muted small">{state.me.fullName}</span>
          ) : null}
          <button type="button" className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        <div className="page-header">
          <h1>{title}</h1>
          {actions ? <div className="actions">{actions}</div> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
