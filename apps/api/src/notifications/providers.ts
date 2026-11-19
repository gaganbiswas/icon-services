import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { type ChannelAdapter, type ChannelMessage, ProviderError } from './channel-adapter.js';
import { MetaWhatsAppClient } from './meta-whatsapp.client.js';

/** WhatsApp via Meta Cloud API — approved templates only (ADR 0018). */
@Injectable()
export class MetaWhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'WHATSAPP' as const;
  readonly provider = 'meta';

  constructor(private readonly client: MetaWhatsAppClient) {}

  get configured(): boolean {
    return this.client.configured;
  }

  send(message: ChannelMessage): Promise<{ providerMessageId: string }> {
    if (!message.template)
      return Promise.reject(new ProviderError('TEMPLATE_NOT_CONFIGURED', false));
    return this.client.sendTemplate({
      to: message.to,
      name: message.template.name,
      language: message.template.language,
      bodyParameters: message.template.parameters,
    });
  }
}

interface SmtpError {
  responseCode?: number;
  code?: string;
}

/** Transactional email over SMTP (any provider). No delivery callbacks: stays ACCEPTED. */
@Injectable()
export class SmtpEmailAdapter implements ChannelAdapter, OnModuleDestroy {
  readonly channel = 'EMAIL' as const;
  readonly provider = 'smtp';
  readonly configured: boolean;
  private readonly transporter: Transporter | null;

  constructor(@Inject(APP_ENV) private readonly env: Env) {
    this.configured = Boolean(env.SMTP_HOST && env.EMAIL_FROM);
    this.transporter = this.configured
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          ...(env.SMTP_USER && env.SMTP_PASSWORD
            ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
            : {}),
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : null;
  }

  async send(message: ChannelMessage): Promise<{ providerMessageId: string }> {
    if (!this.transporter || !this.env.EMAIL_FROM)
      throw new ProviderError('EMAIL_NOT_CONFIGURED', false);
    if (!message.subject || !message.text)
      throw new ProviderError('TEMPLATE_NOT_CONFIGURED', false);
    try {
      const info = (await this.transporter.sendMail({
        from: this.env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        headers: { 'X-Entity-Ref-ID': message.idempotencyKey },
      })) as { messageId?: string };
      return { providerMessageId: info.messageId ?? `smtp-${message.idempotencyKey}` };
    } catch (error) {
      const e = error as SmtpError;
      // 4xx SMTP replies and connection problems are temporary; 5xx are permanent.
      if (e.responseCode !== undefined)
        throw new ProviderError(`SMTP_${e.responseCode}`, e.responseCode < 500);
      throw new ProviderError(e.code ? `SMTP_${e.code}` : 'SMTP_ERROR', true);
    }
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}

/** Minutes until quiet hours end, or 0 when outside them (window may cross midnight). */
export function minutesUntilQuietEnd(
  now: Date,
  timeZone: string,
  window: { start: string; end: string } | null,
): number {
  if (!window) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const current = hh * 60 + mm;
  const start = toMin(window.start);
  const end = toMin(window.end);
  if (start === end) return 0;
  const inside =
    start < end ? current >= start && current < end : current >= start || current < end;
  if (!inside) return 0;
  return (end - current + 24 * 60) % (24 * 60);
}
