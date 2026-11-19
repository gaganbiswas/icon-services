import { type OutstandingReport, formatMoney } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../../components/AppShell';
import { ExportButtons } from '../../components/ExportButtons';
import { PeriodFilter, usePeriod } from '../../components/PeriodFilter';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { statusLabel } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/reports/outstanding')({
  component: () => (
    <RequireAuth>
      <AppShell title="Outstanding balances">
        <OutstandingPage />
      </AppShell>
    </RequireAuth>
  ),
});

export function OutstandingPage() {
  const { client } = useAuth();
  const { fields, setFields } = usePeriod(30);
  const branchId = fields.branchId || undefined;
  const data = useResource(
    () => client.get<OutstandingReport>('/reports/outstanding', { branchId }),
    [client, branchId],
  );
  return (
    <>
      <PeriodFilter fields={fields} onChange={setFields} withDates={false} />
      <ExportButtons report="outstanding" query={{ branchId }} />
      <ResourceView resource={data}>
        {(r) => {
          const m = (v: string) => (r.currency ? formatMoney(v, r.currency) : v);
          return (
            <>
              <p className="muted small">
                Interim figures: approved estimate minus net payments on finished jobs, until
                invoicing is enabled. Age counts from repair completion.
              </p>
              <div className="tiles">
                <div className="tile">
                  <p className="tile-label">Total due</p>
                  <p className="tile-value">{m(r.total)}</p>
                </div>
                {r.buckets.map((b) => (
                  <div className="tile" key={b.bucket}>
                    <p className="tile-label">{b.bucket} days</p>
                    <p className="tile-value">{m(b.due)}</p>
                    <p className="muted small">{b.jobs} job(s)</p>
                  </div>
                ))}
              </div>
              {r.rows.length === 0 ? (
                <p className="muted">Nothing outstanding.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Job</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="num">
                          Approved
                        </th>
                        <th scope="col" className="num">
                          Paid
                        </th>
                        <th scope="col" className="num">
                          Due
                        </th>
                        <th scope="col" className="num">
                          Age (days)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row) => (
                        <tr key={row.jobId}>
                          <td>
                            <Link to="/jobs/$jobId" params={{ jobId: row.jobId }}>
                              {row.jobNumber}
                            </Link>
                          </td>
                          <td>{row.customerName}</td>
                          <td>{statusLabel(row.status)}</td>
                          <td className="num">{m(row.billed)}</td>
                          <td className="num">{m(row.paid)}</td>
                          <td className="num">{m(row.due)}</td>
                          <td className="num">{row.ageDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </ResourceView>
    </>
  );
}
