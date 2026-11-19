import { Link, createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../components/AppShell';
import { Dashboard } from '../components/Dashboard';
import { RequireAuth } from '../components/RequireAuth';
import { useAuth } from '../lib/auth';
import { useCan } from '../lib/permissions';

export const Route = createFileRoute('/')({
  component: () => (
    <RequireAuth>
      <AppShell title="Home">
        <HomePage />
      </AppShell>
    </RequireAuth>
  ),
});

export function HomePage() {
  const { state } = useAuth();
  const canDashboard = useCan('reports.read');
  if (state.status !== 'authenticated') return null;
  const { me } = state;
  return (
    <>
      {canDashboard ? <Dashboard /> : null}
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">Signed in as {me.fullName}</h2>
        <dl className="summary">
          <dt>Organization</dt>
          <dd>{me.organization.displayName}</dd>
          <dt>Email</dt>
          <dd>{me.email}</dd>
          <dt>Roles</dt>
          <dd>{me.roles.map((r) => r.name).join(', ') || 'None'}</dd>
          <dt>Branches</dt>
          <dd>
            {me.branchAccess === 'ALL'
              ? 'All branches'
              : me.branchAccess.map((b) => b.name).join(', ') || 'None'}
          </dd>
        </dl>
        <p>
          <Link to="/change-password">Change password</Link>
        </p>
      </section>
    </>
  );
}
