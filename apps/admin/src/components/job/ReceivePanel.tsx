import { DEFAULT_INTAKE_CHECKLIST, type JobDetail } from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../../lib/auth';
import { formMessage, formText } from '../../lib/form-errors';
import { FormField } from '../FormField';
import { SelectField, TextAreaField } from '../Inputs';

/** Records the physical intake of a device for an app-submitted request. */
export function ReceivePanel({ job, onReceived }: { job: JobDetail; onReceived: () => void }) {
  const { client } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage(null);
    try {
      await client.post(`/jobs/${job.id}/receive`, {
        version: job.version,
        acknowledgementMethod:
          formText(form, 'acknowledgementMethod') === 'VERBAL' ? 'VERBAL' : 'SIGNED_PAPER',
        accessoriesReceived: formText(form, 'accessories')
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        intakeChecklist: DEFAULT_INTAKE_CHECKLIST.map((item, i) => ({
          item,
          checked: form.get(`rcheck${i}`) !== null,
        })),
        ...(formText(form, 'conditionNotes').trim()
          ? { conditionNotes: formText(form, 'conditionNotes').trim() }
          : {}),
      });
      onReceived();
    } catch (caught) {
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate aria-label="Receive device">
      <p>The customer submitted this request from the app. Record the device when it arrives.</p>
      <FormField
        id="accessories"
        label="Accessories received (comma separated)"
        defaultValue={job.accessoriesReceived.join(', ')}
      />
      <TextAreaField id="conditionNotes" label="Visible condition" />
      <fieldset>
        <legend>Intake checklist</legend>
        {DEFAULT_INTAKE_CHECKLIST.map((item, i) => (
          <label key={item} className="checkbox">
            <input type="checkbox" name={`rcheck${i}`} /> {item}
          </label>
        ))}
      </fieldset>
      <SelectField
        id="acknowledgementMethod"
        label="Customer acknowledgement"
        defaultValue="SIGNED_PAPER"
      >
        <option value="SIGNED_PAPER">Signed printed receipt</option>
        <option value="VERBAL">Verbal confirmation</option>
      </SelectField>
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Mark device received'}
        </button>
      </div>
    </form>
  );
}
