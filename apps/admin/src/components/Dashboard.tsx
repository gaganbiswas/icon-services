import { type Dashboard as DashboardData, formatMoney } from '@icon/contracts';
import { Link } from '@tanstack/react-router';

import { useAuth } from '../lib/auth';
import { useResource } from '../lib/use-resource';
import { ResourceView } from './ResourceView';
import { statusLabel } from './StatusBadge';

const SERVICE_TYPE_LABELS: Record<string, string> = {
  IN_WARRANTY: 'In warranty',
  OUT_OF_WARRANTY: 'Out of warranty',
  WARRANTY_UNVERIFIED: 'Warranty not yet verified',
};

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="tile">
      <p className="tile-label">{label}</p>
      <p className="tile-value">{value}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
    </div>
  );
}

/** Operational dashboard (CLAUDE.md §4.12). Figures come from GET /reports/dashboard. */
export function Dashboard() {
  const { client } = useAuth();
  const data = useResource(() => client.get<DashboardData>('/reports/dashboard'), [client]);
  return (
    <ResourceView resource={data}>
      {(d) => {
        const m = (v: string) => (d.currency ? formatMoney(v, d.currency) : v);
        return (
          <section aria-labelledby="dashboard-heading">
            <h2 id="dashboard-heading">Today</h2>
            <div className="tiles">
              <Tile label="New jobs today" value={d.newJobsToday} />
              <Tile
                label="Overdue jobs"
                value={d.overdueJobs}
                hint="Past the expected completion date"
              />
              <Tile label="Awaiting customer approval" value={d.awaitingApproval} />
              <Tile label="Waiting for parts" value={d.waitingForParts} />
              <Tile label="Repair completed" value={d.repairCompleted} />
              <Tile label="Ready for delivery" value={d.readyForDelivery} />
              <Tile label="Collected today" value={m(d.collectedToday)} hint="Net of refunds" />
              <Tile
                label="Collected this month"
                value={m(d.collectedThisMonth)}
                hint="Net of refunds"
              />
              <Tile
                label="Outstanding"
                value={m(d.outstanding.total)}
                hint={`${d.outstanding.jobs} job(s) · interim, from approved estimates`}
              />
            </div>
            <div className="grid-2">
              <section aria-labelledby="by-status-heading">
                <h3 id="by-status-heading">Jobs by status</h3>
                {d.jobsByStatus.length === 0 ? (
                  <p className="muted">No jobs yet.</p>
                ) : (
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Status</th>
                        <th scope="col" className="num">
                          Jobs
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.jobsByStatus.map((s) => (
                        <tr key={s.status}>
                          <td>{statusLabel(s.status)}</td>
                          <td className="num">{s.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section aria-labelledby="workload-heading">
                <h3 id="workload-heading">Technician workload</h3>
                {d.technicianWorkload.length === 0 ? (
                  <p className="muted">No open assignments.</p>
                ) : (
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Technician</th>
                        <th scope="col" className="num">
                          Open jobs
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.technicianWorkload.map((w) => (
                        <tr key={w.user.id}>
                          <td>{w.user.fullName}</td>
                          <td className="num">{w.openJobs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <h3>Warranty mix (last 30 days)</h3>
                {d.warrantyMix.length === 0 ? (
                  <p className="muted">No jobs in the last 30 days.</p>
                ) : (
                  <ul>
                    {d.warrantyMix.map((w) => (
                      <li key={w.serviceType}>
                        {SERVICE_TYPE_LABELS[w.serviceType] ?? w.serviceType}: {w.count}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <p className="muted small">
              Times use {d.timezone}. Updated {new Date(d.generatedAt).toLocaleTimeString()}.{' '}
              <Link to="/reports">All reports</Link>
            </p>
          </section>
        );
      }}
    </ResourceView>
  );
}
