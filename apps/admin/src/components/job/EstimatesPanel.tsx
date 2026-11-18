import {
  COVERAGES,
  ESTIMATE_LINE_TYPES,
  type Estimate,
  type EstimateLineInput,
  type JobDetail,
  type Part,
  type SentEstimateResponse,
  computeLine,
  computeTotals,
  formatMoney,
} from '@icon/contracts';
import { useState } from 'react';

import { useAuth } from '../../lib/auth';
import { formMessage } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';
import { ResourceView } from '../ResourceView';

const TYPE_LABELS = {
  LABOUR: 'Labour',
  PART: 'Part',
  SERVICE_FEE: 'Service fee',
  OTHER: 'Other',
} as const;
const COVERAGE_LABELS = {
  CUSTOMER_PAY: 'Customer pays',
  WARRANTY: 'Warranty',
  GOODWILL: 'Goodwill',
} as const;
const STATUS_LABELS: Record<Estimate['status'], string> = {
  DRAFT: 'Draft',
  SENT: 'Sent — awaiting customer',
  APPROVED: 'Approved by customer',
  REJECTED: 'Rejected by customer',
  SUPERSEDED: 'Superseded by a newer version',
  WITHDRAWN: 'Withdrawn',
};

const PORTAL_URL = (
  (import.meta.env['VITE_CUSTOMER_PORTAL_URL'] as string | undefined) ?? 'http://localhost:3000'
).replace(/\/$/, '');

/** Approval links carry the token in the fragment so it never reaches servers or logs. */
export function approvalUrl(token: string): string {
  return `${PORTAL_URL}/estimate#token=${token}`;
}

const emptyLine = (): EstimateLineInput => ({
  lineType: 'LABOUR',
  description: '',
  quantity: '1',
  unit: 'EA',
  unitPrice: '0',
  discount: '0',
  coverage: 'CUSTOMER_PAY',
});

function EstimateView({ estimate }: { estimate: Estimate }) {
  const m = (v: string) => formatMoney(v, estimate.currency);
  return (
    <div className="table-wrap">
      <table className="data">
        <caption className="muted small">
          Version {estimate.version} · {STATUS_LABELS[estimate.status]}
          {estimate.expired ? ' · EXPIRED' : ''}
          {estimate.validUntil ? ` · valid until ${estimate.validUntil}` : ''}
        </caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Discount</th>
            <th scope="col">Coverage</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {estimate.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {TYPE_LABELS[l.lineType]}: {l.description}
              </td>
              <td>
                {l.quantity} {l.unit}
              </td>
              <td>{m(l.unitPrice)}</td>
              <td>{m(l.discount)}</td>
              <td>{COVERAGE_LABELS[l.coverage]}</td>
              <td>{m(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="summary">
        <dt>Total</dt>
        <dd>{m(estimate.total)}</dd>
        <dt>Covered (warranty/goodwill)</dt>
        <dd>{m(estimate.covered)}</dd>
        <dt>Customer pays</dt>
        <dd>
          <strong>{m(estimate.customerPayable)}</strong>
        </dd>
        <dt>Tax</dt>
        <dd>{estimate.taxNote}</dd>
      </dl>
      {estimate.decision ? (
        <p>
          Customer decision:{' '}
          <strong>{estimate.decision.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</strong> via{' '}
          {estimate.decision.method === 'CUSTOMER_APP' ? 'customer app' : 'approval link'} on{' '}
          {new Date(estimate.decision.decidedAt).toLocaleString()}
          {estimate.decision.comment ? ` — “${estimate.decision.comment}”` : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Copies catalogue details into an estimate line (a snapshot, never a live link). */
function CataloguePicker({ onPick }: { onPick: (part: Part) => void }) {
  const { client } = useAuth();
  const [q, setQ] = useState('');
  const parts = useResource(
    () => (q.length >= 2 ? client.get<Part[]>('/parts', { q }) : Promise.resolve([])),
    [client, q],
  );
  return (
    <details>
      <summary>Fill from parts catalogue</summary>
      <label>
        Search
        <input type="search" value={q} onChange={(e) => setQ(e.target.value.trim())} />
      </label>
      {parts.status === 'ready' && parts.data.length > 0 ? (
        <ul>
          {parts.data.map((p) => (
            <li key={p.id}>
              <button type="button" className="secondary" onClick={() => onPick(p)}>
                Use
              </button>{' '}
              {p.sku} — {p.name}
              {p.sellingPrice ? ` · ${p.sellingPrice.replace(/\.?0+$/, '')}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function DraftEditor({
  job,
  existing,
  currency,
  onSaved,
}: {
  job: JobDetail;
  existing: Estimate | null;
  currency: string | null;
  onSaved: () => void;
}) {
  const { client } = useAuth();
  const canPickParts = useCan('inventory.read');
  const [lines, setLines] = useState<EstimateLineInput[]>(
    existing ? existing.lines.map((l) => ({ ...l, sku: l.sku ?? undefined })) : [emptyLine()],
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const totals = computeTotals(lines);

  const update = (index: number, patch: Partial<EstimateLineInput>) =>
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const body = { lines, ...(notes.trim() ? { notes: notes.trim() } : {}) };
      if (existing)
        await client.put(`/estimates/${existing.id}`, { ...body, rowVersion: existing.rowVersion });
      else await client.post(`/jobs/${job.id}/estimates`, body);
      onSaved();
    } catch (caught) {
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" aria-label="Estimate draft">
      <h3>{existing ? `Edit draft (version ${existing.version})` : 'New estimate'}</h3>
      {lines.map((line, index) => {
        const amounts = computeLine(line);
        return (
          <fieldset key={index}>
            <legend>Line {index + 1}</legend>
            <div className="grid-2">
              <label>
                Type
                <select
                  value={line.lineType}
                  onChange={(e) =>
                    update(index, { lineType: e.target.value as EstimateLineInput['lineType'] })
                  }
                >
                  {ESTIMATE_LINE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <input
                  value={line.description}
                  onChange={(e) => update(index, { description: e.target.value })}
                />
              </label>
              <label>
                Quantity
                <input
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => update(index, { quantity: e.target.value })}
                />
              </label>
              <label>
                Unit price
                <input
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(e) => update(index, { unitPrice: e.target.value })}
                />
              </label>
              <label>
                Discount (amount)
                <input
                  inputMode="decimal"
                  value={line.discount}
                  onChange={(e) => update(index, { discount: e.target.value })}
                />
              </label>
              <label>
                Coverage
                <select
                  value={line.coverage}
                  onChange={(e) =>
                    update(index, { coverage: e.target.value as EstimateLineInput['coverage'] })
                  }
                >
                  {COVERAGES.map((c) => (
                    <option key={c} value={c}>
                      {COVERAGE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {canPickParts ? (
              <CataloguePicker
                onPick={(p) =>
                  update(index, {
                    lineType: 'PART',
                    sku: p.sku,
                    description: p.name,
                    unit: p.unit,
                    ...(p.sellingPrice ? { unitPrice: p.sellingPrice } : {}),
                  })
                }
              />
            ) : null}
            <p className="small">
              Line amount:{' '}
              {amounts && currency
                ? formatMoney(amounts.net, currency)
                : amounts
                  ? amounts.net
                  : 'check quantity, price and discount'}
            </p>
            {lines.length > 1 ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
              >
                Remove line
              </button>
            ) : null}
          </fieldset>
        );
      })}
      <button
        type="button"
        className="secondary"
        onClick={() => setLines((c) => [...c, emptyLine()])}
      >
        Add line
      </button>
      <label className="field">
        Note for the customer (optional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </label>
      <p>
        Preview — customer pays:{' '}
        <strong>{totals && currency ? formatMoney(totals.customerPayable, currency) : '—'}</strong>
        <span className="muted small">
          {' '}
          (final totals are calculated by the server; taxes to be confirmed)
        </span>
      </p>
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <button type="button" onClick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save draft'}
      </button>
    </div>
  );
}

export function EstimatesPanel({ job, onChanged }: { job: JobDetail; onChanged: () => void }) {
  const { client } = useAuth();
  const canWrite = useCan('estimates.write');
  const canSend = useCan('estimates.send');
  const [revision, setRevision] = useState(0);
  const estimates = useResource(
    () => client.get<Estimate[]>(`/jobs/${job.id}/estimates`),
    [client, job.id, revision, job.version],
  );
  const config = useResource(
    () => client.get<{ currency: string | null }>('/estimates/config'),
    [client],
  );
  const [link, setLink] = useState<{ token: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => {
    setRevision((n) => n + 1);
    onChanged();
  };

  async function run<T>(action: () => Promise<T>, after?: (result: T) => void) {
    setMessage(null);
    try {
      const result = await action();
      after?.(result);
      refresh();
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  const currency = config.status === 'ready' ? config.data.currency : null;

  return (
    <ResourceView resource={estimates}>
      {(list) => {
        const draft = list.find((e) => e.status === 'DRAFT') ?? null;
        const sent = list.find((e) => e.status === 'SENT') ?? null;
        return (
          <div>
            {link ? (
              <div className="card" role="status">
                <p>
                  <strong>Approval link (shown once).</strong> Share it with the customer; it
                  expires {new Date(link.expiresAt).toLocaleString()} and works once.
                </p>
                <code style={{ overflowWrap: 'anywhere' }}>{approvalUrl(link.token)}</code>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(approvalUrl(link.token)).then(
                        () => setCopied(true),
                        () => setCopied(false),
                      )
                    }
                  >
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button type="button" className="secondary" onClick={() => setLink(null)}>
                    Done
                  </button>
                </div>
              </div>
            ) : null}
            {message ? (
              <p role="alert" className="form-error">
                {message}
              </p>
            ) : null}
            {canWrite && job.status === 'ESTIMATE_PREPARATION' ? (
              currency === null ? (
                <p className="warning">
                  The business currency is not configured yet. An administrator must set it in
                  Settings before estimates can be prepared.
                </p>
              ) : (
                <DraftEditor
                  key={draft?.rowVersion ?? 'new'}
                  job={job}
                  existing={draft}
                  currency={currency}
                  onSaved={refresh}
                />
              )
            ) : null}
            {draft && canSend && job.status === 'ESTIMATE_PREPARATION' ? (
              <button
                type="button"
                onClick={() =>
                  void run(
                    () =>
                      client.post<SentEstimateResponse>(`/estimates/${draft.id}/send`, {
                        rowVersion: draft.rowVersion,
                      }),
                    (r) => {
                      setCopied(false);
                      setLink(r.approvalLink);
                    },
                  )
                }
              >
                Send version {draft.version} to customer
              </button>
            ) : null}
            {sent && canSend && !sent.expired ? (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void run(
                    () =>
                      client.post<{ token: string; expiresAt: string }>(
                        `/estimates/${sent.id}/approval-link`,
                      ),
                    (r) => {
                      setCopied(false);
                      setLink(r);
                    },
                  )
                }
              >
                Issue a new approval link
              </button>
            ) : null}
            {list.length === 0 ? <p className="muted">No estimates yet.</p> : null}
            {list
              .filter((e) => e.status !== 'DRAFT')
              .map((e) => (
                <section key={e.id} className="card">
                  <EstimateView estimate={e} />
                </section>
              ))}
          </div>
        );
      }}
    </ResourceView>
  );
}
