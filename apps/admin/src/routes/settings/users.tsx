import type {
  Branch,
  CreatedUserResponse,
  Page,
  PasswordSetupTokenResponse,
  Role,
  User,
} from '@icon/contracts';
import { PERMISSIONS as PERMISSION_DESCRIPTIONS } from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { FormDialog } from '../../components/FormDialog';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { SettingsNav } from '../../components/SettingsNav';
import { useAuth } from '../../lib/auth';
import { formMessage } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/settings/users')({
  component: () => (
    <RequireAuth>
      <AppShell title="Settings">
        <SettingsNav />
        <UsersPage />
      </AppShell>
    </RequireAuth>
  ),
});

const setupUrl = (token: string) => `${window.location.origin}/set-password#token=${token}`;

type Dialog =
  | { kind: 'new' }
  | { kind: 'edit'; user: User }
  | { kind: 'mfa'; user: User }
  | { kind: 'role'; role: Role | null }
  | { kind: 'link'; name: string; token: string; expiresAt: string };

function Checkboxes({
  name,
  legend,
  items,
  checked,
}: {
  name: string;
  legend: string;
  items: { id: string; label: string }[];
  checked: Set<string>;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="checkbox-grid">
        {items.map((i) => (
          <label key={i.id} className="checkbox">
            <input type="checkbox" name={name} value={i.id} defaultChecked={checked.has(i.id)} />{' '}
            {i.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Staff users, roles and permissions (CLAUDE.md §5 screen 16). The API enforces every rule again. */
export function UsersPage() {
  const { client } = useAuth();
  const canManageUsers = useCan('users.manage');
  const canManageRoles = useCan('roles.manage');
  const canReadRoles = useCan('roles.read');
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const users = useResource(
    () => client.get<Page<User>>('/users', { pageSize: 100 }),
    [client, revision],
  );
  const roles = useResource(
    () => (canReadRoles ? client.get<Role[]>('/roles') : Promise.resolve([] as Role[])),
    [client, canReadRoles, revision],
  );
  const branches = useResource(() => client.get<Branch[]>('/branches'), [client]);
  const refresh = () => setRevision((n) => n + 1);
  const roleItems =
    roles.status === 'ready' ? roles.data.map((r) => ({ id: r.id, label: r.name })) : [];
  const branchItems =
    branches.status === 'ready'
      ? branches.data.map((b) => ({ id: b.id, label: `${b.name} (${b.code})` }))
      : [];

  async function newLink(user: User) {
    setMessage(null);
    try {
      const link = await client.post<PasswordSetupTokenResponse>(
        `/users/${user.id}/password-setup`,
      );
      setDialog({
        kind: 'link',
        name: user.fullName,
        token: link.token,
        expiresAt: link.expiresAt,
      });
    } catch (caught) {
      setMessage(formMessage(caught));
    }
  }

  return (
    <>
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <section aria-labelledby="users-heading">
        <div className="page-header">
          <h2 id="users-heading">Staff users</h2>
          {canManageUsers ? (
            <button type="button" onClick={() => setDialog({ kind: 'new' })}>
              Add staff user
            </button>
          ) : null}
        </div>
        <ResourceView resource={users}>
          {(page) => (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Roles</th>
                    <th scope="col">Branches</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last sign-in</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((u) => (
                    <tr key={u.id}>
                      <td>{u.fullName}</td>
                      <td>{u.email}</td>
                      <td>{u.roles.map((r) => r.name).join(', ') || '—'}</td>
                      <td>{u.branches.map((b) => b.code).join(', ') || 'All / none'}</td>
                      <td>
                        {!u.isActive
                          ? 'Deactivated'
                          : u.isLocked
                            ? 'Locked (too many attempts)'
                            : u.mustChangePassword
                              ? 'Must change password'
                              : 'Active'}
                      </td>
                      <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                      <td className="actions">
                        {canManageUsers ? (
                          <>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setDialog({ kind: 'edit', user: u })}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => void newLink(u)}
                            >
                              Set-up link
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setDialog({ kind: 'mfa', user: u })}
                            >
                              Reset two-step
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ResourceView>
      </section>

      {canReadRoles ? (
        <section aria-labelledby="roles-heading">
          <div className="page-header">
            <h2 id="roles-heading">Roles</h2>
            {canManageRoles ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setDialog({ kind: 'role', role: null })}
              >
                New role
              </button>
            ) : null}
          </div>
          <ResourceView resource={roles}>
            {(list) => (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="num">
                        Permissions
                      </th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.name}
                          {r.isSystem ? <span className="muted small"> · built-in</span> : null}
                        </td>
                        <td>{r.description ?? '—'}</td>
                        <td className="num">{r.permissions.length}</td>
                        <td className="actions">
                          {canManageRoles ? (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setDialog({ kind: 'role', role: r })}
                            >
                              Edit permissions
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ResourceView>
        </section>
      ) : null}

      {dialog?.kind === 'new' ? (
        <FormDialog
          title="Add staff user"
          description="They receive no password: give them the one-time set-up link shown next. Privileged roles must set up two-step sign-in."
          fields={[
            { name: 'fullName', label: 'Full name', required: true },
            { name: 'email', label: 'Email', required: true },
          ]}
          submitLabel="Create user"
          onSubmit={async (v, data) => {
            const created = await client.post<CreatedUserResponse>('/users', {
              fullName: v['fullName'],
              email: v['email'],
              roleIds: data.getAll('role').map(String),
              branchIds: data.getAll('branch').map(String),
            });
            refresh();
            setTimeout(() =>
              setDialog({
                kind: 'link',
                name: created.user.fullName,
                token: created.passwordSetup.token,
                expiresAt: created.passwordSetup.expiresAt,
              }),
            );
          }}
          onClose={() => setDialog((d) => (d?.kind === 'new' ? null : d))}
        >
          <Checkboxes name="role" legend="Roles" items={roleItems} checked={new Set()} />
          <Checkboxes name="branch" legend="Branches" items={branchItems} checked={new Set()} />
        </FormDialog>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <FormDialog
          title={`Edit ${dialog.user.fullName}`}
          fields={[
            {
              name: 'fullName',
              label: 'Full name',
              required: true,
              defaultValue: dialog.user.fullName,
            },
            {
              name: 'active',
              label: 'Account',
              type: 'select',
              required: true,
              defaultValue: dialog.user.isActive ? 'yes' : 'no',
              options: [
                { value: 'yes', label: 'Active' },
                { value: 'no', label: 'Deactivated (cannot sign in)' },
              ],
            },
            { name: 'reason', label: 'Reason (required when deactivating)', type: 'textarea' },
          ]}
          submitLabel="Save"
          onSubmit={async (v, data) => {
            await client.patch(`/users/${dialog.user.id}`, {
              version: dialog.user.version,
              fullName: v['fullName'],
              isActive: v['active'] === 'yes',
              roleIds: data.getAll('role').map(String),
              branchIds: data.getAll('branch').map(String),
              ...(v['reason'] ? { reason: v['reason'] } : {}),
            });
            refresh();
          }}
          onClose={() => setDialog(null)}
        >
          <Checkboxes
            name="role"
            legend="Roles"
            items={roleItems}
            checked={new Set(dialog.user.roles.map((r) => r.id))}
          />
          <Checkboxes
            name="branch"
            legend="Branches"
            items={branchItems}
            checked={new Set(dialog.user.branches.map((b) => b.id))}
          />
        </FormDialog>
      ) : null}

      {dialog?.kind === 'mfa' ? (
        <FormDialog
          title={`Reset two-step sign-in for ${dialog.user.fullName}?`}
          description="Use this when they lost their phone and recovery codes. They are signed out and must set it up again. Confirm their identity first."
          fields={[
            {
              name: 'reason',
              label: 'Reason (recorded in the audit log)',
              type: 'textarea',
              required: true,
            },
          ]}
          submitLabel="Reset two-step sign-in"
          danger
          onSubmit={async (v) => {
            await client.post(`/users/${dialog.user.id}/mfa/reset`, { reason: v['reason'] });
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'role' ? (
        <FormDialog
          title={dialog.role ? `Permissions of ${dialog.role.name}` : 'New role'}
          description="Each permission is checked by the server on every request."
          fields={[
            ...(dialog.role
              ? []
              : [{ name: 'code', label: 'Code (e.g. SENIOR_TECH)', required: true }]),
            { name: 'name', label: 'Name', required: true, defaultValue: dialog.role?.name ?? '' },
            ...(dialog.role
              ? [
                  {
                    name: 'reason',
                    label: 'Reason for the change',
                    type: 'textarea' as const,
                    required: true,
                  },
                ]
              : []),
          ]}
          submitLabel="Save role"
          onSubmit={async (v, data) => {
            const permissions = data.getAll('permission').map(String);
            if (dialog.role) {
              await client.patch(`/roles/${dialog.role.id}`, {
                version: dialog.role.version,
                name: v['name'],
                permissions,
                reason: v['reason'],
              });
            } else {
              await client.post('/roles', { code: v['code'], name: v['name'], permissions });
            }
            refresh();
          }}
          onClose={() => setDialog(null)}
        >
          <Checkboxes
            name="permission"
            legend="Permissions"
            items={Object.entries(PERMISSION_DESCRIPTIONS).map(([code, text]) => ({
              id: code,
              label: `${text} (${code})`,
            }))}
            checked={new Set(dialog.role?.permissions ?? [])}
          />
        </FormDialog>
      ) : null}

      {dialog?.kind === 'link' ? (
        <FormDialog
          title={`Set-up link for ${dialog.name}`}
          description={`Give this link to ${dialog.name} privately (it works once and expires ${new Date(dialog.expiresAt).toLocaleString()}). It is not shown again.`}
          fields={[]}
          submitLabel="Done"
          onSubmit={() => Promise.resolve()}
          onClose={() => setDialog(null)}
        >
          <p>
            <code className="secret">{setupUrl(dialog.token)}</code>
          </p>
        </FormDialog>
      ) : null}
    </>
  );
}
