import { useCallback, useEffect, useState } from 'react';

import { errorMessage } from './api/client';

export type Loaded<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (error: unknown) => !cancelled && setState({ status: 'error', message: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit deps from caller
  }, [...deps, attempt]);
  return [state, reload];
}
