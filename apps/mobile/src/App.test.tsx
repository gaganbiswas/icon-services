import { render, screen } from '@testing-library/react-native';

import App from './App';

describe('App', () => {
  it('renders the product name as a header', async () => {
    await render(<App />);
    expect(screen.getByRole('header')).toHaveTextContent('ICON INFOSYS SERVICE MANAGEMENT');
    expect(screen.getByText('Customer app')).toBeOnTheScreen();
  });
});
