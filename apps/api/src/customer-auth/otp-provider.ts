import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/** Adapter for delivering one-time codes (SMS/WhatsApp provider TBD, ADR 0012). */
export interface OtpProvider {
  send(phoneE164: string, code: string): Promise<void>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

/**
 * DEVELOPMENT ONLY. Writes the code to the local console in development so a
 * developer can sign in; never logs in test/production. The environment schema
 * refuses OTP_PROVIDER=mock when NODE_ENV=production.
 */
@Injectable()
export class MockOtpProvider implements OtpProvider {
  private readonly logger = new Logger('MockOtpProvider');
  /** Last code per phone — read by automated tests only. */
  readonly sent = new Map<string, string>();

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  send(phoneE164: string, code: string): Promise<void> {
    if (this.env.NODE_ENV === 'production') {
      return Promise.reject(new Error('Mock OTP provider cannot be used in production'));
    }
    this.sent.set(phoneE164, code);
    if (this.env.NODE_ENV === 'development') {
      this.logger.warn(`[DEV ONLY] sign-in code for …${phoneE164.slice(-4)}: ${code}`);
    }
    return Promise.resolve();
  }
}
