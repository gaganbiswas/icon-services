import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { FormField } from '../components/FormField';
import { useAuth } from '../lib/auth';
import { formMessage, formText } from '../lib/form-errors';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const me = await signIn(formText(form, 'email'), formText(form, 'password'));
      await navigate({ to: me.mustChangePassword ? '/change-password' : '/' });
    } catch (caught) {
      setError(formMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="narrow">
      <h1>Sign in</h1>
      <p className="muted">ICON INFOSYS SERVICE MANAGEMENT — staff</p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <FormField id="email" label="Email" type="email" autoComplete="username" required />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted small">
        Forgot your password? Ask an administrator for a new set-up link.
      </p>
    </main>
  );
}
