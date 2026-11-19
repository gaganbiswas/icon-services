import type { PartsReport } from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../../components/AppShell';
import { ExportButtons } from '../../components/ExportButtons';
import { PeriodFilter, usePeriod } from '../../components/PeriodFilter';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/reports/parts')({
  component: () => (
    <RequireAuth>
      <AppShell title="Parts usage and stock">
        <PartsReportPage />
      </AppShell>
    </RequireAuth>
  ),
});

const qty = (v: string) => v.replace(/\.?0+$/, '');

export function PartsReportPage() {
  const { client } = useAuth();
  const { fields, setFields, period } = usePeriod(30);
  const data = useResource(
    () => client.get<PartsReport>('/reports/parts', { ...period }),
    [client, period.from, period.to, period.branchId],
  );
  return (
    <>
      <PeriodFilter fields={fields} onChange={setFields} />
      <ExportButtons report="parts" query={{ ...period }} />
      <ResourceView resource={data}>
        {(r) => (
          <>
            <h2>Used in the period</h2>
            {r.usage.length === 0 ? (
              <p className="muted">No parts used in this period.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">SKU</th>
                      <th scope="col">Part</th>
                      <th scope="col" className="num">
                        Used
                      </th>
                      <th scope="col" className="num">
                        Returned
                      </th>
                      <th scope="col" className="num">
                        Net used
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.usage.map((u) => (
                      <tr key={u.partId}>
                        <td>{u.sku}</td>
                        <td>{u.name}</td>
                        <td className="num">
                          {qty(u.consumed)} {u.unit}
                        </td>
                        <td className="num">{qty(u.returned)}</td>
                        <td className="num">{qty(u.netUsed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h2>Stock now</h2>
            <p className="muted small">
              Value is indicative (on hand × latest purchase cost); the valuation method has not
              been confirmed by the accountant. Indicative total: {r.valuationTotal}
            </p>
            {r.valuation.length === 0 ? (
              <p className="muted">No stock records.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Branch</th>
                      <th scope="col">SKU</th>
                      <th scope="col">Part</th>
                      <th scope="col" className="num">
                        On hand
                      </th>
                      <th scope="col" className="num">
                        Reserved
                      </th>
                      <th scope="col" className="num">
                        Latest unit cost
                      </th>
                      <th scope="col" className="num">
                        Indicative value
                      </th>
                      <th scope="col">Reorder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.valuation.map((v) => (
                      <tr key={`${v.branchCode}-${v.sku}`}>
                        <td>{v.branchCode}</td>
                        <td>{v.sku}</td>
                        <td>{v.name}</td>
                        <td className="num">{qty(v.onHand)}</td>
                        <td className="num">{qty(v.reserved)}</td>
                        <td className="num">{v.latestUnitCost ?? '—'}</td>
                        <td className="num">{v.value ?? '—'}</td>
                        <td>{v.belowReorderLevel ? 'Below reorder level' : 'OK'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </ResourceView>
    </>
  );
}
