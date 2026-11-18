import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { createAppRouter } from '../../router';
import { ME, fakeClient, json } from '../../test/fake-api';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};
const BRANCH = { id: 'b1', code: 'A1', name: 'Main', isActive: true, timezone: null };
const LEVEL = {
  part: {
    id: 'p1',
    sku: 'KB-X1',
    name: 'Keyboard',
    description: null,
    category: null,
    unit: 'EA',
    reorderLevel: '2.0000',
    sellingPrice: '1500.0000',
    isActive: true,
    version: 1,
  },
  branchId: 'b1',
  onHand: '5.0000',
  reserved: '4.0000',
  available: '1.0000',
  reorderLevel: '2.0000',
  belowReorder: true,
};

function setup(permissions: string[]) {
  const { client, calls } = fakeClient((url, init) => {
    const path = url.split('/api/v1')[1] ?? '';
    if (path === '/auth/refresh') return json(200, TOKEN);
    if (path === '/me') return json(200, { ...ME, permissions });
    if (path === '/branches') return json(200, [BRANCH]);
    if (path.startsWith('/inventory/stock')) return json(200, [LEVEL]);
    if (path === '/suppliers') return json(200, []);
    if (path === '/inventory/receipts' && init.method === 'POST') return json(201, LEVEL);
    return json(404, {});
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/inventory'] }));
  render(
    <AuthProvider client={client}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return calls;
}

describe('inventory page', () => {
  it('shows stock with a text low-stock marker and filters to low stock', async () => {
    const calls = setup(['inventory.read']);
    const row = (await screen.findByText('KB-X1')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Low')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Receive' })).toBeNull();
    await userEvent.setup().click(screen.getByLabelText('Show only low stock'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('belowReorder=true'))).toBe(true));
  });

  it('offers the negative-stock override only to authorized users', async () => {
    setup(['inventory.read', 'inventory.write', 'inventory.adjust']);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Adjust' }));
    expect(screen.queryByLabelText(/Allow stock to go below zero/)).toBeNull();
  });

  it('receives stock for the selected branch', async () => {
    const calls = setup(['inventory.read', 'inventory.write']);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Receive' }));
    await user.type(screen.getByLabelText('Quantity'), '3');
    await user.type(screen.getByLabelText('Unit cost (optional)'), '900');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/inventory/receipts'))).toBe(true),
    );
    const raw = calls.find((c) => c.url.endsWith('/inventory/receipts'))?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({
      branchId: 'b1',
      partId: 'p1',
      quantity: '3',
      unitCost: '900',
    });
  });
});
