import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export interface ChannelMessage {
  /** E.164 phone (WhatsApp) or e-mail address. */
  readonly to: string;
  readonly event: string;
  /** WhatsApp: approved template with ordered body parameters. */
  readonly template?: {
    readonly name: string;
    readonly language: string;
    readonly parameters: readonly string[];
  };
  /** Email: subject and plain-text body. */
  readonly subject?: string;
  readonly text?: string;
  /** Stable per outbox entry + channel, for provider-side de-duplication. */
  readonly idempotencyKey: string;
}

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    /** Retryable errors back off and retry; permanent ones go straight to DEAD. */
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

/** Provider adapter (CLAUDE.md §4.10): swapping providers never touches job logic. */
export interface ChannelAdapter {
  readonly channel: 'WHATSAPP' | 'EMAIL';
  readonly provider: string;
  /** False when the channel is disabled: deliveries are recorded SKIPPED_NOT_CONFIGURED. */
  readonly configured: boolean;
  /** Resolves with the provider message ID when the provider ACCEPTS the request (not delivery). */
  send(message: ChannelMessage): Promise<{ providerMessageId: string }>;
}

export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');

/**
 * Mock adapter for development and automated tests. Records messages in
 * memory; never logs content. Tests can make it fail.
 */
abstract class MockAdapter implements ChannelAdapter {
  abstract readonly channel: 'WHATSAPP' | 'EMAIL';
  readonly provider = 'mock';
  readonly configured = true;
  readonly sent: ChannelMessage[] = [];
  private failures = 0;
  private permanent = false;

  /** Makes the next `count` sends fail (retryable unless `permanent`). */
  failNext(count: number, permanent = false): void {
    this.failures = count;
    this.permanent = permanent;
  }

  send(message: ChannelMessage): Promise<{ providerMessageId: string }> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(
        new ProviderError(
          this.permanent ? 'MOCK_PERMANENT_FAILURE' : 'MOCK_TEMPORARY_FAILURE',
          !this.permanent,
        ),
      );
    }
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `mock-${randomUUID()}` });
  }
}

@Injectable()
export class MockWhatsAppAdapter extends MockAdapter {
  readonly channel = 'WHATSAPP' as const;
}

@Injectable()
export class MockEmailAdapter extends MockAdapter {
  readonly channel = 'EMAIL' as const;
}

/** Channel switched off by configuration. */
export class DisabledAdapter implements ChannelAdapter {
  readonly provider = 'disabled';
  readonly configured = false;
  constructor(readonly channel: 'WHATSAPP' | 'EMAIL') {}
  send(): Promise<{ providerMessageId: string }> {
    return Promise.reject(new ProviderError('CHANNEL_DISABLED', false));
  }
}
