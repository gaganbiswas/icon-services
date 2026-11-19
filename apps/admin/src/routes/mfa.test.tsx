import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as RouterExports from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth';
import { ME, fakeClient, json } from '../test/fake-api';

type RouterModule = typeof RouterExports;

const navigate = vi.fn(() => Promise.resolve());
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<RouterModule>()),
  Link: ({ children }: { children: unknown }) => children,
  Navigate: () => null,
  useNavigate: () => navigate,
}));

const { LoginPage } = await import('./login');
const { SecurityPage } = await import('./security');

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
  mfaEnrollmentRequired: false,
};
const CHALLENGE = 'c'.repeat(43);

describe('Two-step sign-in', () => {
  it('asks for the code after the password and signs in with it', async () => {
    let signedIn = false;
    const { client, calls } = fakeClient((url, init) => {
      const path = url.split('/api/v1')[1] ?? '';
      if (path === '/auth/refresh')
        return signedIn
          ? json(200, TOKEN)
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
      if (path === '/auth/login')
        return json(200, { mfaRequired: true, challengeToken: CHALLENGE, expiresIn: 300 });
      if (path === '/auth/mfa/verify' && init.method === 'POST') {
        signedIn = true;
        return json(200, TOKEN);
      }
      if (path === '/me') return json(200, ME);
      return json(404, {});
    });
    render(
      <AuthProvider client={client}>
        <LoginPage />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'boss@a.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Two-step sign-in' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code'), '123 456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    const verify = calls.find((c) => c.url.endsWith('/auth/mfa/verify'));
    const raw = verify?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({
      challengeToken: CHALLENGE,
      code: '123456',
    });
  });

  it('walks a required user through set-up and shows recovery codes once', async () => {
    let enabled = false;
    const { client } = fakeClient((url, init) => {
      const path = url.split('/api/v1')[1] ?? '';
      if (path === '/auth/refresh') return json(200, { ...TOKEN, mfaEnrollmentRequired: true });
      if (path === '/me')
        return json(200, { ...ME, mfaEnrollmentRequired: !enabled, mfaEnabled: enabled });
      if (path === '/auth/mfa')
        return json(200, { enabled, required: true, recoveryCodesRemaining: enabled ? 10 : 0 });
      if (path === '/auth/mfa/enrollment' && init.method === 'POST')
        return json(201, {
          secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
          otpauthUri:
            'otpauth://totp/ICON%20Service%3Aboss?secret=JBSWY3DPEHPK3PXP&issuer=ICON+Service',
        });
      if (path === '/auth/mfa/enrollment/confirm' && init.method === 'POST') {
        enabled = true;
        return json(200, { recoveryCodes: ['abcde-fghij', 'klmno-pqrst'] });
      }
      return json(404, {});
    });
    render(
      <AuthProvider client={client}>
        <SecurityPage />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    expect(await screen.findByText(/required before you continue/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }));
    expect(
      await screen.findByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Enter the 6-digit code shown in the app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));
    expect(await screen.findByText('abcde-fghij')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have saved these codes' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    expect(screen.queryByText('abcde-fghij')).toBeNull();
  });
});
