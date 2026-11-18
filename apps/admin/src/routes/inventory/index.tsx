import type { Branch, Page, Part, StockLevel, StockMovement, Supplier } from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { FormField } from '../../components/FormField';
import { SelectField } from '../../components/Inputs';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/inventory/')({
  component: () => (
    <RequireAuth>
      <InventoryPage />
    </RequireAuth>
  ),
});

const qty = (v: string) => v.replace(/\.?0+$/, '') || '0';

type Panel =
  | { kind: 'receive' | 'adjust' | 'transfer' | 'ledger'; level: StockLevel }
  | { kind: 'new-part' }
  | null;

export function InventoryPage() {
  const { client } = useAuth();
  const canWrite = useCan('inventory.write');
  const canAdjust = useCan('inventory.adjust');
  const canOverride = useCan('inventory.negative_override');
  const branches = useResource(() => client.get<Branch[]>('/branches'), [client]);
  const [branchId, setBranchId] = useState('');
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const activeBranch =
    branchId || (branches.status === 'ready' ? (branches.data[0]?.id ?? '') : '');
  const stock = useResource(
    () =>
      activeBranch
        ? client.get<StockLevel[]>('/inventory/stock', {
            branchId: activeBranch,
            q,
            belowReorder: lowOnly ? 'true' : undefined,
          })
        : Promise.resolve([]),
    [client, activeBranch, q, lowOnly, revision],
  );
  const done = () => {
    setPanel(null);
    setRevision((n) => n + 1);
  };

  return (
    <AppShell
      title="Inventory"
      actions={
        canWrite ? (
          <button type="button" onClick={() => setPanel({ kind: 'new-part' })}>
            New part
          </button>
        ) : null
      }
    >
      <ResourceView resource={branches}>
        {(list) => (
          <div className="grid-2">
            <SelectField
              id="branch"
              label="Branch"
              value={activeBranch}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {list.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
            <form
              role="search"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                setQ(formText(new FormData(e.currentTarget), 'q').trim());
              }}
            >
              <FormField id="q" label="Search SKU or name" type="search" />
            </form>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
              />{' '}
              Show only low stock
            </label>
          </div>
        )}
      </ResourceView>

      {panel?.kind === 'new-part' ? (
        <NewPartForm onDone={done} onCancel={() => setPanel(null)} />
      ) : null}
      {panel && panel.kind !== 'new-part' ? (
        <StockActionPanel
          panel={panel}
          branchId={activeBranch}
          branches={branches.status === 'ready' ? branches.data : []}
          canOverride={canOverride}
          onDone={done}
          onCancel={() => setPanel(null)}
        />
      ) : null}

      <ResourceView resource={stock}>
        {(levels) =>
          levels.length === 0 ? (
            <p className="muted">
              {lowOnly ? 'Nothing is below its reorder level.' : 'No parts found.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">SKU</th>
                    <th scope="col">Part</th>
                    <th scope="col">On hand</th>
                    <th scope="col">Reserved</th>
                    <th scope="col">Available</th>
                    <th scope="col">Reorder at</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((l) => (
                    <tr key={l.part.id}>
                      <td>{l.part.sku}</td>
                      <td>{l.part.name}</td>
                      <td>
                        {qty(l.onHand)} {l.part.unit}
                      </td>
                      <td>{qty(l.reserved)}</td>
                      <td>
                        {qty(l.available)}{' '}
                        {l.belowReorder ? <span className="badge">Low</span> : null}
                      </td>
                      <td>{qty(l.reorderLevel)}</td>
                      <td className="actions">
                        {canWrite ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setPanel({ kind: 'receive', level: l })}
                          >
                            Receive
                          </button>
                        ) : null}
                        {canAdjust ? (
                          <>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setPanel({ kind: 'adjust', level: l })}
                            >
                              Adjust
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setPanel({ kind: 'transfer', level: l })}
                            >
                              Transfer
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setPanel({ kind: 'ledger', level: l })}
                        >
                          History
                        </button>
                      </td>
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

function NewPartForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { client } = useAuth();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (k: string) =>
      formText(form, k).trim() ? { [k]: formText(form, k).trim() } : {};
    try {
      await client.post<Part>('/parts', {
        sku: formText(form, 'sku'),
        name: formText(form, 'name'),
        unit: formText(form, 'unit') || 'EA',
        reorderLevel: formText(form, 'reorderLevel') || '0',
        ...optional('category'),
        ...optional('sellingPrice'),
      });
      onDone();
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    }
  }

  return (
    <form className="card" onSubmit={(e) => void onSubmit(e)} noValidate aria-label="New part">
      <h2>New part</h2>
      <div className="grid-2">
        <FormField id="sku" label="SKU" required error={errors['sku']} />
        <FormField id="name" label="Name" required error={errors['name']} />
        <FormField id="category" label="Category (optional)" />
        <FormField id="unit" label="Unit" defaultValue="EA" />
        <FormField
          id="reorderLevel"
          label="Reorder level"
          inputMode="decimal"
          defaultValue="0"
          error={errors['reorderLevel']}
        />
        <FormField
          id="sellingPrice"
          label="Selling price (optional, excl. tax)"
          inputMode="decimal"
          error={errors['sellingPrice']}
        />
      </div>
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit">Save part</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function StockActionPanel({
  panel,
  branchId,
  branches,
  canOverride,
  onDone,
  onCancel,
}: {
  panel: { kind: 'receive' | 'adjust' | 'transfer' | 'ledger'; level: StockLevel };
  branchId: string;
  branches: Branch[];
  canOverride: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { client } = useAuth();
  const suppliers = useResource(
    () => (panel.kind === 'receive' ? client.get<Supplier[]>('/suppliers') : Promise.resolve([])),
    [client, panel.kind],
  );
  const ledger = useResource(
    () =>
      panel.kind === 'ledger'
        ? client.get<Page<StockMovement>>('/inventory/movements', {
            branchId,
            partId: panel.level.part.id,
            pageSize: 50,
          })
        : Promise.resolve(null),
    [client, panel.kind, branchId, panel.level.part.id],
  );
  const [message, setMessage] = useState<string | null>(null);
  const partId = panel.level.part.id;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (k: string) =>
      formText(form, k).trim() ? { [k]: formText(form, k).trim() } : {};
    try {
      if (panel.kind === 'receive') {
        await client.post('/inventory/receipts', {
          branchId,
          partId,
          quantity: formText(form, 'quantity'),
          ...optional('unitCost'),
          ...optional('supplierId'),
          ...optional('reference'),
        });
      } else if (panel.kind === 'adjust') {
        await client.post('/inventory/adjustments', {
          branchId,
          partId,
          direction: formText(form, 'direction') === 'INCREASE' ? 'INCREASE' : 'DECREASE',
          quantity: formText(form, 'quantity'),
          reason: formText(form, 'reason'),
          allowNegative: form.get('allowNegative') !== null,
        });
      } else if (panel.kind === 'transfer') {
        await client.post('/inventory/transfers', {
          fromBranchId: branchId,
          toBranchId: formText(form, 'toBranchId'),
          partId,
          quantity: formText(form, 'quantity'),
          ...optional('reason'),
        });
      }
      onDone();
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  const title = {
    receive: 'Receive stock',
    adjust: 'Adjust stock',
    transfer: 'Transfer stock',
    ledger: 'Stock history',
  }[panel.kind];
  return (
    <section className="card" aria-label={title}>
      <h2>
        {title}: {panel.level.part.sku} — {panel.level.part.name}
      </h2>
      {panel.kind === 'ledger' ? (
        <ResourceView resource={ledger}>
          {(page) => (
            <ul>
              {(page?.items ?? []).map((m) => (
                <li key={m.id}>
                  {new Date(m.createdAt).toLocaleString()} —{' '}
                  {m.type.replace('_', ' ').toLowerCase()} · on hand{' '}
                  {m.onHandDelta.startsWith('-') ? '' : '+'}
                  {qty(m.onHandDelta)} · reserved {m.reservedDelta.startsWith('-') ? '' : '+'}
                  {qty(m.reservedDelta)} · {m.actor.fullName}
                  {m.reason ? ` · ${m.reason}` : ''}
                  {m.negativeOverride ? ' · NEGATIVE OVERRIDE' : ''}
                </li>
              ))}
            </ul>
          )}
        </ResourceView>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <div className="grid-2">
            {panel.kind === 'adjust' ? (
              <SelectField id="direction" label="Direction" defaultValue="DECREASE">
                <option value="DECREASE">Decrease</option>
                <option value="INCREASE">Increase</option>
              </SelectField>
            ) : null}
            {panel.kind === 'transfer' ? (
              <SelectField id="toBranchId" label="To branch">
                {branches
                  .filter((b) => b.id !== branchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </SelectField>
            ) : null}
            <FormField id="quantity" label="Quantity" inputMode="decimal" required />
            {panel.kind === 'receive' ? (
              <>
                <FormField id="unitCost" label="Unit cost (optional)" inputMode="decimal" />
                <FormField id="reference" label="Supplier invoice / reference (optional)" />
                {suppliers.status === 'ready' && suppliers.data.length > 0 ? (
                  <SelectField id="supplierId" label="Supplier (optional)" defaultValue="">
                    <option value="">—</option>
                    {suppliers.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
              </>
            ) : null}
            {panel.kind !== 'receive' ? (
              <FormField
                id="reason"
                label={panel.kind === 'adjust' ? 'Reason (required)' : 'Reason (optional)'}
              />
            ) : null}
          </div>
          {panel.kind === 'adjust' && canOverride ? (
            <label className="checkbox">
              <input type="checkbox" name="allowNegative" /> Allow stock to go below zero (audited)
            </label>
          ) : null}
          {message ? (
            <p role="alert" className="form-error">
              {message}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit">Save</button>
          </div>
        </form>
      )}
      <button type="button" className="secondary" onClick={onCancel}>
        Close
      </button>
    </section>
  );
}
