import { JOB_STATUSES, type JobStatus, type JobSummary, type Page } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { FormField } from '../../components/FormField';
import { SelectField } from '../../components/Inputs';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { StatusBadge, statusLabel } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { formText } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/jobs/')({
  component: () => (
    <RequireAuth>
      <JobsPage />
    </RequireAuth>
  ),
});

export function JobsPage() {
  const { client } = useAuth();
  const canCreate = useCan('jobs.create');
  const [filters, setFilters] = useState<{ q: string; status: string }>({ q: '', status: '' });
  const jobs = useResource(
    () =>
      client.get<Page<JobSummary>>('/jobs', { q: filters.q, status: filters.status, pageSize: 50 }),
    [client, filters.q, filters.status],
  );

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFilters({ q: formText(form, 'q').trim(), status: formText(form, 'status') });
  }

  return (
    <AppShell
      title="Jobs"
      actions={
        canCreate ? (
          <Link to="/jobs/new" className="button">
            New job
          </Link>
        ) : null
      }
    >
      <form role="search" onSubmit={onSearch} className="grid-2">
        <FormField id="q" label="Job number, customer name/mobile or serial number" type="search" />
        <SelectField id="status" label="Status" defaultValue="">
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s: JobStatus) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </SelectField>
        <div>
          <button type="submit">Search</button>
        </div>
      </form>
      <ResourceView resource={jobs}>
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">No jobs found.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <caption className="muted small">{page.total} job(s)</caption>
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Status</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Device</th>
                    <th scope="col">Branch</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <Link to="/jobs/$jobId" params={{ jobId: j.id }}>
                          {j.jobNumber}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={j.status} />
                      </td>
                      <td>
                        {j.customer.name}
                        <br />
                        <span className="muted small">{j.customer.phone}</span>
                      </td>
                      <td>
                        {j.asset.brand} {j.asset.model}
                        {j.asset.serialNumber ? (
                          <span className="muted small"> · {j.asset.serialNumber}</span>
                        ) : null}
                      </td>
                      <td>{j.branch.code}</td>
                      <td>{new Date(j.createdAt).toLocaleString()}</td>
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
