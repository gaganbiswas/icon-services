import {
  type Branch,
  type CollectionsReport,
  PAYMENT_METHOD_LABELS,
  formatMoney,
} from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { FormField } from '../../components/FormField';
import { SelectField } from '../../components/Inputs';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { formText } from '../../lib/form-errors';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/reports/collections')({
  component: () => (
    <RequireAuth>
      <CollectionsPage />
    </RequireAuth>
  ),
});

const today = () => new Date().toISOString().slice(0, 10);

/** Collections by method and cashier (local dates converted to UTC instants). */
export function CollectionsPage() {
  const { client } = useAuth();
  const branches = useResource(() => client.get<Branch[]>('/branches'), [client]);
  const [range, setRange] = useState({ from: today(), to: today(), branchId: '' });
  const report = useResource(() => {
    const from = new Date(`${range.from}T00:00:00`);
    const to = new Date(`${range.to}T00:00:00`);
    to.setDate(to.getDate() + 1);
    return client.get<CollectionsReport>('/reports/collections', {
      from: from.toISOString(),
      to: to.toISOString(),
      branchId: range.branchId || undefined,
    });
  }, [client, range.from, range.to, range.branchId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setRange({
      from: formText(form, 'from'),
      to: formText(form, 'to'),
      branchId: formText(form, 'branchId'),
    });
  }

  return (
    <AppShell title="Collections">
      <form className="grid-2" onSubmit={onSubmit} aria-label="Report period">
        <FormField id="from" label="From" type="date" defaultValue={range.from} />
        <FormField id="to" label="To (inclusive)" type="date" defaultValue={range.to} />
        {branches.status === 'ready' ? (
          <SelectField id="branchId" label="Branch" defaultValue="">
            <option value="">All my branches</option>
            {branches.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <div>
          <button type="submit">Show</button>
        </div>
      </form>
      <ResourceView resource={report}>
        {(r) => {
          const m = (v: string) => (r.currency ? formatMoney(v, r.currency) : v);
          return (
            <>
              <dl className="summary">
                <dt>Received</dt>
                <dd>{m(r.received)}</dd>
                <dt>Refunded</dt>
                <dd>{m(r.refunded)}</dd>
                <dt>Net collected</dt>
                <dd>
                  <strong>{m(r.net)}</strong>
                </dd>
              </dl>
              <p className="muted small">
                Reversed payments are excluded. Refunds count on the day they were made.
              </p>
              <h2>By method</h2>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Received</th>
                    <th scope="col">Refunded</th>
                    <th scope="col">Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byMethod.map((row) => (
                    <tr key={row.method}>
                      <td>{PAYMENT_METHOD_LABELS[row.method]}</td>
                      <td>{m(row.received)}</td>
                      <td>{m(row.refunded)}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2>By cashier</h2>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Received by</th>
                    <th scope="col">Received</th>
                    <th scope="col">Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byCashier.map((row) => (
                    <tr key={row.user.id}>
                      <td>{row.user.fullName}</td>
                      <td>{m(row.received)}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          );
        }}
      </ResourceView>
    </AppShell>
  );
}
