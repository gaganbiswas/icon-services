import type { TechnicianPerformanceRow } from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../../components/AppShell';
import { ExportButtons } from '../../components/ExportButtons';
import { PeriodFilter, usePeriod } from '../../components/PeriodFilter';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/reports/technicians')({
  component: () => (
    <RequireAuth>
      <AppShell title="Technician performance">
        <TechnicianReport />
      </AppShell>
    </RequireAuth>
  ),
});

export function TechnicianReport() {
  const { client } = useAuth();
  const { fields, setFields, period } = usePeriod(30);
  const data = useResource(
    () => client.get<TechnicianPerformanceRow[]>('/reports/technicians', { ...period }),
    [client, period.from, period.to, period.branchId],
  );
  return (
    <>
      <PeriodFilter fields={fields} onChange={setFields} />
      <ExportButtons report="technicians" query={{ ...period }} />
      <ResourceView resource={data}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted">No technician activity in this period.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Technician</th>
                    <th scope="col" className="num">
                      Open jobs
                    </th>
                    <th scope="col" className="num">
                      Completed
                    </th>
                    <th scope="col" className="num">
                      Average turnaround (h)
                    </th>
                    <th scope="col" className="num">
                      Median turnaround (h)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user.id}>
                      <td>{r.user.fullName}</td>
                      <td className="num">{r.openJobs}</td>
                      <td className="num">{r.completedJobs}</td>
                      <td className="num">{r.averageTurnaroundHours ?? '—'}</td>
                      <td className="num">{r.medianTurnaroundHours ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ResourceView>
      <p className="muted small">
        Turnaround is measured from receipt to repair completion for jobs completed in the period.
      </p>
    </>
  );
}
