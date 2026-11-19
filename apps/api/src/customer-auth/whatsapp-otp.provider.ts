import { Inject, Injectable } from '@nestjs/common';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { MetaWhatsAppClient } from '../notifications/meta-whatsapp.client.js';
import type { OtpProvider } from './otp-provider.js';

/** Sign-in codes via an approved WhatsApp authentication template (ADR 0018). */
@Injectable()
export class WhatsAppOtpProvider implements OtpProvider {
  constructor(
    private readonly client: MetaWhatsAppClient,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async send(phoneE164: string, code: string): Promise<void> {
    await this.client.sendTemplate({
      to: phoneE164,
      name: this.env.WHATSAPP_OTP_TEMPLATE_NAME ?? '',
      language: this.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE,
      bodyParameters: [code],
      // Authentication templates carry the code in the copy-code button too.
      buttonParameter: code,
    });
  }
}
