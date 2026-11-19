import {
  NOTIFICATION_EVENTS,
  type NotificationSettings,
  TEMPLATE_PARAMETERS,
} from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { FormField } from '../../components/FormField';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/settings/notifications')({
  component: () => (
    <RequireAuth>
      <NotificationSettingsPage />
    </RequireAuth>
  ),
});

const label = (event: string) => event.replace(/_/g, ' ').toLowerCase();

function NotificationSettingsPage() {
  return (
    <AppShell title="Notification templates">
      <NotificationSettingsForm />
    </AppShell>
  );
}

/** Approved WhatsApp templates, email subjects and quiet hours (ADR 0018). */
export function NotificationSettingsForm() {
  const { client } = useAuth();
  const canManage = useCan('settings.manage');
  const [revision, setRevision] = useState(0);
  const settings = useResource(
    () => client.get<{ notifications: NotificationSettings }>('/settings'),
    [client, revision],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => formText(form, name).trim();
    const templates = Object.fromEntries(
      NOTIFICATION_EVENTS.map((e) => [
        e,
        {
          whatsapp: text(`${e}.name`)
            ? { name: text(`${e}.name`), language: text(`${e}.language`) || 'en' }
            : null,
          emailSubject: text(`${e}.subject`) || null,
        },
      ]),
    );
    const quietHours =
      text('quietStart') && text('quietEnd')
        ? { start: text('quietStart'), end: text('quietEnd') }
        : null;
    setMessage(null);
    setErrors({});
    try {
      await client.put('/settings/notifications', {
        value: { templates, quietHours },
        reason: text('reason'),
      });
      setMessage('Saved.');
      setRevision((n) => n + 1);
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    }
  }

  return (
    <>
      <p className="muted small">
        WhatsApp messages are sent only with templates approved by Meta. Enter the exact approved
        name and language; leave the name empty to skip WhatsApp for that event. Body parameters
        must be registered in the order shown.
      </p>
      <ResourceView resource={settings}>
        {({ notifications }) => (
          <form onSubmit={(e) => void save(e)} noValidate aria-label="Notification templates">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">WhatsApp template</th>
                    <th scope="col">Language</th>
                    <th scope="col">Parameters</th>
                    <th scope="col">Email subject</th>
                  </tr>
                </thead>
                <tbody>
                  {NOTIFICATION_EVENTS.map((e) => {
                    const current = notifications.templates[e];
                    return (
                      <tr key={e}>
                        <th scope="row">{label(e)}</th>
                        <td>
                          <FormField
                            id={`${e}.name`}
                            label={`WhatsApp template for ${label(e)}`}
                            defaultValue={current?.whatsapp?.name ?? ''}
                            disabled={!canManage}
                            error={errors[`value.templates.${e}.whatsapp.name`]}
                          />
                        </td>
                        <td>
                          <FormField
                            id={`${e}.language`}
                            label="Language"
                            defaultValue={current?.whatsapp?.language ?? 'en'}
                            disabled={!canManage}
                            maxLength={6}
                          />
                        </td>
                        <td className="small">
                          {TEMPLATE_PARAMETERS[e].map((p, i) => `{{${i + 1}}} ${p}`).join(', ')}
                        </td>
                        <td>
                          <FormField
                            id={`${e}.subject`}
                            label={`Email subject for ${label(e)}`}
                            defaultValue={current?.emailSubject ?? ''}
                            disabled={!canManage}
                            maxLength={200}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <fieldset>
              <legend>Quiet hours (business time zone; empty = off)</legend>
              <div className="grid-2">
                <FormField
                  id="quietStart"
                  label="From (HH:MM)"
                  defaultValue={notifications.quietHours?.start ?? ''}
                  disabled={!canManage}
                />
                <FormField
                  id="quietEnd"
                  label="Until (HH:MM)"
                  defaultValue={notifications.quietHours?.end ?? ''}
                  disabled={!canManage}
                />
              </div>
            </fieldset>
            {canManage ? (
              <>
                <FormField id="reason" label="Reason for change (audited)" required />
                {message ? (
                  <p
                    role={message === 'Saved.' ? 'status' : 'alert'}
                    className={message === 'Saved.' ? '' : 'form-error'}
                  >
                    {message}
                  </p>
                ) : null}
                <button type="submit">Save</button>
              </>
            ) : null}
          </form>
        )}
      </ResourceView>
    </>
  );
}
