import { type GstSummary, formatMoney } from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../../components/AppShell';
import { ExportButtons } from '../../components/ExportButtons';
import { PeriodFilter, usePeriod } from '../../components/PeriodFilter';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/reports/gst-summary')({
  component: () => (
    <RequireAuth>
      <AppShell title="GST summary">
        <GstSummaryPage />
      </AppShell>
    </RequireAuth>
  ),
});

export function GstSummaryPage() {
  const { client } = useAuth();
  const { fields, setFields } = usePeriod(30);
  const query = { from: fields.from, to: fields.to, branchId: fields.branchId || undefined };
  const data = useResource(
    () => client.get<GstSummary>('/reports/gst-summary', query),
    [client, query.from, query.to, query.branchId],
  );
  return (
    <>
      <PeriodFilter fields={fields} onChange={setFields} />
      <ExportButtons report="gst-summary" query={query} />
      <ResourceView resource={data}>
        {(s) => {
          const m = (v: string) => formatMoney(v, s.currency || 'INR');
          const row = (
            label: string,
            b: { taxable: string; cgst: string; sgst: string; igst: string; total: string },
            count?: number,
          ) => (
            <tr>
              <th scope="row">
                {label}
                {count !== undefined ? <span className="muted small"> ({count})</span> : null}
              </th>
              <td className="num">{m(b.taxable)}</td>
              <td className="num">{m(b.cgst)}</td>
              <td className="num">{m(b.sgst)}</td>
              <td className="num">{m(b.igst)}</td>
              <td className="num">{m(b.total)}</td>
            </tr>
          );
          return (
            <>
              <p className="muted small">
                Invoices by invoice date minus credit notes by note date. A working summary for
                return preparation — review with your accountant before filing.
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col"> </th>
                      <th scope="col" className="num">
                        Taxable
                      </th>
                      <th scope="col" className="num">
                        CGST
                      </th>
                      <th scope="col" className="num">
                        SGST
                      </th>
                      <th scope="col" className="num">
                        IGST
                      </th>
                      <th scope="col" className="num">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {row('Invoices', s.invoices, s.invoices.count)}
                    {row('Credit notes', s.creditNotes, s.creditNotes.count)}
                    {row('Net', s.net)}
                  </tbody>
                </table>
              </div>
              <p>
                Bills of supply (no GST, not included above): {s.billsOfSupply.count}, total{' '}
                {formatMoney(s.billsOfSupply.total, s.currency || 'INR')}
                {s.billsOfSupply.credited !== '0.00'
                  ? `, credited ${formatMoney(s.billsOfSupply.credited, s.currency || 'INR')}`
                  : ''}
                .
              </p>
              <h2>By HSN/SAC</h2>
              {s.byHsn.length === 0 ? (
                <p className="muted">Nothing in this period.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">HSN/SAC</th>
                        <th scope="col" className="num">
                          Rate
                        </th>
                        <th scope="col" className="num">
                          Quantity
                        </th>
                        <th scope="col" className="num">
                          Taxable
                        </th>
                        <th scope="col" className="num">
                          CGST
                        </th>
                        <th scope="col" className="num">
                          SGST
                        </th>
                        <th scope="col" className="num">
                          IGST
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.byHsn.map((h) => (
                        <tr key={`${h.hsnSac}-${h.gstRate}`}>
                          <td>{h.hsnSac}</td>
                          <td className="num">{h.gstRate}%</td>
                          <td className="num">{h.quantity}</td>
                          <td className="num">{m(h.taxable)}</td>
                          <td className="num">{m(h.cgst)}</td>
                          <td className="num">{m(h.sgst)}</td>
                          <td className="num">{m(h.igst)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h2>Registered (B2B) and unregistered (B2C) customers</h2>
              <ul>
                {s.bySegment.map((b) => (
                  <li key={b.segment}>
                    {b.segment === 'B2B' ? 'Registered (B2B)' : 'Unregistered (B2C)'}: {b.count}{' '}
                    invoice(s), taxable {m(b.taxable)}, GST {m(b.tax)}
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </ResourceView>
    </>
  );
}
