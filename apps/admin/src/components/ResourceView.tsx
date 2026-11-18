import type { ReactNode } from 'react';

import type { Resource } from '../lib/use-resource';

/** Renders loading / error-with-retry / data states consistently. */
export function ResourceView<T>({
  resource,
  children,
}: {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === 'loading') {
    return (
      <p className="muted" aria-busy="true">
        Loading…
      </p>
    );
  }
  if (resource.status === 'error') {
    return (
      <div role="alert" className="form-error-box">
        <p className="form-error">{resource.message}</p>
        <button type="button" className="secondary" onClick={resource.retry}>
          Try again
        </button>
      </div>
    );
  }
  return <>{children(resource.data)}</>;
}
