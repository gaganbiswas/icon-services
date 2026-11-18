import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createAppRouter } from './router';

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
}

describe('admin router', () => {
  it('renders the home page at /', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ICON INFOSYS SERVICE MANAGEMENT' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Staff admin panel')).toBeInTheDocument();
  });

  it('renders the not-found page for unknown routes', async () => {
    renderAt('/does-not-exist');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
