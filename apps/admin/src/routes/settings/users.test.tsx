import type * as RouterExports from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { ME, fakeClient, json } from '../../test/fake-api';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterExports>()),
  Link: ({ children }: { children: unknown }) => children,
}));

const { UsersPage } = await import('./users');

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
  mfaEnrollmentRequired: false,
};
const ROLE = {
  id: '01a1eeac-6f23-74c8-bac5-000000000001',
  code: 'RECEPTION',
  name: 'Reception',
  description: null,
  isSystem: true,
  permissions: ['jobs.read'],
  version: 1,
};
const BRANCH = {
  id: '01a1eeac-6f23-74c8-bac5-000000000002',
  code: 'A1',
  name: 'Central',
  isActive: true,
  timezone: null,
};

describe('UsersPage', () => {
  it('creates a user with roles and branches and shows the one-time set-up link', async () => {
    const { client, calls } = fakeClient((url, init) => {
      const path = url.split('/api/v1')[1] ?? '';
      if (path === '/auth/refresh') return json(200, TOKEN);
      if (path === '/me')
        return json(200, { ...ME, permissions: ['users.read', 'users.manage', 'roles.read'] });
      if (path.startsWith('/users') && init.method === 'POST')
        return json(201, {
          user: {
            id: 'u2',
            fullName: 'Nisha',
            email: 'n@x.test',
            roles: [],
            branches: [],
            version: 1,
          },
          passwordSetup: { token: 'T'.repeat(43), expiresAt: '2026-11-20T10:00:00.000Z' },
        });
      if (path.startsWith('/users'))
        return json(200, { items: [], total: 0, page: 1, pageSize: 100 });
      if (path === '/roles') return json(200, [ROLE]);
      if (path === '/branches') return json(200, [BRANCH]);
      return json(404, {});
    });
    render(
      <AuthProvider client={client}>
        <UsersPage />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add staff user' }));
    const dialog = screen.getByRole('dialog', { name: 'Add staff user' });
    await user.type(within(dialog).getByLabelText('Full name'), 'Nisha');
    await user.type(within(dialog).getByLabelText('Email'), 'n@x.test');
    await user.click(within(dialog).getByLabelText('Reception'));
    await user.click(within(dialog).getByLabelText('Central (A1)'));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/users') && c.init.method === 'POST')).toBe(true),
    );
    const raw = calls.find((c) => c.url.endsWith('/users') && c.init.method === 'POST')?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({
      fullName: 'Nisha',
      email: 'n@x.test',
      roleIds: [ROLE.id],
      branchIds: [BRANCH.id],
    });
    expect(
      await screen.findByRole('dialog', { name: 'Set-up link for Nisha' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/\/set-password#token=TTTT/)).toBeInTheDocument();
  });
});
