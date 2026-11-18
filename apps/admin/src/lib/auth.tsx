import type { MeResponse } from '@icon/contracts';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { type ApiClient, apiClient } from './api-client';

type AuthState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; me: MeResponse };

interface AuthContextValue {
  readonly state: AuthState;
  readonly client: ApiClient;
  readonly signIn: (email: string, password: string) => Promise<MeResponse>;
  readonly signOut: () => Promise<void>;
  readonly reload: () => Promise<void>;
}

/** Resolves the current session (restoring it from the refresh cookie if needed). */
async function resolveSession(client: ApiClient): Promise<AuthState> {
  try {
    const restored = client.isAuthenticated || (await client.refresh()) !== null;
    return restored ? { status: 'authenticated', me: await client.me() } : { status: 'anonymous' };
  } catch {
    return { status: 'anonymous' };
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  client = apiClient,
}: {
  children: ReactNode;
  client?: ApiClient;
}) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const reload = useCallback(async () => {
    setState(await resolveSession(client));
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void resolveSession(client).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      client,
      reload,
      signIn: async (email, password) => {
        await client.login(email, password);
        const me = await client.me();
        setState({ status: 'authenticated', me });
        return me;
      },
      signOut: async () => {
        await client.logout().catch(() => undefined);
        setState({ status: 'anonymous' });
      },
    }),
    [state, client, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
