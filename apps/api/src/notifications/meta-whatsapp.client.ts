import { Inject, Injectable } from '@nestjs/common';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ProviderError } from './channel-adapter.js';

/** Graph API error codes that indicate throttling (retry later). */
const RETRYABLE_META_CODES = new Set([4, 80007, 130429, 131048, 131056, 133016]);

interface GraphResponse {
  messages?: { id?: string }[];
  error?: { code?: number; error_subcode?: number };
}

type Fetch = typeof fetch;

/**
 * Minimal client for the WhatsApp Business Platform Cloud API (Meta, ADR 0018).
 * Only approved templates are sent. Message content is never logged.
 */
@Injectable()
export class MetaWhatsAppClient {
  /** Overridable in tests. */
  fetchImpl: Fetch = (...args) => fetch(...args);

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  get configured(): boolean {
    return Boolean(
      this.env.WHATSAPP_GRAPH_API_VERSION &&
      this.env.WHATSAPP_PHONE_NUMBER_ID &&
      this.env.WHATSAPP_ACCESS_TOKEN,
    );
  }

  /** Sends a template; `buttonParameter` fills a copy-code / URL button (authentication templates). */
  async sendTemplate(input: {
    to: string;
    name: string;
    language: string;
    bodyParameters: readonly string[];
    buttonParameter?: string;
  }): Promise<{ providerMessageId: string }> {
    if (!this.configured) throw new ProviderError('WHATSAPP_NOT_CONFIGURED', false);
    const components: unknown[] = [];
    if (input.bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: input.bodyParameters.map((text) => ({ type: 'text', text })),
      });
    }
    if (input.buttonParameter) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: input.buttonParameter }],
      });
    }
    const url = `${this.env.WHATSAPP_API_BASE_URL.replace(/\/$/, '')}/${this.env.WHATSAPP_GRAPH_API_VERSION}/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: input.name,
            language: { code: input.language },
            ...(components.length ? { components } : {}),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ProviderError('NETWORK_ERROR', true);
    }
    const payload = (await response.json().catch(() => ({}))) as GraphResponse;
    if (!response.ok) {
      const code = payload.error?.code;
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (code !== undefined && RETRYABLE_META_CODES.has(code));
      throw new ProviderError(
        code !== undefined ? `META_${code}` : `HTTP_${response.status}`,
        retryable,
      );
    }
    const id = payload.messages?.[0]?.id;
    if (!id) throw new ProviderError('META_NO_MESSAGE_ID', true);
    return { providerMessageId: id };
  }
}
