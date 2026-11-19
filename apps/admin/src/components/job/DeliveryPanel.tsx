import {
  type Balance,
  type Delivery,
  type DocumentLink,
  HANDOVER_CHECKLIST,
  type JobDetail,
  RECIPIENT_RELATIONSHIPS,
  type StoredFileInfo,
  formatMoney,
} from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';
import { FormDialog } from '../FormDialog';
import { FormField } from '../FormField';
import { SelectField, TextAreaField } from '../Inputs';
import { ResourceView } from '../ResourceView';

const RELATIONSHIP_LABELS = {
  SELF: 'Customer',
  AUTHORIZED_PERSON: 'Authorized person',
  FAMILY: 'Family member',
  COLLEAGUE: 'Colleague',
  OTHER: 'Other',
} as const;
const MODE_LABELS = {
  CUSTOMER_PICKUP: 'Customer pick-up',
  HOME_DELIVERY: 'Home delivery',
  ON_SITE_RETURN: 'On-site return',
  OTHER: 'Other',
} as const;

function openBlankTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

interface JobDeliveries {
  deliveries: Delivery[];
  balance: Balance;
  requiredItems: string[];
}

/** Delivery and hand-over (ADR 0017). Delivered is reachable only here. */
export function DeliveryPanel({ job, onChanged }: { job: JobDetail; onChanged: () => void }) {
  const { client } = useAuth();
  const canWrite = useCan('deliveries.write');
  const canComplete = useCan('deliveries.complete');
  const canOverride = useCan('deliveries.due_override');
  const [revision, setRevision] = useState(0);
  const data = useResource(
    () => client.get<JobDeliveries>(`/jobs/${job.id}/deliveries`),
    [client, job.id, job.version, revision],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [relationship, setRelationship] =
    useState<(typeof RECIPIENT_RELATIONSHIPS)[number]>('SELF');
  const [proof, setProof] = useState<'SIGNED_CHALLAN' | 'PHOTO_PROOF'>('SIGNED_CHALLAN');
  const [photo, setPhoto] = useState<StoredFileInfo | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState<string | null>(null);
  const refresh = () => {
    setRevision((n) => n + 1);
    onChanged();
  };
  const ready = job.status === 'READY_FOR_DELIVERY' || job.status === 'OUT_FOR_DELIVERY';

  async function challan(id: string) {
    const tab = openBlankTab();
    try {
      const link = await client.post<DocumentLink>(`/deliveries/${id}/challan`);
      if (tab) tab.location.href = link.url;
      else window.location.assign(link.url);
    } catch (caught) {
      tab?.close();
      setMessage(formMessage(caught));
    }
  }

  async function dispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    try {
      await client.post(`/jobs/${job.id}/deliveries/dispatch`, {
        version: job.version,
        mode: 'HOME_DELIVERY',
        address: {
          line1: formText(form, 'line1'),
          city: formText(form, 'city'),
          countryCode: formText(form, 'countryCode'),
        },
      });
      refresh();
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  async function failed(id: string, reason: string) {
    await client.post(`/deliveries/${id}/failed-attempt`, { reason });
    refresh();
  }

  async function handover(
    event: FormEvent<HTMLFormElement>,
    required: string[],
    dispatched: boolean,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      await client.post(
        `/jobs/${job.id}/deliveries/handover`,
        {
          version: job.version,
          ...(dispatched ? {} : { mode: formText(form, 'mode') }),
          recipientName: formText(form, 'recipientName'),
          relationship,
          ...(relationship !== 'SELF'
            ? { authorizationNote: formText(form, 'authorizationNote') }
            : {}),
          items: required.map((description, i) => ({
            description,
            returned: form.get(`item${i}`) !== null,
            ...(formText(form, `cond${i}`).trim()
              ? { condition: formText(form, `cond${i}`).trim() }
              : {}),
          })),
          checklist: HANDOVER_CHECKLIST.map((item, i) => ({
            item,
            checked: form.get(`hc${i}`) !== null,
          })),
          ...(formText(form, 'conditionNotes').trim()
            ? { conditionNotes: formText(form, 'conditionNotes').trim() }
            : {}),
          proofMethod: proof,
          ...(proof === 'PHOTO_PROOF' && photo ? { proofFileId: photo.id } : {}),
          ...(formText(form, 'dueOverrideReason').trim()
            ? { dueOverrideReason: formText(form, 'dueOverrideReason').trim() }
            : {}),
        },
        { 'Idempotency-Key': key },
      );
      setKey(newIdempotencyKey());
      refresh();
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResourceView resource={data}>
      {({ deliveries, balance, requiredItems }) => {
        const dispatched = deliveries.find((d) => d.status === 'DISPATCHED');
        const due = balance.due !== '0.0000';
        const money = (v: string) => (balance.currency ? formatMoney(v, balance.currency) : v);
        return (
          <div>
            {failing ? (
              <FormDialog
                title="Delivery failed"
                description="The job returns to “Ready for delivery” so it can be dispatched again."
                fields={[
                  { name: 'reason', label: 'What happened?', type: 'textarea', required: true },
                ]}
                submitLabel="Record failed attempt"
                onSubmit={(v) => failed(failing, v['reason'] ?? '')}
                onClose={() => setFailing(null)}
              />
            ) : null}
            <section className="card" aria-labelledby="balance-heading">
              <h3 id="balance-heading">Balance</h3>
              <dl className="summary">
                <dt>
                  {balance.basis === 'INVOICE'
                    ? 'Invoiced (after credit notes)'
                    : 'Approved estimate'}
                </dt>
                <dd>{balance.basis === 'NONE' ? 'None' : money(balance.billed)}</dd>
                <dt>Paid</dt>
                <dd>{money(balance.paid)}</dd>
                <dt>Due</dt>
                <dd>
                  <strong>{money(balance.due)}</strong>
                  {due ? ' — balance due' : ''}
                </dd>
              </dl>
              <p className="muted small">
                {balance.basis === 'INVOICE'
                  ? 'From the issued tax invoice(s).'
                  : 'From the approved estimate until the tax invoice is issued.'}
              </p>
            </section>
            {message ? (
              <p role="alert" className="form-error">
                {message}
              </p>
            ) : null}
            {deliveries.map((d) => (
              <article key={d.id} className="card">
                <p>
                  <strong>{d.challanNumber}</strong> · {MODE_LABELS[d.mode]} ·{' '}
                  {d.status.toLowerCase()}
                  {d.recipientName ? ` · received by ${d.recipientName}` : ''}
                  {d.failedReason ? ` · failed: ${d.failedReason}` : ''}
                  {d.dueOverride ? ` · delivered with balance due (${d.dueOverride.reason})` : ''}
                </p>
                <div className="actions">
                  <button type="button" className="secondary" onClick={() => void challan(d.id)}>
                    Print challan
                  </button>
                  {d.status === 'DISPATCHED' && canWrite ? (
                    <button type="button" className="secondary" onClick={() => setFailing(d.id)}>
                      Delivery failed
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {ready && canWrite && job.status === 'READY_FOR_DELIVERY' ? (
              <details>
                <summary>Dispatch for home delivery</summary>
                <form onSubmit={(e) => void dispatch(e)} noValidate aria-label="Dispatch">
                  <div className="grid-2">
                    <FormField id="line1" label="Delivery address" required />
                    <FormField id="city" label="City" required />
                    <FormField
                      id="countryCode"
                      label="Country code (2 letters)"
                      maxLength={2}
                      required
                    />
                  </div>
                  <button type="submit">Dispatch</button>
                </form>
              </details>
            ) : null}
            {ready && canComplete ? (
              <form
                className="card"
                onSubmit={(e) => void handover(e, requiredItems, Boolean(dispatched))}
                noValidate
                aria-label="Hand over"
              >
                <h3>Hand over</h3>
                {!dispatched ? (
                  <SelectField
                    id="mode"
                    label="How is it handed over?"
                    defaultValue="CUSTOMER_PICKUP"
                  >
                    <option value="CUSTOMER_PICKUP">Customer pick-up</option>
                    <option value="ON_SITE_RETURN">On-site return</option>
                    <option value="OTHER">Other</option>
                  </SelectField>
                ) : null}
                <div className="grid-2">
                  <FormField
                    id="recipientName"
                    label="Recipient name"
                    required
                    error={errors['recipientName']}
                  />
                  <SelectField
                    id="relationship"
                    label="Recipient is"
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value as typeof relationship)}
                  >
                    {RECIPIENT_RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]}
                      </option>
                    ))}
                  </SelectField>
                </div>
                {relationship !== 'SELF' ? (
                  <FormField
                    id="authorizationNote"
                    label="How is this person authorized? (e.g. ID seen, customer called)"
                    required
                    error={errors['authorizationNote']}
                  />
                ) : null}
                <fieldset>
                  <legend>Items returned (all required)</legend>
                  {requiredItems.map((item, i) => (
                    <div key={item} className="grid-2">
                      <label className="checkbox">
                        <input type="checkbox" name={`item${i}`} /> {item}
                      </label>
                      <FormField id={`cond${i}`} label={`Condition of ${item} (optional)`} />
                    </div>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Hand-over checklist</legend>
                  {HANDOVER_CHECKLIST.map((item, i) => (
                    <label key={item} className="checkbox">
                      <input type="checkbox" name={`hc${i}`} /> {item}
                    </label>
                  ))}
                </fieldset>
                <TextAreaField id="conditionNotes" label="Condition notes (optional)" />
                <SelectField
                  id="proof"
                  label="Proof of hand-over"
                  value={proof}
                  onChange={(e) =>
                    setProof(e.target.value === 'PHOTO_PROOF' ? 'PHOTO_PROOF' : 'SIGNED_CHALLAN')
                  }
                >
                  <option value="SIGNED_CHALLAN">Customer signs the printed challan</option>
                  <option value="PHOTO_PROOF">Photo of the hand-over</option>
                </SelectField>
                {proof === 'PHOTO_PROOF' ? (
                  <div className="field">
                    <label htmlFor="proofPhoto">Hand-over photo</label>
                    <input
                      id="proofPhoto"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void client
                            .upload<StoredFileInfo>('/files', file, file.name)
                            .then(setPhoto, (c: unknown) => setMessage(formMessage(c)));
                      }}
                    />
                    {photo ? <p className="small">Attached: {photo.originalName}</p> : null}
                  </div>
                ) : null}
                {due ? (
                  canOverride ? (
                    <FormField
                      id="dueOverrideReason"
                      label={`Reason for delivering with ${money(balance.due)} due (audited)`}
                      required
                    />
                  ) : (
                    <p className="warning">
                      A balance is due. A manager must approve delivery with a balance due.
                    </p>
                  )
                ) : null}
                {message ? (
                  <p role="alert" className="form-error">
                    {message}
                  </p>
                ) : null}
                <button type="submit" disabled={busy || (due && !canOverride)}>
                  {busy ? 'Saving…' : 'Complete hand-over'}
                </button>
              </form>
            ) : null}
          </div>
        );
      }}
    </ResourceView>
  );
}
