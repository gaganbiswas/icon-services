import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('customer portal home page', () => {
  it('renders the product name as the main heading', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'ICON INFOSYS SERVICE MANAGEMENT' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Customer service portal')).toBeInTheDocument();
  });
});
