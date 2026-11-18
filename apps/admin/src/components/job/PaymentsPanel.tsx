import {
  type DocumentLink,
  type JobDetail,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type Page,
  type Payment,
  formatMoney,
} from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';
import { FormField } from '../FormField';
import { SelectField } from '../Inputs';
import { ResourceView } from '../ResourceView';

function openBlankTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

/** Payments for a job. Money goes on the customer's account until invoicing (ADR 0016). */
export function PaymentsPanel({ job }: { job: JobDetail }) {
  const { client } = useAuth();
  const canRecord = useCan('payments.record');
  const canRefund = useCan('payments.refund');
  const [revision, setRevision] = useState(0);
  const payments = useResource(
    () => client.get<Page<Payment>>('/payments', { jobId: job.id, pageSize: 100 }),
    [client, job.id, revision],
  );
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  // One key per intended payment: retrying after a network error cannot double-record.
  const [key, setKey] = useState(newIdempotencyKey);
  const [saving, setSaving] = useState(false);

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const reference = formText(form, 'reference').trim();
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      await client.post(
        '/payments',
        {
          branchId: job.branch.id,
          customerId: job.customer.id,
          jobId: job.id,
          amount: formText(form, 'amount').trim(),
          method,
          ...(reference ? { reference } : {}),
          ...(formText(form, 'notes').trim() ? { notes: formText(form, 'notes').trim() } : {}),
        },
        { 'Idempotency-Key': key },
      );
      formElement.reset();
      setKey(newIdempotencyKey());
      setRevision((n) => n + 1);
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function receipt(id: string) {
    const tab = openBlankTab();
    try {
      const link = await client.post<DocumentLink>(`/payments/${id}/receipt`);
      if (tab) tab.location.href = link.url;
      else window.location.assign(link.url);
    } catch (caught) {
      tab?.close();
      setMessage(formMessage(caught));
    }
  }

  async function refund(p: Payment) {
    const amount = window.prompt(`Refund amount (up to ${p.onAccount})`);
    if (!amount) return;
    const reason = window.prompt('Reason for the refund');
    if (!reason?.trim()) return;
    const refundMethod = p.method;
    const reference =
      refundMethod === 'CASH'
        ? undefined
        : (window.prompt('Refund transaction reference') ?? undefined);
    try {
      await client.post(`/payments/${p.id}/refunds`, {
        amount: amount.trim(),
        method: refundMethod,
        reason: reason.trim(),
        ...(reference ? { reference } : {}),
      });
      setRevision((n) => n + 1);
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  async function reverse(p: Payment) {
    const reason = window.prompt(`Reverse ${p.receiptNumber}? This cannot be undone. Reason:`);
    if (!reason?.trim()) return;
    try {
      await client.post(`/payments/${p.id}/reversal`, { reason: reason.trim() });
      setRevision((n) => n + 1);
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  return (
    <div>
      <p className="muted small">
        Payments are held on the customer’s account until invoices are issued (invoicing awaits tax
        confirmation).
      </p>
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <ResourceView resource={payments}>
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">No payments recorded for this job.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Receipt</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Method</th>
                    <th scope="col">Status</th>
                    <th scope="col">Refunded</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.receiptNumber}
                        <br />
                        <span className="muted small">
                          {new Date(p.receivedAt).toLocaleString()} · {p.receivedBy.fullName}
                        </span>
                      </td>
                      <td>{formatMoney(p.amount, p.currency)}</td>
                      <td>
                        {PAYMENT_METHOD_LABELS[p.method]}
                        {p.reference ? <span className="muted small"> · {p.reference}</span> : null}
                      </td>
                      <td>
                        {p.status === 'REVERSED'
                          ? `Reversed — ${p.reversal?.reason ?? ''}`
                          : 'Recorded'}
                      </td>
                      <td>{formatMoney(p.refunded, p.currency)}</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void receipt(p.id)}
                        >
                          Receipt
                        </button>
                        {canRefund && p.status === 'RECORDED' && p.onAccount !== '0.0000' ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void refund(p)}
                          >
                            Refund
                          </button>
                        ) : null}
                        {canRefund &&
                        p.status === 'RECORDED' &&
                        p.refunded === '0.0000' &&
                        p.allocated === '0.0000' ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void reverse(p)}
                          >
                            Reverse
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ResourceView>
      {canRecord ? (
        <form
          className="card"
          onSubmit={(e) => void record(e)}
          noValidate
          aria-label="Record payment"
        >
          <h3>Record a payment</h3>
          <div className="grid-2">
            <FormField
              id="amount"
              label="Amount"
              inputMode="decimal"
              required
              error={errors['amount']}
            />
            <SelectField
              id="method"
              label="Method"
              value={method}
              onChange={(e) => setMethod(e.target.value as (typeof PAYMENT_METHODS)[number])}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </SelectField>
            {method !== 'CASH' ? (
              <FormField
                id="reference"
                label="Transaction reference (UTR, cheque no., terminal slip — never a card number)"
                required
                error={errors['reference']}
              />
            ) : null}
            <FormField id="notes" label="Notes (optional)" />
          </div>
          {message ? (
            <p role="alert" className="form-error">
              {message}
            </p>
          ) : null}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Record payment'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
