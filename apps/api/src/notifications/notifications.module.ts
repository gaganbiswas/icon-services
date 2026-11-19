import { Module } from '@nestjs/common';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import {
  CHANNEL_ADAPTERS,
  type ChannelAdapter,
  DisabledAdapter,
  MockEmailAdapter,
  MockWhatsAppAdapter,
} from './channel-adapter.js';
import { MetaWhatsAppClient } from './meta-whatsapp.client.js';
import { NotificationDispatcher } from './notification-dispatcher.service.js';
import { NotificationsController } from './notifications.controller.js';
import { MetaWhatsAppAdapter, SmtpEmailAdapter } from './providers.js';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

/** Adapters chosen by configuration (ADR 0018); production refuses the mocks. */
export const notificationProviders = [
  MockWhatsAppAdapter,
  MockEmailAdapter,
  MetaWhatsAppClient,
  MetaWhatsAppAdapter,
  SmtpEmailAdapter,
  {
    provide: CHANNEL_ADAPTERS,
    inject: [APP_ENV, MockWhatsAppAdapter, MockEmailAdapter, MetaWhatsAppAdapter, SmtpEmailAdapter],
    useFactory: (
      env: Env,
      mockWhatsApp: MockWhatsAppAdapter,
      mockEmail: MockEmailAdapter,
      meta: MetaWhatsAppAdapter,
      smtp: SmtpEmailAdapter,
    ): ChannelAdapter[] => [
      env.WHATSAPP_PROVIDER === 'meta'
        ? meta
        : env.WHATSAPP_PROVIDER === 'mock'
          ? mockWhatsApp
          : new DisabledAdapter('WHATSAPP'),
      env.EMAIL_PROVIDER === 'smtp'
        ? smtp
        : env.EMAIL_PROVIDER === 'mock'
          ? mockEmail
          : new DisabledAdapter('EMAIL'),
    ],
  },
  NotificationDispatcher,
];

/** Dispatcher and adapters only — used by the worker process. */
@Module({
  providers: notificationProviders,
  exports: [NotificationDispatcher, MockWhatsAppAdapter, MockEmailAdapter, MetaWhatsAppClient],
})
export class NotificationDeliveryModule {}

/** HTTP notification centre plus delivery providers — used by the API. */
@Module({
  imports: [NotificationDeliveryModule],
  controllers: [NotificationsController, WhatsAppWebhookController],
  providers: [WhatsAppWebhookService],
  exports: [NotificationDeliveryModule],
})
export class NotificationsModule {}
