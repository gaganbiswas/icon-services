import type { JobSummary, Page } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../components/AppShell';
import { RequireAuth } from '../components/RequireAuth';
import { ResourceView } from '../components/ResourceView';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../lib/auth';
import { useResource } from '../lib/use-resource';

export const Route = createFileRoute('/my-jobs')({
  component: () => (
    <RequireAuth>
      <MyJobsPage />
    </RequireAuth>
  ),
});

/** Technician workspace: jobs currently assigned to me. */
export function MyJobsPage() {
  const { client } = useAuth();
  const jobs = useResource(
    () => client.get<Page<JobSummary>>('/jobs', { assignedToMe: 'true', pageSize: 100 }),
    [client],
  );
  return (
    <AppShell title="My assigned jobs">
      <ResourceView resource={jobs}>
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">No jobs are assigned to you.</p>
          ) : (
            <ul className="job-cards">
              {page.items.map((j) => (
                <li key={j.id} className="card">
                  <Link to="/jobs/$jobId" params={{ jobId: j.id }}>
                    <strong>{j.jobNumber}</strong>
                  </Link>{' '}
                  <StatusBadge status={j.status} />
                  <p>
                    {j.asset.category}: {j.asset.brand} {j.asset.model}
                  </p>
                  <p className="muted small">
                    {j.customer.name} · {j.branch.code}
                  </p>
                </li>
              ))}
            </ul>
          )
        }
      </ResourceView>
    </AppShell>
  );
}
