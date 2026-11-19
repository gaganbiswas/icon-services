import { describe, expect, it } from 'vitest';

import { TEMPLATE_PARAMETERS, templateParameters } from './notification-templates.js';
import { NOTIFICATION_EVENTS, NotificationSettingsSchema, SETTINGS } from './settings.js';

describe('notification templates', () => {
  it('defines parameters for every event and valid defaults', () => {
    for (const event of NOTIFICATION_EVENTS)
      expect(TEMPLATE_PARAMETERS[event].length).toBeGreaterThan(0);
    expect(NotificationSettingsSchema.parse(SETTINGS.notifications.default)).toBeTruthy();
  });

  it('orders parameters and sanitizes values for WhatsApp', () => {
    expect(
      templateParameters('JOB_UPDATE_POSTED', {
        jobNumber: 'A1-1',
        message: 'Part\nordered\t   now      ok',
      }),
    ).toEqual(['A1-1', 'Part ordered   now   ok']);
    expect(
      templateParameters('ESTIMATE_DECISION_RECORDED', { jobNumber: 'A1-1', decision: null }),
    ).toEqual(['A1-1', '-']);
  });

  it('validates template names and quiet hours', () => {
    const bad = { ...SETTINGS.notifications.default, quietHours: { start: '25:00', end: '08:00' } };
    expect(NotificationSettingsSchema.safeParse(bad).success).toBe(false);
    const named = {
      ...SETTINGS.notifications.default,
      templates: {
        ...SETTINGS.notifications.default.templates,
        JOB_RECEIVED: { whatsapp: { name: 'Job Received', language: 'en' }, emailSubject: null },
      },
    };
    expect(NotificationSettingsSchema.safeParse(named).success).toBe(false);
  });
});
