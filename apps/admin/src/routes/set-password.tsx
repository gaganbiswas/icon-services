import { PasswordSchema } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useMemo, useState } from 'react';

import { FormField } from '../components/FormField';
import { useAuth } from '../lib/auth';
import { fieldErrors, formMessage, formText } from '../lib/form-errors';

export const Route = createFileRoute('/set-password')({
  component: SetPasswordPage,
});

/** Reads the one-time token from the URL fragment (never sent to servers). */
export function readTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
}

export function SetPasswordPage() {
  const { client } = useAuth();
  const token = useMemo(() => readTokenFromHash(window.location.hash), []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    const newPassword = formText(form, 'newPassword');
    const confirm = formText(form, 'confirmPassword');
    const policy = PasswordSchema.safeParse(newPassword);
    if (!policy.success) {
      setErrors({ newPassword: policy.error.issues[0]?.message ?? 'Invalid password' });
      return;
    }
    if (newPassword !== confirm) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    setErrors({});
    setMessage(null);
    try {
      await client.completePasswordSetup(token, newPassword);
      // Remove the used token from the address bar and history.
      window.history.replaceState(null, '', window.location.pathname);
      setDone(true);
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    }
  }

  if (!token) {
    return (
      <main className="narrow">
        <h1>Set your password</h1>
        <p role="alert" className="form-error">
          This link is incomplete or invalid. Ask an administrator for a new set-up link.
        </p>
      </main>
    );
  }

  if (done) {
    return (
      <main className="narrow">
        <h1>Password set</h1>
        <p>Your password has been saved.</p>
        <Link to="/login">Go to sign in</Link>
      </main>
    );
  }

  return (
    <main className="narrow">
      <h1>Set your password</h1>
      <p className="muted">Use at least 12 characters. A short phrase is easier to remember.</p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <FormField
          id="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          error={errors['newPassword']}
        />
        <FormField
          id="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          error={errors['confirmPassword']}
        />
        {message ? (
          <p role="alert" className="form-error">
            {message}
          </p>
        ) : null}
        <button type="submit">Save password</button>
      </form>
    </main>
  );
}
