import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export interface ChannelMessage {
  readonly to: string;
  readonly template: string;
  readonly parameters: Record<string, string | null>;
  /** Stable per outbox entry + channel, for provider-side de-duplication. */
  readonly idempotencyKey: string;
}

export class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ProviderError';
  }
}

/** Provider adapter (CLAUDE.md §4.10): swapping providers never touches job logic. */
export interface ChannelAdapter {
  readonly channel: 'WHATSAPP' | 'EMAIL';
  readonly provider: string;
  /** Resolves with the provider message ID when the provider ACCEPTS the request. */
  send(message: ChannelMessage): Promise<{ providerMessageId: string }>;
}

export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');

/**
 * Mock adapter used until real providers are chosen (Phase 10). Records
 * messages in memory; never logs content. Tests can make it fail.
 */
abstract class MockAdapter implements ChannelAdapter {
  abstract readonly channel: 'WHATSAPP' | 'EMAIL';
  readonly provider = 'mock';
  readonly sent: ChannelMessage[] = [];
  private failures = 0;

  /** Makes the next `count` sends fail with a retryable provider error. */
  failNext(count: number): void {
    this.failures = count;
  }

  send(message: ChannelMessage): Promise<{ providerMessageId: string }> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new ProviderError('MOCK_TEMPORARY_FAILURE'));
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
