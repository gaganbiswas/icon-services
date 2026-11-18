import {
  type JobDetail,
  type JobPart,
  type Part,
  REMOVED_PART_DISPOSITIONS,
} from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../../lib/auth';
import { formMessage, formText } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';
import { FormField } from '../FormField';
import { SelectField } from '../Inputs';
import { ResourceView } from '../ResourceView';

const qty = (v: string) => v.replace(/\.?0+$/, '') || '0';
const DISPOSITION_LABELS = {
  RETURNED_TO_CUSTOMER: 'Returned to customer',
  SENT_TO_VENDOR: 'Sent to vendor',
  SCRAPPED: 'Scrapped',
  KEPT_FOR_WARRANTY_CLAIM: 'Kept for warranty claim',
} as const;

/** Parts reserved / used on the job; every action moves stock in the same transaction. */
export function PartsPanel({ job, canWork }: { job: JobDetail; canWork: boolean }) {
  const { client } = useAuth();
  const canUse = useCan('worklogs.write') && canWork;
  const canOverride = useCan('inventory.negative_override');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const jobParts = useResource(
    () => client.get<JobPart[]>(`/jobs/${job.id}/parts`),
    [client, job.id, revision],
  );
  const catalogue = useResource(
    () => (canUse && search ? client.get<Part[]>('/parts', { q: search }) : Promise.resolve([])),
    [client, search, canUse],
  );
  const [message, setMessage] = useState<string | null>(null);

  async function act(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const allowNegative = form.get('allowNegative') !== null;
    setMessage(null);
    try {
      await client.post(`/jobs/${job.id}/parts`, {
        partId: formText(form, 'partId'),
        action: formText(form, 'action'),
        quantity: formText(form, 'quantity'),
        ...(allowNegative ? { allowNegative: true, reason: formText(form, 'reason') } : {}),
      });
      formElement.reset();
      setRevision((n) => n + 1);
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  async function recordRemoved(event: FormEvent<HTMLFormElement>, partId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    try {
      await client.authorized(`/jobs/${job.id}/parts/removed`, {
        method: 'PUT',
        body: {
          partId,
          removedPartDescription: formText(form, 'removedPartDescription'),
          disposition: formText(form, 'disposition'),
          ...(formText(form, 'removedPartSerial').trim()
            ? { removedPartSerial: formText(form, 'removedPartSerial').trim() }
            : {}),
        },
      });
      setRevision((n) => n + 1);
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  return (
    <div>
      <ResourceView resource={jobParts}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted">No parts reserved or used yet.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <strong>
                    {r.part.sku} — {r.part.name}
                  </strong>
                  : reserved {qty(r.reserved)}, used {qty(r.consumed)}, returned to stock{' '}
                  {qty(r.returned)}
                  {r.disposition
                    ? ` · removed part: ${r.removedPartDescription ?? ''} (${DISPOSITION_LABELS[r.disposition]})`
                    : ''}
                  {canUse && Number(r.consumed) > 0 && !r.disposition ? (
                    <details>
                      <summary>Record the removed (old) part</summary>
                      <form onSubmit={(e) => void recordRemoved(e, r.part.id)} noValidate>
                        <FormField
                          id={`removedPartDescription-${r.id}`}
                          name="removedPartDescription"
                          label="Removed part description"
                          required
                        />
                        <FormField
                          id={`removedPartSerial-${r.id}`}
                          name="removedPartSerial"
                          label="Removed part serial (optional)"
                        />
                        <SelectField
                          id={`disposition-${r.id}`}
                          name="disposition"
                          label="What happened to it?"
                        >
                          {REMOVED_PART_DISPOSITIONS.map((d) => (
                            <option key={d} value={d}>
                              {DISPOSITION_LABELS[d]}
                            </option>
                          ))}
                        </SelectField>
                        <button type="submit">Save</button>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </ResourceView>
      {canUse ? (
        <form onSubmit={(e) => void act(e)} noValidate aria-label="Part action" className="card">
          <FormField
            id="partSearch"
            label="Find part (SKU or name)"
            type="search"
            onChange={(e) => setSearch(e.target.value.trim())}
          />
          <ResourceView resource={catalogue}>
            {(parts) => (
              <SelectField id="partId" label="Part" required>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </SelectField>
            )}
          </ResourceView>
          <div className="grid-2">
            <SelectField id="action" label="Action" defaultValue="RESERVE">
              <option value="RESERVE">Reserve for this job</option>
              <option value="CONSUME">Use (fit) on this job</option>
              <option value="RETURN">Return unused part to stock</option>
              <option value="RELEASE">Release reservation</option>
            </SelectField>
            <FormField
              id="quantity"
              label="Quantity"
              inputMode="decimal"
              defaultValue="1"
              required
            />
          </div>
          {canOverride ? (
            <>
              <label className="checkbox">
                <input type="checkbox" name="allowNegative" /> Allow stock below zero (audited)
              </label>
              <FormField id="reason" label="Reason for override" />
            </>
          ) : null}
          {message ? (
            <p role="alert" className="form-error">
              {message}
            </p>
          ) : null}
          <button type="submit">Apply</button>
        </form>
      ) : null}
    </div>
  );
}
