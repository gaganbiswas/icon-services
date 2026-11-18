import type { DocumentLink, JobDetail } from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { StatusBadge, statusLabel } from '../../components/StatusBadge';
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
  const job = useResource(() => client.get<JobDetail>(`/jobs/${jobId}`), [client, jobId]);
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
                  {j.receivedAt
                    ? new Date(j.receivedAt).toLocaleString()
                    : 'Device not yet received'}
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
                        onClick={() => void openAttachment(a.fileId)}
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
          </>
        )}
      </ResourceView>
    </AppShell>
  );
}
