import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CustomerApi } from './api/client';
import { secureTokenStore } from './api/token-store';
import { config } from './config';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  readonly api: CustomerApi;
  readonly status: Status;
  readonly markSignedIn: () => void;
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

let defaultApi: CustomerApi | null = null;
function getDefaultApi(): CustomerApi {
  defaultApi ??= new CustomerApi(config.apiBaseUrl, config.organizationCode, secureTokenStore);
  return defaultApi;
}

export function SessionProvider({
  children,
  api: provided,
}: {
  children: ReactNode;
  api?: CustomerApi;
}) {
  const api = provided ?? getDefaultApi();
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;
    api.restore().then(
      (ok) => !cancelled && setStatus(ok ? 'signedIn' : 'signedOut'),
      () => !cancelled && setStatus('signedOut'),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setStatus('signedOut');
  }, [api]);

  const value = useMemo<SessionValue>(
    () => ({ api, status, markSignedIn: () => setStatus('signedIn'), signOut }),
    [api, status, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
