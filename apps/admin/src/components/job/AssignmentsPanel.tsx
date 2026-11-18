import type { JobWorkspace } from '@icon/contracts';
import { useState } from 'react';

import { useAuth } from '../../lib/auth';
import { formMessage } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';
import { SelectField } from '../Inputs';

export function AssignmentsPanel({
  jobId,
  workspace,
  onChanged,
}: {
  jobId: string;
  workspace: JobWorkspace;
  onChanged: () => void;
}) {
  const { client } = useAuth();
  const canAssign = useCan('jobs.assign');
  const technicians = useResource(
    () =>
      canAssign
        ? client.get<{ id: string; fullName: string }[]>(`/jobs/${jobId}/assignable-technicians`)
        : Promise.resolve([]),
    [client, jobId, canAssign],
  );
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const active = workspace.assignments.filter((a) => a.endedAt === null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setSelected('');
      onChanged();
    } catch (caught) {
      setError(formMessage(caught));
    }
  }

  return (
    <div>
      {active.length === 0 ? <p className="muted">No technician assigned.</p> : null}
      <ul>
        {active.map((a) => (
          <li key={a.id}>
            {a.technician.fullName}{' '}
            <span className="muted small">since {new Date(a.assignedAt).toLocaleString()}</span>{' '}
            {canAssign ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const reason = window.prompt('Reason for removing this technician?');
                  if (reason?.trim()) {
                    void run(() =>
                      client.authorized(
                        `/jobs/${jobId}/assignments/${a.id}?reason=${encodeURIComponent(reason.trim())}`,
                        { method: 'DELETE' },
                      ),
                    );
                  }
                }}
              >
                Unassign
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canAssign && technicians.status === 'ready' ? (
        <div className="actions">
          <SelectField
            id="technician"
            label="Assign technician"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose…</option>
            {technicians.data
              .filter((u) => !active.some((a) => a.technician.id === u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
          </SelectField>
          <div style={{ alignSelf: 'end' }}>
            <button
              type="button"
              disabled={!selected}
              onClick={() =>
                void run(() =>
                  client.post(`/jobs/${jobId}/assignments`, { technicianUserId: selected }),
                )
              }
            >
              Assign
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
