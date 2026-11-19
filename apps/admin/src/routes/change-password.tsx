import { PasswordSchema } from '@icon/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { FormField } from '../components/FormField';
import { RequireAuth } from '../components/RequireAuth';
import { useAuth } from '../lib/auth';
import { fieldErrors, formMessage, formText } from '../lib/form-errors';

export const Route = createFileRoute('/change-password')({
  component: () => (
    <RequireAuth allowPendingPasswordChange allowPendingMfaEnrollment>
      <ChangePasswordPage />
    </RequireAuth>
  ),
});

export function ChangePasswordPage() {
  const { client, reload, state } = useAuth();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const required = state.status === 'authenticated' && state.me.mustChangePassword;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = formText(form, 'currentPassword');
    const newPassword = formText(form, 'newPassword');
    const policy = PasswordSchema.safeParse(newPassword);
    if (!policy.success) {
      setErrors({ newPassword: policy.error.issues[0]?.message ?? 'Invalid password' });
      return;
    }
    if (newPassword !== formText(form, 'confirmPassword')) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    setErrors({});
    setMessage(null);
    try {
      await client.changePassword(currentPassword, newPassword);
      await reload();
      await navigate({ to: '/' });
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    }
  }

  return (
    <main className="narrow">
      <h1>Change password</h1>
      {required ? <p>You must choose a new password before continuing.</p> : null}
      <p className="muted">Other devices will be signed out.</p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <FormField
          id="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          error={errors['currentPassword']}
        />
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
        <button type="submit">Change password</button>
      </form>
    </main>
  );
}
