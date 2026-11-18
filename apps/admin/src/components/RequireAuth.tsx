import { Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth';

/** Client-side routing only; the API enforces all authorization. */
export function RequireAuth({
  children,
  allowPendingPasswordChange = false,
}: {
  children: ReactNode;
  allowPendingPasswordChange?: boolean;
}) {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return (
      <main aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (state.status === 'anonymous') {
    return <Navigate to="/login" />;
  }
  if (state.me.mustChangePassword && !allowPendingPasswordChange) {
    return <Navigate to="/change-password" />;
  }
  return <>{children}</>;
}
