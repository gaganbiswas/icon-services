import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from './lib/api-client';
import { AuthProvider } from './lib/auth';
import { createAppRouter } from './router';
import { ME, fakeClient, json } from './test/fake-api';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};

function renderAt(path: string, client: ApiClient) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <AuthProvider client={client}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

describe('admin routing and sign-in', () => {
  it('redirects anonymous users to the sign-in page', async () => {
    const { client } = fakeClient(() =>
      json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }),
    );
    const router = renderAt('/', client);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('restores a session from the refresh cookie and shows the account', async () => {
    const { client } = fakeClient((url) =>
      url.endsWith('/auth/refresh') ? json(200, TOKEN) : json(200, ME),
    );
    renderAt('/', client);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Signed in as Asha Admin' }),
    ).toBeInTheDocument();
    expect(screen.getByText('All branches')).toBeInTheDocument();
  });

  it('shows the generic error message on failed sign-in', async () => {
    const message = 'Invalid email or password, or the account is temporarily locked.';
    const { client } = fakeClient((url) =>
      url.endsWith('/auth/login')
        ? json(401, { error: { code: 'INVALID_CREDENTIALS', message } })
        : json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }),
    );
    renderAt('/login', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('sends users who must change their password to the change-password page', async () => {
    const { client } = fakeClient((url) =>
      url.endsWith('/auth/refresh')
        ? json(200, TOKEN)
        : json(200, { ...ME, mustChangePassword: true }),
    );
    const router = renderAt('/', client);
    expect(
      await screen.findByText('You must choose a new password before continuing.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'));
  });

  it('renders the not-found page for unknown routes', async () => {
    const { client } = fakeClient(() => json(401, {}));
    renderAt('/does-not-exist', client);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
