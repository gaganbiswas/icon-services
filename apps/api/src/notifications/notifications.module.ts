import { Module } from '@nestjs/common';

import { CHANNEL_ADAPTERS, MockEmailAdapter, MockWhatsAppAdapter } from './channel-adapter.js';
import { NotificationDispatcher } from './notification-dispatcher.service.js';
import { NotificationsController } from './notifications.controller.js';

/** Channel adapters are mocks until providers are selected (ADR 0013, Phase 10). */
export const notificationProviders = [
  MockWhatsAppAdapter,
  MockEmailAdapter,
  {
    provide: CHANNEL_ADAPTERS,
    inject: [MockWhatsAppAdapter, MockEmailAdapter],
    useFactory: (whatsapp: MockWhatsAppAdapter, email: MockEmailAdapter) => [whatsapp, email],
  },
  NotificationDispatcher,
];

/** Dispatcher and adapters only — used by the worker process. */
@Module({
  providers: notificationProviders,
  exports: [NotificationDispatcher, MockWhatsAppAdapter, MockEmailAdapter],
})
export class NotificationDeliveryModule {}

/** HTTP notification centre plus delivery providers — used by the API. */
@Module({
  imports: [NotificationDeliveryModule],
  controllers: [NotificationsController],
  exports: [NotificationDeliveryModule],
})
export class NotificationsModule {}
