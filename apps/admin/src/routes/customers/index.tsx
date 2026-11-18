import type { Customer, Page } from '@icon/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { FormField } from '../../components/FormField';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { formText } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/customers/')({
  component: () => (
    <RequireAuth>
      <CustomersPage />
    </RequireAuth>
  ),
});

export function CustomersPage() {
  const { client } = useAuth();
  const canCreate = useCan('customers.write');
  const [q, setQ] = useState('');
  const customers = useResource(
    () => client.get<Page<Customer>>('/customers', { q, pageSize: 50 }),
    [client, q],
  );

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQ(formText(new FormData(event.currentTarget), 'q').trim());
  }

  return (
    <AppShell
      title="Customers"
      actions={
        canCreate ? (
          <Link to="/customers/new" className="button">
            New customer
          </Link>
        ) : null
      }
    >
      <form role="search" onSubmit={onSearch} className="search">
        <FormField
          id="q"
          label="Search by name, phone or customer code"
          type="search"
          defaultValue={q}
        />
        <button type="submit">Search</button>
      </form>
      <ResourceView resource={customers}>
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">No customers found.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <caption className="muted small">{page.total} customer(s)</caption>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.customerCode}</td>
                      <td>
                        <Link to="/customers/$customerId" params={{ customerId: c.id }}>
                          {c.name}
                        </Link>
                      </td>
                      <td>{c.phone}</td>
                      <td>{c.email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ResourceView>
    </AppShell>
  );
}
