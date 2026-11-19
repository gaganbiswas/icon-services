import type { MeResponse } from '@icon/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { FormField } from '../components/FormField';
import { ApiError } from '../lib/api-client';
import { useAuth } from '../lib/auth';
import { formMessage, formText } from '../lib/form-errors';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

const destination = (me: MeResponse) =>
  me.mustChangePassword ? '/change-password' : me.mfaEnrollmentRequired ? '/security' : '/';

export function LoginPage() {
  const { signIn, completeMfa } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn(formText(form, 'email'), formText(form, 'password'));
      if (result.kind === 'mfa') setChallenge(result.challengeToken);
      else await navigate({ to: destination(result.me) });
    } catch (caught) {
      setError(formMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const me = await completeMfa(challenge, formText(form, 'code').replace(/\s/g, ''));
      await navigate({ to: destination(me) });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'INVALID_TOKEN') setChallenge(null);
      setError(formMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <main className="narrow">
        <h1>Two-step sign-in</h1>
        <p className="muted">
          Enter the 6-digit code from your authenticator app, or one of your recovery codes.
        </p>
        <form
          key="mfa-code"
          onSubmit={(e) => void onCode(e)}
          noValidate
          aria-label="Verification code"
        >
          <FormField
            id="code"
            label="Code"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
            maxLength={11}
          />
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Checking…' : 'Verify'}
          </button>
        </form>
        <p className="muted small">
          Lost your phone and recovery codes? Ask another administrator to reset two-step sign-in.
        </p>
      </main>
    );
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
