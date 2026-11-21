import {
  type DocumentLink,
  ESTIMATE_LINE_TYPES,
  INVOICE_DOCUMENT_LABELS,
  type Invoice,
  type InvoiceDocumentType,
  type InvoiceLineInput,
  type JobDetail,
  formatMoney,
} from '@icon/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { useAuth } from '../../lib/auth';
import { formMessage } from '../../lib/form-errors';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';
import { FormDialog } from '../FormDialog';
import { ResourceView } from '../ResourceView';

const FINISHED = new Set([
  'REPAIR_COMPLETED',
  'READY_FOR_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);
const LINE_TYPE_LABELS = {
  LABOUR: 'Labour',
  PART: 'Part',
  SERVICE_FEE: 'Service fee',
  OTHER: 'Other',
} as const;
const PAYMENT_STATE_LABELS = {
  UNPAID: 'Unpaid',
  PARTLY_PAID: 'Partly paid',
  PAID: 'Paid',
  CREDITED: 'Fully credited',
} as const;

function openBlankTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

/** GST tax invoices for a job (ADR 0022). */
export function InvoicePanel({ job }: { job: JobDetail }) {
  const { client } = useAuth();
  const canWrite = useCan('invoices.write');
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const invoices = useResource(
    () => client.get<Invoice[]>(`/jobs/${job.id}/invoices`),
    [client, job.id, job.version, revision],
  );
  const refresh = () => setRevision((n) => n + 1);

  async function prepare() {
    setMessage(null);
    try {
      await client.post(`/jobs/${job.id}/invoices`);
      refresh();
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  return (
    <ResourceView resource={invoices}>
      {(list) => (
        <div>
          {message ? (
            <p role="alert" className="form-error">
              {message}
            </p>
          ) : null}
          {list.length === 0 ? (
            <section className="card">
              <p>No invoice yet.</p>
              {FINISHED.has(job.status) ? (
                canWrite ? (
                  <button type="button" onClick={() => void prepare()}>
                    Prepare tax invoice
                  </button>
                ) : null
              ) : (
                <p className="muted small">
                  A tax invoice can be prepared once the repair is completed.
                </p>
              )}
            </section>
          ) : null}
          {[...list]
            .reverse()
            .map((invoice) =>
              invoice.status === 'DRAFT' ? (
                <DraftEditor
                  key={`${invoice.id}-${invoice.rowVersion}`}
                  invoice={invoice}
                  onChanged={refresh}
                />
              ) : (
                <IssuedInvoice key={invoice.id} invoice={invoice} onChanged={refresh} />
              ),
            )}
          {list.length > 0 &&
          list.every((i) => i.status === 'CANCELLED') &&
          canWrite &&
          FINISHED.has(job.status) ? (
            <button type="button" className="secondary" onClick={() => void prepare()}>
              Prepare a new tax invoice
            </button>
          ) : null}
        </div>
      )}
    </ResourceView>
  );
}

function Totals({ invoice }: { invoice: Invoice }) {
  const m = (v: string) => formatMoney(v, invoice.currency);
  const intra = invoice.supplyType === 'INTRA_STATE';
  const gst = invoice.documentType === 'TAX_INVOICE';
  return (
    <dl className="summary totals">
      <dt>{gst ? 'Taxable value' : 'Value (no GST)'}</dt>
      <dd>{m(invoice.taxableTotal)}</dd>
      {!gst ? null : intra ? (
        <>
          <dt>CGST</dt>
          <dd>{m(invoice.cgstTotal)}</dd>
          <dt>SGST</dt>
          <dd>{m(invoice.sgstTotal)}</dd>
        </>
      ) : (
        <>
          <dt>IGST</dt>
          <dd>{m(invoice.igstTotal)}</dd>
        </>
      )}
      {invoice.roundOff !== '0.00' ? (
        <>
          <dt>Round off</dt>
          <dd>{m(invoice.roundOff)}</dd>
        </>
      ) : null}
      <dt>Total</dt>
      <dd>
        <strong>{m(invoice.total)}</strong>
      </dd>
    </dl>
  );
}

function LinesTable({ invoice, editable }: { invoice: Invoice; editable?: false }) {
  void editable;
  const m = (v: string) => formatMoney(v, invoice.currency);
  const intra = invoice.supplyType === 'INTRA_STATE';
  const gst = invoice.documentType === 'TAX_INVOICE';
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col">HSN/SAC</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              {gst ? 'Taxable' : 'Value'}
            </th>
            {!gst ? null : (
              <th scope="col" className="num">
                GST
              </th>
            )}
            {!gst ? null : intra ? (
              <>
                <th scope="col" className="num">
                  CGST
                </th>
                <th scope="col" className="num">
                  SGST
                </th>
              </>
            ) : (
              <th scope="col" className="num">
                IGST
              </th>
            )}
            <th scope="col" className="num">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.description}
                {l.creditedQuantity !== '0' ? (
                  <span className="muted small"> · credited {l.creditedQuantity}</span>
                ) : null}
              </td>
              <td>{l.hsnSac}</td>
              <td className="num">
                {l.quantity} {l.unit}
              </td>
              <td className="num">{m(l.taxableValue)}</td>
              {!gst ? null : <td className="num">{l.gstRate}%</td>}
              {!gst ? null : intra ? (
                <>
                  <td className="num">{m(l.cgstAmount)}</td>
                  <td className="num">{m(l.sgstAmount)}</td>
                </>
              ) : (
                <td className="num">{m(l.igstAmount)}</td>
              )}
              <td className="num">{m(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toInput = (l: Invoice['lines'][number]): InvoiceLineInput => ({
  lineType: l.lineType,
  description: l.description,
  quantity: l.quantity,
  unit: l.unit,
  unitPrice: l.unitPrice,
  discount: l.discount,
});

function DraftEditor({ invoice, onChanged }: { invoice: Invoice; onChanged: () => void }) {
  const { client } = useAuth();
  const canWrite = useCan('invoices.write');
  const canIssue = useCan('invoices.issue');
  const [lines, setLines] = useState<InvoiceLineInput[]>(invoice.lines.map(toInput));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [issueKey] = useState(newIdempotencyKey);
  const [docType, setDocType] = useState<InvoiceDocumentType>(invoice.documentType);
  const [docReason, setDocReason] = useState(invoice.documentTypeReason ?? '');
  const dirty =
    JSON.stringify(lines) !== JSON.stringify(invoice.lines.map(toInput)) ||
    docType !== invoice.documentType ||
    (docType === 'BILL_OF_SUPPLY' && docReason.trim() !== (invoice.documentTypeReason ?? ''));
  const label = INVOICE_DOCUMENT_LABELS[invoice.documentType].toLowerCase();
  const update = (i: number, patch: Partial<InvoiceLineInput>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await client.put(`/invoices/${invoice.id}`, {
        rowVersion: invoice.rowVersion,
        lines,
        documentType: docType,
        documentTypeReason: docType === 'BILL_OF_SUPPLY' ? docReason.trim() || null : null,
      });
      onChanged();
    } catch (caught) {
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby={`draft-${invoice.id}`}>
      <h3 id={`draft-${invoice.id}`}>Draft {label}</h3>
      <p className="muted small">
        Bill to {invoice.recipient.name}
        {invoice.recipient.gstin ? ` · GSTIN ${invoice.recipient.gstin}` : ' · unregistered'} ·
        Place of supply {invoice.placeOfSupply.name} ({invoice.placeOfSupply.code}) ·{' '}
        {invoice.documentType === 'BILL_OF_SUPPLY'
          ? 'no GST'
          : invoice.supplyType === 'INTRA_STATE'
            ? 'CGST + SGST'
            : 'IGST'}
      </p>
      {canWrite ? (
        <fieldset className="plain">
          <legend>Document type</legend>
          <label className="checkbox">
            <input
              type="radio"
              name={`doc-type-${invoice.id}`}
              checked={docType === 'TAX_INVOICE'}
              onChange={() => setDocType('TAX_INVOICE')}
            />{' '}
            Tax invoice (GST charged)
          </label>
          <label className="checkbox">
            <input
              type="radio"
              name={`doc-type-${invoice.id}`}
              checked={docType === 'BILL_OF_SUPPLY'}
              onChange={() => setDocType('BILL_OF_SUPPLY')}
            />{' '}
            Bill of supply (no GST)
          </label>
          {docType === 'BILL_OF_SUPPLY' ? (
            <label>
              Why no GST is charged (required, kept on record)
              <textarea
                value={docReason}
                maxLength={500}
                onChange={(e) => setDocReason(e.target.value)}
              />
            </label>
          ) : null}
        </fieldset>
      ) : null}
      {invoice.blockers.length > 0 ? (
        <div className="warning" role="status">
          <p>This invoice cannot be issued yet:</p>
          <ul>
            {invoice.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <Link to="/settings/invoicing">Open invoicing settings</Link>
        </div>
      ) : null}
      {canWrite ? (
        <div className="table-wrap">
          <table className="data" aria-label="Invoice lines">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
                <th scope="col">Qty</th>
                <th scope="col">Unit</th>
                <th scope="col">Unit price (excl. GST)</th>
                <th scope="col">Discount</th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select
                      aria-label={`Type of line ${i + 1}`}
                      value={l.lineType}
                      onChange={(e) =>
                        update(i, { lineType: e.target.value as InvoiceLineInput['lineType'] })
                      }
                    >
                      {ESTIMATE_LINE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {LINE_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Description of line ${i + 1}`}
                      value={l.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Quantity of line ${i + 1}`}
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) => update(i, { quantity: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Unit of line ${i + 1}`}
                      value={l.unit}
                      onChange={(e) => update(i, { unit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Unit price of line ${i + 1}`}
                      inputMode="decimal"
                      value={l.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Discount of line ${i + 1}`}
                      inputMode="decimal"
                      value={l.discount}
                      onChange={(e) => update(i, { discount: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LinesTable invoice={invoice} />
      )}
      {canWrite ? (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setLines((all) => [
                ...all,
                {
                  lineType: 'LABOUR',
                  description: '',
                  quantity: '1',
                  unit: 'NOS',
                  unitPrice: '0',
                  discount: '0',
                },
              ])
            }
          >
            Add line
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              saving || !dirty || (docType === 'BILL_OF_SUPPLY' && docReason.trim().length < 3)
            }
          >
            {saving ? 'Saving…' : 'Save and recalculate'}
          </button>
        </div>
      ) : null}
      <Totals invoice={invoice} />
      {dirty ? (
        <p className="muted small">Save to recalculate the totals for your changes.</p>
      ) : null}
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <div className="actions">
        {canIssue ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={dirty || invoice.blockers.length > 0 || invoice.lines.length === 0}
          >
            Issue {label}
          </button>
        ) : null}
        {canWrite ? (
          <button type="button" className="secondary" onClick={() => setDeleting(true)}>
            Delete draft
          </button>
        ) : null}
      </div>
      {confirming ? (
        <FormDialog
          title={`Issue this ${label}?`}
          description={`It gets the next ${label} number and today's date. Total ${formatMoney(invoice.total, invoice.currency)}${invoice.total === '0.00' ? ' (zero-value bill)' : ''}. It can never be edited afterwards — corrections need a credit note.`}
          fields={[]}
          submitLabel="Issue invoice"
          onSubmit={async () => {
            await client.post(`/invoices/${invoice.id}/issue`, undefined, {
              'Idempotency-Key': issueKey,
            });
            onChanged();
          }}
          onClose={() => setConfirming(false)}
        />
      ) : null}
      {deleting ? (
        <FormDialog
          title="Delete this draft?"
          fields={[]}
          submitLabel="Delete draft"
          danger
          onSubmit={async () => {
            await client.authorized(`/invoices/${invoice.id}`, { method: 'DELETE' });
            onChanged();
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </section>
  );
}

function IssuedInvoice({ invoice, onChanged }: { invoice: Invoice; onChanged: () => void }) {
  const { client } = useAuth();
  const canCredit = useCan('credit_notes.issue');
  const canRelease = useCan('payments.refund');
  const [dialog, setDialog] = useState<
    null | { kind: 'credit' } | { kind: 'release'; allocationId: string; receipt: string }
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creditKey] = useState(newIdempotencyKey);
  const m = (v: string) => formatMoney(v, invoice.currency);
  const creditable = invoice.lines.filter((l) => Number(l.quantity) > Number(l.creditedQuantity));

  async function print(path: string) {
    const tab = openBlankTab();
    setMessage(null);
    try {
      const link = await client.post<DocumentLink>(path);
      if (tab) tab.location.href = link.url;
      else window.location.assign(link.url);
    } catch (caught) {
      tab?.close();
      setMessage(formMessage(caught));
    }
  }

  return (
    <section className="card" aria-labelledby={`inv-${invoice.id}`}>
      <div className="page-header">
        <h3 id={`inv-${invoice.id}`}>
          {INVOICE_DOCUMENT_LABELS[invoice.documentType]} {invoice.invoiceNumber}{' '}
          <span className="badge">
            {invoice.status === 'CANCELLED'
              ? 'Cancelled'
              : PAYMENT_STATE_LABELS[invoice.paymentState]}
          </span>
        </h3>
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void print(`/invoices/${invoice.id}/pdf`)}
          >
            Print invoice
          </button>
          {canCredit && invoice.status === 'ISSUED' ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setDialog({ kind: 'credit' })}
            >
              Credit note
            </button>
          ) : null}
        </div>
      </div>
      <p className="muted small">
        {invoice.invoiceDate} · {invoice.recipient.name}
        {invoice.recipient.gstin ? ` · GSTIN ${invoice.recipient.gstin}` : ''} · Place of supply{' '}
        {invoice.placeOfSupply.name} ({invoice.placeOfSupply.code})
      </p>
      <LinesTable invoice={invoice} />
      <Totals invoice={invoice} />
      <dl className="summary">
        {invoice.creditedTotal !== '0.00' ? (
          <>
            <dt>Credited</dt>
            <dd>{m(invoice.creditedTotal)}</dd>
          </>
        ) : null}
        <dt>Paid</dt>
        <dd>{m(invoice.paidTotal)}</dd>
        <dt>Balance</dt>
        <dd>
          <strong>{m(invoice.balance)}</strong>
        </dd>
      </dl>
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      {invoice.creditNotes.length > 0 ? (
        <>
          <h4>Credit notes</h4>
          <ul>
            {invoice.creditNotes.map((c) => (
              <li key={c.id}>
                {c.number} · {c.date} · {m(c.total)} · {c.reason}{' '}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void print(`/credit-notes/${c.id}/pdf`)}
                >
                  Print
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {invoice.allocations.length > 0 ? (
        <>
          <h4>Payments applied</h4>
          <ul>
            {invoice.allocations.map((a) => (
              <li key={a.id}>
                {a.receiptNumber} · {m(a.amount)}
                {a.releasedAt ? (
                  <span className="muted small"> · released ({a.releaseReason})</span>
                ) : null}
                {!a.releasedAt && canRelease ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setDialog({ kind: 'release', allocationId: a.id, receipt: a.receiptNumber })
                      }
                    >
                      Release
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {dialog?.kind === 'credit' ? (
        <FormDialog
          title={`Credit note against ${invoice.invoiceNumber ?? ''}`}
          description="Choose quantities to credit (leave 0 to skip a line), or credit everything to cancel the invoice. Money already paid beyond the new balance becomes refundable."
          fields={[
            {
              name: 'scope',
              label: 'What to credit',
              type: 'select',
              required: true,
              options: [
                { value: 'lines', label: 'Selected quantities below' },
                { value: 'full', label: 'Whole invoice (cancel it)' },
              ],
            },
            ...creditable.map((l) => ({
              name: `q-${l.id}`,
              label: `${l.description} (up to ${String(Number(l.quantity) - Number(l.creditedQuantity))} ${l.unit})`,
              inputMode: 'decimal' as const,
              defaultValue: '0',
            })),
            { name: 'reason', label: 'Reason', type: 'textarea', required: true },
          ]}
          submitLabel="Issue credit note"
          onSubmit={async (v) => {
            const full = v['scope'] === 'full';
            const lines = creditable
              .map((l) => ({ invoiceLineId: l.id, quantity: v[`q-${l.id}`] ?? '0' }))
              .filter((l) => Number(l.quantity) > 0);
            await client.post(
              `/invoices/${invoice.id}/credit-notes`,
              { reason: v['reason'], full, lines: full ? [] : lines },
              { 'Idempotency-Key': creditKey },
            );
            onChanged();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'release' ? (
        <FormDialog
          title={`Release payment ${dialog.receipt}?`}
          description="The money goes back to the customer’s account and the invoice balance goes up. Use this before reversing a bounced cheque."
          fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]}
          submitLabel="Release"
          danger
          onSubmit={async (v) => {
            await client.post(`/allocations/${dialog.allocationId}/release`, {
              reason: v['reason'],
            });
            onChanged();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
