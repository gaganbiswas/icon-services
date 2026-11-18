import type { PermissionCode } from '@icon/contracts';

import { useAuth } from './auth';

/** UI convenience only — the API enforces every permission. */
export function useCan(permission: PermissionCode): boolean {
  const { state } = useAuth();
  return state.status === 'authenticated' && state.me.permissions.includes(permission);
}
