import type { Notification, Page } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { SelectField } from '../../components/Inputs';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { formMessage } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/notifications/')({
  component: () => (
    <RequireAuth>
      <NotificationCentre />
    </RequireAuth>
  ),
});

/** Notification centre: queued/failed messages and manual retry (CLAUDE.md §5). */
export function NotificationCentre() {
  const { client } = useAuth();
  const canRetry = useCan('notifications.retry');
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const list = useResource(
    () => client.get<Page<Notification>>('/notifications', { status, pageSize: 100 }),
    [client, status, revision],
  );

  async function retry(id: string) {
    setError(null);
    try {
      await client.post(`/notifications/${id}/retry`);
      setRevision((n) => n + 1);
    } catch (caught) {
      setError(formMessage(caught));
    }
  }

  return (
    <AppShell title="Notifications">
      <p className="muted small">
        “Accepted” means the provider took the message; it is not proof of delivery. Providers are
        mocked until WhatsApp and email services are chosen.
      </p>
      <SelectField
        id="status"
        label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">All</option>
        <option value="FAILED">Failed (retrying)</option>
        <option value="DEAD">Gave up</option>
        <option value="PENDING">Pending</option>
        <option value="COMPLETED">Completed</option>
        <option value="SKIPPED">Skipped (no consent / address)</option>
      </SelectField>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <ResourceView resource={list}>
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">No notifications.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Status</th>
                    <th scope="col">Channels</th>
                    <th scope="col">Created</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((n) => (
                    <tr key={n.id}>
                      <td>
                        {n.eventType.replace(/_/g, ' ').toLowerCase()}
                        {n.jobId ? (
                          <>
                            {' '}
                            ·{' '}
                            <Link to="/jobs/$jobId" params={{ jobId: n.jobId }}>
                              job
                            </Link>
                          </>
                        ) : null}
                      </td>
                      <td>
                        {n.status.toLowerCase()} (attempts {n.attempts})
                      </td>
                      <td>
                        {n.deliveries
                          .map(
                            (d) =>
                              `${d.channel.toLowerCase()}: ${d.status.toLowerCase().replace(/_/g, ' ')}`,
                          )
                          .join('; ') || '—'}
                      </td>
                      <td>{new Date(n.createdAt).toLocaleString()}</td>
                      <td>
                        {canRetry && (n.status === 'FAILED' || n.status === 'DEAD') ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void retry(n.id)}
                          >
                            Retry
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ResourceView>
    </AppShell>
  );
}
