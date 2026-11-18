import { useCallback, useEffect, useState } from 'react';

import { formMessage } from './form-errors';

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'ready'; data: T; reload: () => void };

/** Minimal data loader with loading, error and retry states (CLAUDE.md §5). */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }
  >({
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: formMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass explicit deps
  }, [...deps, attempt]);

  if (state.status === 'error') return { ...state, retry: reload };
  if (state.status === 'ready') return { ...state, reload };
  return state;
}
