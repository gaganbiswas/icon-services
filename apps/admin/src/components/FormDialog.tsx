import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { fieldErrors, formMessage } from '../lib/form-errors';

export interface DialogField {
  readonly name: string;
  readonly label: string;
  readonly type?: 'text' | 'textarea' | 'number' | 'select';
  readonly required?: boolean;
  readonly defaultValue?: string;
  readonly hint?: string;
  readonly options?: readonly { value: string; label: string }[];
  readonly inputMode?: 'decimal' | 'text';
}

/**
 * Accessible modal form (native <dialog>: focus stays inside, Escape closes),
 * used instead of browser prompt boxes for reasons, refunds and confirmations.
 * The submit handler may throw; its message is shown inside the dialog.
 */
export function FormDialog({
  title,
  description,
  fields,
  submitLabel,
  danger = false,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  fields: readonly DialogField[];
  submitLabel: string;
  danger?: boolean;
  /** `data` also carries any extra inputs rendered as children (e.g. checkbox groups). */
  onSubmit: (values: Record<string, string>, data: FormData) => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // jsdom has no showModal; real browsers get a true modal.
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', cancel);
    return () => dialog.removeEventListener('cancel', cancel);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries(
      fields.map((f) => [
        f.name,
        (() => {
          const v = data.get(f.name);
          return typeof v === 'string' ? v.trim() : '';
        })(),
      ]),
    );
    const missing = fields.filter((f) => f.required && !values[f.name]);
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((f) => [f.name, 'Required'])));
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await onSubmit(values, data);
      onClose();
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setError(formMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <h2 id={titleId}>{title}</h2>
        {description ? <div className="muted">{description}</div> : null}
        {children}
        {fields.map((f) => {
          const id = `${titleId}-${f.name}`;
          const errorId = `${id}-error`;
          const common = {
            id,
            name: f.name,
            defaultValue: f.defaultValue,
            'aria-invalid': errors[f.name] ? true : undefined,
            'aria-describedby': errors[f.name] ? errorId : undefined,
          } as const;
          return (
            <div className="field" key={f.name}>
              <label htmlFor={id}>
                {f.label}
                {f.required ? '' : ' (optional)'}
              </label>
              {f.type === 'textarea' ? (
                <textarea {...common} maxLength={500} />
              ) : f.type === 'select' ? (
                <select {...common}>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input {...common} type="text" inputMode={f.inputMode} maxLength={500} />
              )}
              {f.hint ? <p className="muted small">{f.hint}</p> : null}
              {errors[f.name] ? (
                <p id={errorId} className="field-error">
                  {errors[f.name]}
                </p>
              ) : null}
            </div>
          );
        })}
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className={danger ? 'danger' : undefined} disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
