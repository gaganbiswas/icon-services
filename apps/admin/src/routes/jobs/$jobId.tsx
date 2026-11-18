import type { DocumentLink, JobDetail, JobWorkspace, Notification, Page } from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { StatusBadge, statusLabel } from '../../components/StatusBadge';
import { Tabs } from '../../components/Tabs';
import { AssignmentsPanel } from '../../components/job/AssignmentsPanel';
import { EstimatesPanel } from '../../components/job/EstimatesPanel';
import { PartsPanel } from '../../components/job/PartsPanel';
import { ReceivePanel } from '../../components/job/ReceivePanel';
import { StatusPanel } from '../../components/job/StatusPanel';
import { CompletionPanel, DiagnosisPanel, WorkLogPanel } from '../../components/job/WorkPanels';
import { useCan } from '../../lib/permissions';
import { useAuth } from '../../lib/auth';
import { formMessage } from '../../lib/form-errors';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/jobs/$jobId')({
  component: () => (
    <RequireAuth>
      <JobDetailPage />
    </RequireAuth>
  ),
});

const TYPE_LABELS = {
  IN_WARRANTY: 'In warranty',
  OUT_OF_WARRANTY: 'Out of warranty',
  WARRANTY_UNVERIFIED: 'Warranty not yet verified',
} as const;
const MODE_LABELS = { AT_SERVICE_CENTRE: 'At service centre', ON_SITE: 'On-site' } as const;

/** New tab without a reference back to this page ("noopener" would return null). */
function openBlankTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

export function JobDetailPage() {
  const { jobId } = Route.useParams();
  const { client } = useAuth();
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  const job = useResource(() => client.get<JobDetail>(`/jobs/${jobId}`), [client, jobId, revision]);
  const workspace = useResource(
    () => client.get<JobWorkspace>(`/jobs/${jobId}/workspace`),
    [client, jobId, revision],
  );
  const canReceive = useCan('jobs.update');
  const canSeeNotifications = useCan('notifications.read');
  const canSeeEstimates = useCan('estimates.read');
  const notifications = useResource(
    () =>
      canSeeNotifications
        ? client.get<Page<Notification>>('/notifications', { jobId, pageSize: 50 })
        : Promise.resolve(null),
    [client, jobId, revision, canSeeNotifications],
  );
  const [printing, setPrinting] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  async function openReceipt(layout: 'A4' | 'THERMAL_80') {
    setPrinting(layout);
    setPrintError(null);
    // Open the tab synchronously (popup blockers), then point it at the signed URL.
    const tab = openBlankTab();
    try {
      const link = await client.post<DocumentLink>(`/jobs/${jobId}/receipt?layout=${layout}`);
      if (tab) tab.location.href = link.url;
      else window.location.assign(link.url);
    } catch (caught) {
      tab?.close();
      setPrintError(formMessage(caught));
    } finally {
      setPrinting(null);
    }
  }

  async function openAttachment(fileId: string) {
    const tab = openBlankTab();
    try {
      const { url } = await client.get<{ url: string }>(`/jobs/${jobId}/attachments/${fileId}/url`);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (caught) {
      tab?.close();
      setPrintError(formMessage(caught));
    }
  }

  return (
    <AppShell
      title="Job"
      actions={
        <>
          <button type="button" onClick={() => void openReceipt('A4')} disabled={printing !== null}>
            {printing === 'A4' ? 'Preparing…' : 'Print receipt (A4)'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void openReceipt('THERMAL_80')}
            disabled={printing !== null}
          >
            {printing === 'THERMAL_80' ? 'Preparing…' : 'Print receipt (80 mm)'}
          </button>
        </>
      }
    >
      {printError ? (
        <p role="alert" className="form-error">
          {printError}
        </p>
      ) : null}
      <ResourceView resource={job}>
        {(j) => (
          <Tabs
            tabs={[
              {
                id: 'overview',
                label: 'Overview',
                content: <Overview j={j} onOpenAttachment={(id) => void openAttachment(id)} />,
              },
              {
                id: 'work',
                label: 'Work',
                content: (
                  <ResourceView resource={workspace}>
                    {(ws) => (
                      <>
                        {j.status === 'AWAITING_DEVICE' && canReceive ? (
                          <section className="card" aria-labelledby="receive-heading">
                            <h2 id="receive-heading">Receive device</h2>
                            <ReceivePanel job={j} onReceived={refresh} />
                          </section>
                        ) : null}
                        <section className="card" aria-labelledby="status-heading">
                          <h2 id="status-heading">Status</h2>
                          <p>
                            Current: <StatusBadge status={j.status} />
                          </p>
                          <StatusPanel job={j} workspace={ws} onChanged={refresh} />
                        </section>
                        <section className="card" aria-labelledby="assign-heading">
                          <h2 id="assign-heading">Technicians</h2>
                          <AssignmentsPanel jobId={j.id} workspace={ws} onChanged={refresh} />
                        </section>
                        <section className="card" aria-labelledby="diag-heading">
                          <h2 id="diag-heading">Diagnosis</h2>
                          <DiagnosisPanel jobId={j.id} workspace={ws} onChanged={refresh} />
                        </section>
                        <section className="card" aria-labelledby="log-heading">
                          <h2 id="log-heading">Work log and customer updates</h2>
                          <WorkLogPanel jobId={j.id} workspace={ws} onChanged={refresh} />
                        </section>
                        <section className="card" aria-labelledby="done-heading">
                          <h2 id="done-heading">Repair completion</h2>
                          <CompletionPanel job={j} workspace={ws} onChanged={refresh} />
                        </section>
                      </>
                    )}
                  </ResourceView>
                ),
              },
              {
                id: 'parts',
                label: 'Parts',
                content: (
                  <ResourceView resource={workspace}>
                    {(ws) => <PartsPanel job={j} canWork={ws.canWork} />}
                  </ResourceView>
                ),
              },
              ...(canSeeEstimates
                ? [
                    {
                      id: 'estimates',
                      label: 'Estimates',
                      content: <EstimatesPanel job={j} onChanged={refresh} />,
                    },
                  ]
                : []),
              { id: 'timeline', label: 'Timeline', content: <Timeline j={j} /> },
              ...(canSeeNotifications
                ? [
                    {
                      id: 'notifications',
                      label: 'Notifications',
                      content: (
                        <ResourceView resource={notifications}>
                          {(page) => <NotificationList items={page?.items ?? []} />}
                        </ResourceView>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </ResourceView>
    </AppShell>
  );
}

function Overview({
  j,
  onOpenAttachment,
}: {
  j: JobDetail;
  onOpenAttachment: (fileId: string) => void;
}) {
  return (
    <>
      <section className="card" aria-labelledby="job-heading">
        <h2 id="job-heading">
          {j.jobNumber} <StatusBadge status={j.status} />
        </h2>
        <dl className="summary">
          <dt>Customer</dt>
          <dd>
            {j.customer.name} ({j.customer.customerCode}) · {j.customer.phone}
          </dd>
          <dt>Device</dt>
          <dd>
            {j.asset.category}: {j.asset.brand} {j.asset.model}
            {j.asset.serialNumber ? ` · S/N ${j.asset.serialNumber}` : ''}
          </dd>
          <dt>Branch</dt>
          <dd>{j.branch.name}</dd>
          <dt>Service</dt>
          <dd>
            {TYPE_LABELS[j.serviceType]} · {MODE_LABELS[j.serviceMode]}
          </dd>
          <dt>Channel</dt>
          <dd>{j.channel === 'STAFF' ? 'Counter intake' : 'Customer app'}</dd>
          <dt>Received</dt>
          <dd>
            {j.receivedAt ? new Date(j.receivedAt).toLocaleString() : 'Device not yet received'}
          </dd>
        </dl>
      </section>
      <section className="card">
        <h2>Complaint</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{j.complaint}</p>
        <h3>Accessories received</h3>
        <p>{j.accessoriesReceived.length ? j.accessoriesReceived.join(', ') : 'None'}</p>
        {j.conditionNotes ? (
          <>
            <h3>Condition at intake</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{j.conditionNotes}</p>
          </>
        ) : null}
        {j.intakeChecklist.length ? (
          <>
            <h3>Intake checklist</h3>
            <ul>
              {j.intakeChecklist.map((c) => (
                <li key={c.item}>
                  {c.checked ? 'Yes' : 'No'} — {c.item}
                  {c.note ? ` (${c.note})` : ''}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      {j.attachments.length ? (
        <section className="card">
          <h2>Photos and files</h2>
          <ul>
            {j.attachments.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onOpenAttachment(a.fileId)}
                >
                  {a.originalName}
                </button>{' '}
                <span className="muted small">
                  {a.category === 'CUSTOMER_PHOTO' ? 'from customer' : 'intake'} ·{' '}
                  {a.visibility === 'CUSTOMER' ? 'customer-visible' : 'staff only'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Timeline({ j }: { j: JobDetail }) {
  return (
    <section className="card">
      <h2>Status history</h2>
      <ol>
        {j.statusHistory.map((h) => (
          <li key={h.createdAt + h.toStatus}>
            {statusLabel(h.toStatus)} — {new Date(h.createdAt).toLocaleString()}
            {h.reason ? ` · ${h.reason}` : ''}
          </li>
        ))}
      </ol>
    </section>
  );
}

const DELIVERY_LABELS: Record<string, string> = {
  ACCEPTED: 'accepted by provider (not yet confirmed delivered)',
  FAILED: 'failed',
  SKIPPED_NO_CONSENT: 'skipped — no consent',
  SKIPPED_NO_ADDRESS: 'skipped — no address',
  DELIVERED: 'delivered',
  READ: 'read',
};

export function NotificationList({ items }: { items: Notification[] }) {
  if (items.length === 0) return <p className="muted">No notifications.</p>;
  return (
    <ul>
      {items.map((n) => (
        <li key={n.id}>
          <strong>{n.eventType.replace(/_/g, ' ').toLowerCase()}</strong> — {n.status.toLowerCase()}{' '}
          · attempts {n.attempts}
          <ul>
            {n.deliveries.map((d) => (
              <li key={d.createdAt + d.channel} className="small">
                {d.channel}: {DELIVERY_LABELS[d.status] ?? d.status}
                {d.errorCode ? ` (${d.errorCode})` : ''}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
