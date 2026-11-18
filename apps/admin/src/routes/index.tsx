import { Link, createFileRoute } from '@tanstack/react-router';

import { RequireAuth } from '../components/RequireAuth';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/')({
  component: () => (
    <RequireAuth>
      <HomePage />
    </RequireAuth>
  ),
});

export function HomePage() {
  const { state, signOut } = useAuth();
  if (state.status !== 'authenticated') return null;
  const { me } = state;
  return (
    <main>
      <header className="page-header">
        <div>
          <h1>ICON INFOSYS SERVICE MANAGEMENT</h1>
          <p className="muted">Staff admin panel · {me.organization.displayName}</p>
        </div>
        <button type="button" className="secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">Signed in as {me.fullName}</h2>
        <dl className="summary">
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
      <p className="muted">Customer, job and intake screens will be added in Phase 3.</p>
    </main>
  );
}
