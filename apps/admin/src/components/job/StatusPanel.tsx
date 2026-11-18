import type { JobDetail, JobWorkspace } from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { FormField } from '../FormField';
import { SelectField, TextAreaField } from '../Inputs';
import { statusLabel } from '../StatusBadge';

/** Status change: offers only transitions the API allows for this user. */
export function StatusPanel({
  job,
  workspace,
  onChanged,
}: {
  job: JobDetail;
  workspace: JobWorkspace;
  onChanged: () => void;
}) {
  const { client } = useAuth();
  const [to, setTo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const options = workspace.allowedTransitions.filter((t) => t.to !== 'REPAIR_COMPLETED');
  const selected = options.find((t) => t.to === to);

  if (!workspace.canWork) {
    return (
      <p className="muted">This job is not assigned to you, so you cannot change its status.</p>
    );
  }
  if (options.length === 0) {
    return (
      <p className="muted">No status changes are available from “{statusLabel(job.status)}”.</p>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = formText(form, 'reason').trim();
    const customerMessage = formText(form, 'customerMessage').trim();
    if (selected?.reasonRequired && !reason) {
      setErrors({ reason: 'A reason is required for this change' });
      return;
    }
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      await client.post(`/jobs/${job.id}/status-transitions`, {
        to,
        version: job.version,
        ...(reason ? { reason } : {}),
        ...(customerMessage ? { customerMessage } : {}),
      });
      setTo('');
      onChanged();
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate aria-label="Change status">
      <SelectField
        id="to"
        label="New status"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        required
      >
        <option value="">Choose…</option>
        {options.map((t) => (
          <option key={t.to} value={t.to}>
            {statusLabel(t.to)}
            {t.reasonRequired ? ' (reason required)' : ''}
          </option>
        ))}
      </SelectField>
      {to ? (
        <>
          <TextAreaField
            id="reason"
            label={
              selected?.reasonRequired
                ? 'Reason (required, staff only)'
                : 'Reason (optional, staff only)'
            }
            error={errors['reason']}
          />
          <FormField
            id="customerMessage"
            label="Message for the customer (optional, keep it simple)"
            maxLength={500}
          />
        </>
      ) : null}
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={!to || saving}>
          {saving ? 'Saving…' : 'Change status'}
        </button>
      </div>
    </form>
  );
}
