import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { AppShell } from '../../components/AppShell';
import { CustomerForm } from '../../components/CustomerForm';
import { RequireAuth } from '../../components/RequireAuth';

export const Route = createFileRoute('/customers/new')({
  component: () => (
    <RequireAuth>
      <NewCustomerPage />
    </RequireAuth>
  ),
});

function NewCustomerPage() {
  const navigate = useNavigate();
  return (
    <AppShell title="New customer">
      <CustomerForm
        onCreated={(customer) =>
          void navigate({ to: '/customers/$customerId', params: { customerId: customer.id } })
        }
      />
    </AppShell>
  );
}
