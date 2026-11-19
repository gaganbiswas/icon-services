import { SETTINGS } from '@icon/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { ME, fakeClient, json } from '../../test/fake-api';
import { NotificationSettingsForm } from './notifications';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};

describe('NotificationSettingsForm', () => {
  it('saves approved template names, quiet hours and a reason', async () => {
    const { client, calls } = fakeClient((url, init) => {
      const path = url.split('/api/v1')[1] ?? '';
      if (path === '/auth/refresh') return json(200, TOKEN);
      if (path === '/me')
        return json(200, { ...ME, permissions: ['settings.read', 'settings.manage'] });
      if (path === '/settings') return json(200, { notifications: SETTINGS.notifications.default });
      if (path === '/settings/notifications' && init.method === 'PUT') return json(200, {});
      return json(404, {});
    });
    render(
      <AuthProvider client={client}>
        <NotificationSettingsForm />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('WhatsApp template for job received'),
      'job_received_v1',
    );
    await user.type(screen.getByLabelText('From (HH:MM)'), '21:00');
    await user.type(screen.getByLabelText('Until (HH:MM)'), '08:00');
    await user.type(
      screen.getByLabelText('Reason for change (audited)'),
      'Templates approved by Meta',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'PUT')).toBe(true));
    const raw = calls.find((c) => c.init.method === 'PUT')?.init.body;
    const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as {
      value: { templates: Record<string, unknown>; quietHours: unknown };
      reason: string;
    };
    expect(body.value.templates['JOB_RECEIVED']).toEqual({
      whatsapp: { name: 'job_received_v1', language: 'en' },
      emailSubject: 'We have received your service request',
    });
    expect(body.value.templates['PAYMENT_RECEIVED']).toEqual({
      whatsapp: null,
      emailSubject: 'Payment received',
    });
    expect(body.value.quietHours).toEqual({ start: '21:00', end: '08:00' });
    expect(body.reason).toBe('Templates approved by Meta');
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
});
