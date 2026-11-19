import { Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth';

/** Client-side routing only; the API enforces all authorization. */
export function RequireAuth({
  children,
  allowPendingPasswordChange = false,
  allowPendingMfaEnrollment = false,
}: {
  children: ReactNode;
  allowPendingPasswordChange?: boolean;
  allowPendingMfaEnrollment?: boolean;
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
  if (
    state.me.mfaEnrollmentRequired &&
    !allowPendingMfaEnrollment &&
    !state.me.mustChangePassword
  ) {
    return <Navigate to="/security" />;
  }
  return <>{children}</>;
}
