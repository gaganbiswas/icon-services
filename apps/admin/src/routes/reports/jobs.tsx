import { JOB_STATUSES, type JobRegisterRow, type Page } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { ExportButtons } from '../../components/ExportButtons';
import { SelectField } from '../../components/Inputs';
import { PeriodFilter, toPeriod, usePeriod } from '../../components/PeriodFilter';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { statusLabel } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/reports/jobs')({
  component: () => (
    <RequireAuth>
      <AppShell title="Job register">
        <JobRegister />
      </AppShell>
    </RequireAuth>
  ),
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export function JobRegister() {
  const { client } = useAuth();
  const { fields, setFields } = usePeriod(30);
  const [status, setStatus] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [page, setPage] = useState(1);
  const period = toPeriod(fields.from, fields.to, fields.branchId);
  const query = {
    from: period.from,
    to: period.to,
    branchId: period.branchId,
    status: status || undefined,
    serviceType: serviceType || undefined,
  };
  const data = useResource(
    () => client.get<Page<JobRegisterRow>>('/reports/jobs', { ...query, page, pageSize: 50 }),
    [client, query.from, query.to, query.branchId, query.status, query.serviceType, page],
  );
  return (
    <>
      <PeriodFilter
        fields={fields}
        onChange={(next) => {
          setPage(1);
          setFields(next);
        }}
      />
      <div className="grid-2">
        <SelectField
          id="status"
          label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">Any</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="serviceType"
          label="Service type"
          value={serviceType}
          onChange={(e) => {
            setPage(1);
            setServiceType(e.target.value);
          }}
        >
          <option value="">Any</option>
          <option value="IN_WARRANTY">In warranty</option>
          <option value="OUT_OF_WARRANTY">Out of warranty</option>
          <option value="WARRANTY_UNVERIFIED">Warranty not yet verified</option>
        </SelectField>
      </div>
      <ExportButtons report="jobs" query={query} />
      <ResourceView resource={data}>
        {(p) =>
          p.items.length === 0 ? (
            <p className="muted">No jobs match these filters.</p>
          ) : (
            <>
              <p className="muted small">
                {p.total} job(s) · page {p.page} of {Math.max(1, Math.ceil(p.total / p.pageSize))}
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Job</th>
                      <th scope="col">Received</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Device</th>
                      <th scope="col">Status</th>
                      <th scope="col">Technicians</th>
                      <th scope="col">Completed</th>
                      <th scope="col">Delivered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link to="/jobs/$jobId" params={{ jobId: r.id }}>
                            {r.jobNumber}
                          </Link>
                        </td>
                        <td>{when(r.receivedAt)}</td>
                        <td>{r.customerName}</td>
                        <td>
                          {r.category} · {r.device}
                          {r.serialNumber ? ` · ${r.serialNumber}` : ''}
                        </td>
                        <td>{statusLabel(r.status)}</td>
                        <td>{r.technicians || '—'}</td>
                        <td>{when(r.completedAt)}</td>
                        <td>{when(r.deliveredAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={p.page <= 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={p.page * p.pageSize >= p.total}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )
        }
      </ResourceView>
    </>
  );
}
