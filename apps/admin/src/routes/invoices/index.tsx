import {
  type InvoiceSummary,
  type Page,
  formatMoney,
  INVOICE_DOCUMENT_LABELS,
} from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { ExportButtons } from '../../components/ExportButtons';
import { SelectField } from '../../components/Inputs';
import { PeriodFilter, usePeriod } from '../../components/PeriodFilter';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/invoices/')({
  component: () => (
    <RequireAuth>
      <AppShell title="Invoices">
        <InvoiceRegister />
      </AppShell>
    </RequireAuth>
  ),
});

const STATE_LABELS = {
  UNPAID: 'Unpaid',
  PARTLY_PAID: 'Partly paid',
  PAID: 'Paid',
  CREDITED: 'Credited',
} as const;

/** Invoice register (CLAUDE.md §5 screen 11). */
export function InvoiceRegister() {
  const { client } = useAuth();
  const { fields, setFields } = usePeriod(30);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const to = new Date(`${fields.to}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  const query = {
    from: fields.from,
    to: to.toISOString().slice(0, 10),
    branchId: fields.branchId || undefined,
    status: status || undefined,
  };
  const data = useResource(
    () => client.get<Page<InvoiceSummary>>('/invoices', { ...query, page, pageSize: 50 }),
    [client, query.from, query.to, query.branchId, query.status, page],
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
      <SelectField
        id="status"
        label="Status"
        value={status}
        onChange={(e) => {
          setPage(1);
          setStatus(e.target.value);
        }}
      >
        <option value="">Issued and cancelled</option>
        <option value="ISSUED">Issued</option>
        <option value="CANCELLED">Cancelled (fully credited)</option>
        <option value="DRAFT">Drafts</option>
      </SelectField>
      <ExportButtons
        report="invoices"
        query={{ from: fields.from, to: fields.to, branchId: fields.branchId || undefined }}
      />
      <ResourceView resource={data}>
        {(p) =>
          p.items.length === 0 ? (
            <p className="muted">No invoices in this period.</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Number</th>
                      <th scope="col">Type</th>
                      <th scope="col">Date</th>
                      <th scope="col">Job</th>
                      <th scope="col">Customer</th>
                      <th scope="col" className="num">
                        Taxable
                      </th>
                      <th scope="col" className="num">
                        GST
                      </th>
                      <th scope="col" className="num">
                        Total
                      </th>
                      <th scope="col" className="num">
                        Balance
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.items.map((r) => (
                      <tr key={r.id}>
                        <td>{r.invoiceNumber ?? 'Draft'}</td>
                        <td>{INVOICE_DOCUMENT_LABELS[r.documentType]}</td>
                        <td>{r.invoiceDate ?? '—'}</td>
                        <td>
                          <Link to="/jobs/$jobId" params={{ jobId: r.jobId }}>
                            {r.jobNumber}
                          </Link>
                        </td>
                        <td>
                          {r.customerName}
                          {r.recipientGstin ? (
                            <span className="muted small"> · {r.recipientGstin}</span>
                          ) : null}
                        </td>
                        <td className="num">{formatMoney(r.taxableTotal, 'INR')}</td>
                        <td className="num">{formatMoney(r.taxTotal, 'INR')}</td>
                        <td className="num">{formatMoney(r.total, 'INR')}</td>
                        <td className="num">{formatMoney(r.balance, 'INR')}</td>
                        <td>
                          {r.status === 'ISSUED'
                            ? STATE_LABELS[r.paymentState]
                            : r.status === 'CANCELLED'
                              ? 'Cancelled'
                              : 'Draft'}
                        </td>
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
