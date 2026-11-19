import type { Delivery, Page } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../../components/AppShell';
import { ExportButtons } from '../../components/ExportButtons';
import { PeriodFilter, usePeriod } from '../../components/PeriodFilter';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/deliveries/')({
  component: () => (
    <RequireAuth>
      <DeliveryRegister />
    </RequireAuth>
  ),
});

/** Delivery register (CLAUDE.md §4.12). */
export function DeliveryRegister() {
  const { client } = useAuth();
  const { fields, setFields, period } = usePeriod(30);
  const list = useResource(
    () => client.get<Page<Delivery>>('/deliveries', { ...period, pageSize: 100 }),
    [client, period.from, period.to, period.branchId],
  );
  return (
    <AppShell title="Deliveries">
      <PeriodFilter fields={fields} onChange={setFields} />
      <ExportButtons report="deliveries" query={{ ...period }} />
      <ResourceView resource={list}>
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">No deliveries in this period.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Challan</th>
                    <th scope="col">Job</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Status</th>
                    <th scope="col">Recipient</th>
                    <th scope="col">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((d) => (
                    <tr key={d.id}>
                      <td>{d.challanNumber}</td>
                      <td>
                        <Link to="/jobs/$jobId" params={{ jobId: d.jobId }}>
                          {d.jobNumber}
                        </Link>
                      </td>
                      <td>{d.mode.replace(/_/g, ' ').toLowerCase()}</td>
                      <td>
                        {d.status.toLowerCase()}
                        {d.dueOverride ? ' (balance due approved)' : ''}
                      </td>
                      <td>{d.recipientName ?? '—'}</td>
                      <td>
                        {new Date(d.deliveredAt ?? d.dispatchedAt ?? d.createdAt).toLocaleString()}
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
