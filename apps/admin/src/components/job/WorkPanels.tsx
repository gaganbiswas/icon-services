import { type JobDetail, type JobWorkspace, QC_CHECKLIST } from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { FormField } from '../FormField';
import { SelectField, TextAreaField } from '../Inputs';

function useSubmit(onDone: () => void) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(form: HTMLFormElement, action: () => Promise<unknown>) {
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      await action();
      form.reset();
      onDone();
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }
  return { errors, message, saving, submit };
}

export function DiagnosisPanel({
  jobId,
  workspace,
  onChanged,
}: {
  jobId: string;
  workspace: JobWorkspace;
  onChanged: () => void;
}) {
  const { client } = useAuth();
  const canWrite = useCan('diagnosis.write') && workspace.canWork;
  const canInternal = useCan('jobs.internal_notes.write');
  const { errors, message, saving, submit } = useSubmit(onChanged);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const optional = (name: string) =>
      formText(form, name).trim() ? { [name]: formText(form, name).trim() } : {};
    void submit(formElement, () =>
      client.post(`/jobs/${jobId}/diagnoses`, {
        symptom: formText(form, 'symptom'),
        findings: formText(form, 'findings'),
        ...optional('rootCause'),
        ...optional('recommendation'),
        ...(canInternal ? optional('internalNotes') : {}),
      }),
    );
  }

  return (
    <div>
      {workspace.diagnoses.length === 0 ? (
        <p className="muted">No diagnosis recorded yet.</p>
      ) : null}
      {workspace.diagnoses.map((d) => (
        <article key={d.id} className="card">
          <p className="muted small">
            {d.technician.fullName} · {new Date(d.createdAt).toLocaleString()}
          </p>
          <dl className="summary">
            <dt>Symptom</dt>
            <dd>{d.symptom}</dd>
            <dt>Findings</dt>
            <dd>{d.findings}</dd>
            {d.rootCause ? (
              <>
                <dt>Root cause</dt>
                <dd>{d.rootCause}</dd>
              </>
            ) : null}
            {d.recommendation ? (
              <>
                <dt>Recommendation</dt>
                <dd>{d.recommendation}</dd>
              </>
            ) : null}
            {d.internalNotes ? (
              <>
                <dt>Internal notes (staff only)</dt>
                <dd>{d.internalNotes}</dd>
              </>
            ) : null}
          </dl>
        </article>
      ))}
      {canWrite ? (
        <details>
          <summary>Add diagnosis</summary>
          <form onSubmit={onSubmit} noValidate aria-label="Add diagnosis">
            <TextAreaField id="symptom" label="Symptom" required error={errors['symptom']} />
            <TextAreaField id="findings" label="Findings" required error={errors['findings']} />
            <TextAreaField id="rootCause" label="Root cause (optional)" />
            <TextAreaField id="recommendation" label="Recommended work (optional)" />
            {canInternal ? (
              <TextAreaField
                id="internalNotes"
                label="Internal notes (staff only, never shown to the customer)"
              />
            ) : null}
            {message ? (
              <p role="alert" className="form-error">
                {message}
              </p>
            ) : null}
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save diagnosis'}
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function WorkLogPanel({
  jobId,
  workspace,
  onChanged,
}: {
  jobId: string;
  workspace: JobWorkspace;
  onChanged: () => void;
}) {
  const { client } = useAuth();
  const canWrite = useCan('worklogs.write') && workspace.canWork;
  const canInternal = useCan('jobs.internal_notes.write');
  const { errors, message, saving, submit } = useSubmit(onChanged);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const minutes = Number(formText(form, 'durationMinutes'));
    void submit(formElement, () =>
      client.post(`/jobs/${jobId}/work-logs`, {
        description: formText(form, 'description'),
        visibility: formText(form, 'visibility') === 'CUSTOMER' ? 'CUSTOMER' : 'INTERNAL',
        ...(Number.isInteger(minutes) && minutes > 0 ? { durationMinutes: minutes } : {}),
      }),
    );
  }

  return (
    <div>
      {workspace.workLogs.length === 0 ? <p className="muted">No work recorded yet.</p> : null}
      <ul>
        {workspace.workLogs.map((w) => (
          <li key={w.id}>
            <strong>{w.visibility === 'CUSTOMER' ? 'Customer update' : 'Internal'}</strong> —{' '}
            {w.description}
            <span className="muted small">
              {' '}
              · {w.author.fullName} · {new Date(w.createdAt).toLocaleString()}
              {w.durationMinutes ? ` · ${w.durationMinutes} min` : ''}
            </span>
          </li>
        ))}
      </ul>
      {canWrite ? (
        <details>
          <summary>Add work log or update</summary>
          <form onSubmit={onSubmit} noValidate aria-label="Add work log">
            <SelectField
              id="visibility"
              label="Who can see this?"
              defaultValue={canInternal ? 'INTERNAL' : 'CUSTOMER'}
            >
              {canInternal ? <option value="INTERNAL">Staff only (internal note)</option> : null}
              <option value="CUSTOMER">Customer update (shown to the customer and notified)</option>
            </SelectField>
            <TextAreaField
              id="description"
              label="Description"
              required
              error={errors['description']}
            />
            <FormField
              id="durationMinutes"
              label="Time spent (minutes, optional)"
              type="number"
              min={1}
              max={1440}
            />
            {message ? (
              <p role="alert" className="form-error">
                {message}
              </p>
            ) : null}
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function CompletionPanel({
  job,
  workspace,
  onChanged,
}: {
  job: JobDetail;
  workspace: JobWorkspace;
  onChanged: () => void;
}) {
  const { client } = useAuth();
  const { errors, message, saving, submit } = useSubmit(onChanged);

  if (workspace.completion) {
    return (
      <div>
        <p>
          Completed {new Date(workspace.completion.completedAt).toLocaleString()}:{' '}
          {workspace.completion.repairSummary}
        </p>
        <ul>
          {workspace.completion.qcChecklist.map((c) => (
            <li key={c.item}>
              {c.passed ? 'Passed' : 'Failed'} — {c.item}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (job.status !== 'QUALITY_CHECK' || !workspace.canWork) {
    return <p className="muted">The repair can be completed once the job is in quality check.</p>;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const customerMessage = formText(form, 'completionMessage').trim();
    void submit(formElement, () =>
      client.post(`/jobs/${job.id}/completion`, {
        version: job.version,
        repairSummary: formText(form, 'repairSummary'),
        qcChecklist: QC_CHECKLIST.map((item, i) => ({ item, passed: form.get(`qc${i}`) !== null })),
        ...(customerMessage ? { customerMessage } : {}),
      }),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Complete repair">
      <TextAreaField
        id="repairSummary"
        label="Repair summary"
        required
        error={errors['repairSummary']}
      />
      <fieldset>
        <legend>Quality check (all items must pass)</legend>
        {QC_CHECKLIST.map((item, i) => (
          <label key={item} className="checkbox">
            <input type="checkbox" name={`qc${i}`} /> {item}
          </label>
        ))}
      </fieldset>
      <FormField
        id="completionMessage"
        label="Message for the customer (optional)"
        maxLength={500}
      />
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Complete repair'}
      </button>
    </form>
  );
}
