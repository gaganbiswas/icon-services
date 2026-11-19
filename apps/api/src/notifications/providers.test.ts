import { describe, expect, it, vi } from 'vitest';

import { testEnv } from '../../test/test-env.js';
import { ProviderError } from './channel-adapter.js';
import { MetaWhatsAppClient } from './meta-whatsapp.client.js';
import { minutesUntilQuietEnd } from './providers.js';

const metaEnv = testEnv({
  WHATSAPP_PROVIDER: 'meta',
  WHATSAPP_API_BASE_URL: 'https://graph.example.test',
  WHATSAPP_GRAPH_API_VERSION: 'v23.0',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ACCESS_TOKEN: 'EAAG' + 'x'.repeat(40),
  WHATSAPP_APP_SECRET: 's'.repeat(32),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'v'.repeat(24),
  WHATSAPP_ORGANIZATION_CODE: 'DEV',
});

function client(status: number, body: unknown) {
  const c = new MetaWhatsAppClient(metaEnv);
  const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  c.fetchImpl = fetchImpl;
  return { c, fetchImpl };
}

describe('MetaWhatsAppClient', () => {
  it('sends an approved template in the Cloud API format', async () => {
    const { c, fetchImpl } = client(200, { messages: [{ id: 'wamid.ABC' }] });
    await expect(
      c.sendTemplate({
        to: '+919812345678',
        name: 'job_received_v1',
        language: 'en',
        bodyParameters: ['A1-1', 'Received'],
        buttonParameter: '123456',
      }),
    ).resolves.toEqual({ providerMessageId: 'wamid.ABC' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.example.test/v23.0/123456789012345/messages');
    expect((init.headers as Record<string, string>)['Authorization']).toMatch(/^Bearer EAAG/);
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '{}')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919812345678',
      type: 'template',
      template: {
        name: 'job_received_v1',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'A1-1' },
              { type: 'text', text: 'Received' },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: '123456' }],
          },
        ],
      },
    });
  });

  it.each([
    [429, { error: { code: 130429 } }, 'META_130429', true],
    [500, {}, 'HTTP_500', true],
    [400, { error: { code: 132001 } }, 'META_132001', false],
    [401, { error: { code: 190 } }, 'META_190', false],
  ])('maps HTTP %i to %s (retryable=%s)', async (status, body, code, retryable) => {
    const { c } = client(status, body);
    const error = await c
      .sendTemplate({ to: '+1', name: 't', language: 'en', bodyParameters: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code, retryable });
  });

  it('treats network failures as retryable', async () => {
    const c = new MetaWhatsAppClient(metaEnv);
    c.fetchImpl = () => Promise.reject(new TypeError('fetch failed'));
    await expect(
      c.sendTemplate({ to: '+1', name: 't', language: 'en', bodyParameters: [] }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });
});

describe('minutesUntilQuietEnd', () => {
  const at = (iso: string) => new Date(iso);
  it('handles windows crossing midnight', () => {
    const w = { start: '21:00', end: '08:00' };
    expect(minutesUntilQuietEnd(at('2026-11-18T22:30:00Z'), 'UTC', w)).toBe(570);
    expect(minutesUntilQuietEnd(at('2026-11-18T07:30:00Z'), 'UTC', w)).toBe(30);
    expect(minutesUntilQuietEnd(at('2026-11-18T12:00:00Z'), 'UTC', w)).toBe(0);
  });
  it('uses the business time zone and treats null as off', () => {
    expect(
      minutesUntilQuietEnd(at('2026-11-18T16:00:00Z'), 'Asia/Kolkata', {
        start: '21:00',
        end: '08:00',
      }),
    ).toBe(630);
    expect(minutesUntilQuietEnd(at('2026-11-18T22:30:00Z'), 'UTC', null)).toBe(0);
  });
});
