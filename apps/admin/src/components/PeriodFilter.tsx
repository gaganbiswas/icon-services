import type { Branch } from '@icon/contracts';
import { type FormEvent, type ReactNode, useState } from 'react';

import { useAuth } from '../lib/auth';
import { formText } from '../lib/form-errors';
import { useResource } from '../lib/use-resource';
import { FormField } from './FormField';
import { SelectField } from './Inputs';

export interface Period {
  /** ISO instants for [from, to): local dates, "to" inclusive on screen. */
  from: string;
  to: string;
  branchId: string | undefined;
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function toPeriod(fromDate: string, toDate: string, branchId: string): Period {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString(), branchId: branchId || undefined };
}

/** Date range + branch filter; the default period is the last `days` days including today. */
export function usePeriod(days = 30) {
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  const [fields, setFields] = useState({
    from: localDate(start),
    to: localDate(new Date()),
    branchId: '',
  });
  return { fields, setFields, period: toPeriod(fields.from, fields.to, fields.branchId) };
}

export function PeriodFilter({
  fields,
  onChange,
  withDates = true,
  children,
}: {
  fields: { from: string; to: string; branchId: string };
  onChange: (next: { from: string; to: string; branchId: string }) => void;
  withDates?: boolean;
  children?: ReactNode;
}) {
  const { client } = useAuth();
  const branches = useResource(() => client.get<Branch[]>('/branches'), [client]);
  const [key, setKey] = useState(0);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onChange({
      from: withDates ? formText(form, 'from') : fields.from,
      to: withDates ? formText(form, 'to') : fields.to,
      branchId: formText(form, 'branchId'),
    });
    setKey((k) => k + 1);
  }

  return (
    <form className="grid-2" onSubmit={onSubmit} aria-label="Report filters" data-revision={key}>
      {withDates ? (
        <>
          <FormField id="from" label="From" type="date" defaultValue={fields.from} />
          <FormField id="to" label="To (inclusive)" type="date" defaultValue={fields.to} />
        </>
      ) : null}
      {branches.status === 'ready' ? (
        <SelectField id="branchId" label="Branch" defaultValue={fields.branchId}>
          <option value="">All my branches</option>
          {branches.data.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {children}
      <div>
        <button type="submit">Show</button>
      </div>
    </form>
  );
}
