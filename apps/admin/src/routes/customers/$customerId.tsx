import type { Asset, Consent, Customer, JobSummary, Page } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { DeviceForm } from '../../components/DeviceForm';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { formMessage } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/customers/$customerId')({
  component: () => (
    <RequireAuth>
      <CustomerDetailPage />
    </RequireAuth>
  ),
});

const CONSENTS = [
  { channel: 'WHATSAPP', label: 'WhatsApp service updates' },
  { channel: 'EMAIL', label: 'Email service updates' },
] as const;

function CustomerDetailPage() {
  const { customerId } = Route.useParams();
  const { client } = useAuth();
  const canWrite = useCan('customers.write');
  const canAddDevice = useCan('assets.write');
  const canCreateJob = useCan('jobs.create');
  const customer = useResource(
    () => client.get<Customer>(`/customers/${customerId}`),
    [client, customerId],
  );
  const devices = useResource(
    () => client.get<Asset[]>(`/customers/${customerId}/assets`),
    [client, customerId],
  );
  const jobs = useResource(
    () => client.get<Page<JobSummary>>('/jobs', { customerId, pageSize: 50 }),
    [client, customerId],
  );
  const [warning, setWarning] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  async function toggleConsent(
    channel: 'WHATSAPP' | 'EMAIL',
    granted: boolean,
    reload: () => void,
  ) {
    setConsentError(null);
    try {
      await client.put<Consent[]>(`/customers/${customerId}/consents`, {
        channel,
        purpose: 'SERVICE_UPDATES',
        granted,
      });
      reload();
    } catch (caught) {
      setConsentError(formMessage(caught));
    }
  }

  return (
    <AppShell
      title="Customer"
      actions={
        canCreateJob ? (
          <Link to="/jobs/new" search={{ customerId }} className="button">
            New job for this customer
          </Link>
        ) : null
      }
    >
      <ResourceView resource={customer}>
        {(c) => (
          <section className="card" aria-labelledby="customer-heading">
            <h2 id="customer-heading">
              {c.name} <span className="muted small">({c.customerCode})</span>
            </h2>
            <dl className="summary">
              <dt>Type</dt>
              <dd>{c.type === 'BUSINESS' ? 'Business' : 'Individual'}</dd>
              <dt>Phone</dt>
              <dd>{c.phone}</dd>
              <dt>Email</dt>
              <dd>{c.email ?? '—'}</dd>
              <dt>Billing address</dt>
              <dd>
                {c.billingAddress
                  ? [
                      c.billingAddress.line1,
                      c.billingAddress.city,
                      c.billingAddress.countryCode,
                    ].join(', ')
                  : '—'}
              </dd>
            </dl>
            <fieldset>
              <legend>Communication consent</legend>
              {CONSENTS.map(({ channel, label }) => {
                const active = c.activeConsents.some(
                  (x) => x.channel === channel && x.purpose === 'SERVICE_UPDATES',
                );
                return (
                  <label key={channel} className="checkbox">
                    <input
                      type="checkbox"
                      checked={active}
                      disabled={!canWrite || customer.status !== 'ready'}
                      onChange={(e) =>
                        customer.status === 'ready' &&
                        void toggleConsent(channel, e.target.checked, customer.reload)
                      }
                    />
                    {label} — {active ? 'granted' : 'not granted'}
                  </label>
                );
              })}
              {consentError ? (
                <p role="alert" className="form-error">
                  {consentError}
                </p>
              ) : null}
            </fieldset>
          </section>
        )}
      </ResourceView>

      <section aria-labelledby="devices-heading">
        <h2 id="devices-heading">Devices</h2>
        <ResourceView resource={devices}>
          {(list) =>
            list.length === 0 ? (
              <p className="muted">No devices yet.</p>
            ) : (
              <ul>
                {list.map((d) => (
                  <li key={d.id}>
                    {d.category.name}: {d.brand} {d.model}
                    {d.serialNumber ? ` · S/N ${d.serialNumber}` : ''}
                  </li>
                ))}
              </ul>
            )
          }
        </ResourceView>
        {warning ? (
          <p className="warning" role="status">
            {warning}
          </p>
        ) : null}
        {canAddDevice ? (
          <details>
            <summary>Add a device</summary>
            <DeviceForm
              customerId={customerId}
              onCreated={(result) => {
                setWarning(
                  result.duplicateSerialWarning
                    ? `This serial number is already registered on ${result.duplicateSerialWarning.count} other device record(s). Check before continuing.`
                    : null,
                );
                if (devices.status === 'ready') devices.reload();
              }}
            />
          </details>
        ) : null}
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading">Service history</h2>
        <ResourceView resource={jobs}>
          {(page) =>
            page.items.length === 0 ? (
              <p className="muted">No jobs yet.</p>
            ) : (
              <ul>
                {page.items.map((j) => (
                  <li key={j.id}>
                    <Link to="/jobs/$jobId" params={{ jobId: j.id }}>
                      {j.jobNumber}
                    </Link>{' '}
                    <StatusBadge status={j.status} /> {j.asset.brand} {j.asset.model}
                  </li>
                ))}
              </ul>
            )
          }
        </ResourceView>
      </section>
    </AppShell>
  );
}
