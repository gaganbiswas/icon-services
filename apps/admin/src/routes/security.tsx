import type { MfaEnrollment, MfaStatus } from '@icon/contracts';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { FormField } from '../components/FormField';
import { QrCode } from '../components/QrCode';
import { RequireAuth } from '../components/RequireAuth';
import { ResourceView } from '../components/ResourceView';
import { useAuth } from '../lib/auth';
import { formMessage, formText } from '../lib/form-errors';
import { useResource } from '../lib/use-resource';

export const Route = createFileRoute('/security')({
  component: () => (
    <RequireAuth allowPendingMfaEnrollment>
      <SecurityPage />
    </RequireAuth>
  ),
});

/** Two-step sign-in set-up (ADR 0011). Privileged staff are sent here until they finish. */
export function SecurityPage() {
  const { client, reload, signOut } = useAuth();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const status = useResource(() => client.get<MfaStatus>('/auth/mfa'), [client, revision]);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setEnrollment(await client.post<MfaEnrollment>('/auth/mfa/enrollment'));
    } catch (caught) {
      setError(formMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setBusy(true);
    try {
      const result = await client.post<{ recoveryCodes: string[] }>(
        '/auth/mfa/enrollment/confirm',
        { code: formText(form, 'code').replace(/\s/g, '') },
      );
      setEnrollment(null);
      setRecoveryCodes(result.recoveryCodes);
    } catch (caught) {
      setError(formMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setRecoveryCodes(null);
    await reload();
    setRevision((n) => n + 1);
    await navigate({ to: '/' });
  }

  return (
    <main className="narrow">
      <h1>Two-step sign-in</h1>
      {recoveryCodes ? (
        <section aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">Save your recovery codes</h2>
          <p>
            Each code works once if you lose your phone. Store them somewhere safe (a password
            manager or printed and locked away). They will not be shown again.
          </p>
          <ul className="recovery-codes">
            {recoveryCodes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void finish()}>
            I have saved these codes
          </button>
        </section>
      ) : (
        <ResourceView resource={status}>
          {(s) =>
            s.enabled ? (
              <>
                <p>Two-step sign-in is on. Recovery codes left: {s.recoveryCodesRemaining}.</p>
                <p className="muted small">
                  Lost your phone? Another administrator can reset it for you.
                </p>
                <Link to="/">Back to home</Link>
              </>
            ) : enrollment ? (
              <form onSubmit={(e) => void confirm(e)} noValidate aria-label="Confirm authenticator">
                <ol>
                  <li>
                    Open an authenticator app (for example Google Authenticator, Microsoft
                    Authenticator or 1Password).
                  </li>
                  <li>Scan this QR code, or enter the key by hand.</li>
                </ol>
                <QrCode value={enrollment.otpauthUri} label="QR code for your authenticator app" />
                <p>
                  Key:{' '}
                  <code className="secret">
                    {enrollment.secret.replace(/(.{4})/g, '$1 ').trim()}
                  </code>
                </p>
                <FormField
                  id="code"
                  label="Enter the 6-digit code shown in the app"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={7}
                  required
                />
                {error ? (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                ) : null}
                <button type="submit" disabled={busy}>
                  {busy ? 'Checking…' : 'Turn on two-step sign-in'}
                </button>
              </form>
            ) : (
              <>
                <p>
                  {s.required
                    ? 'Your role can change sensitive settings, so two-step sign-in is required before you continue.'
                    : 'Protect your account with a code from your phone in addition to your password.'}
                </p>
                {error ? (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                ) : null}
                <div className="actions">
                  <button type="button" onClick={() => void start()} disabled={busy}>
                    Set up two-step sign-in
                  </button>
                  {s.required ? (
                    <button type="button" className="secondary" onClick={() => void signOut()}>
                      Sign out
                    </button>
                  ) : (
                    <Link to="/">Not now</Link>
                  )}
                </div>
              </>
            )
          }
        </ResourceView>
      )}
    </main>
  );
}
