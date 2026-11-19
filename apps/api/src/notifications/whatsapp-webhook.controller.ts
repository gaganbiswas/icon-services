import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Public } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

/** Meta WhatsApp webhook (ADR 0018). Public, but every POST must carry a valid signature. */
@ApiExcludeController()
@Public()
@UseGuards(ThrottlerGuard)
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly webhooks: WhatsAppWebhookService) {}

  @Get()
  verify(@Query() query: Record<string, unknown>, @Res() res: Response): void {
    if (!this.webhooks.enabled) throw AppException.notFound('Webhook');
    const challenge = this.webhooks.verifySubscription(
      query['hub.mode'],
      query['hub.verify_token'],
      query['hub.challenge'],
    );
    if (challenge === null)
      throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Verification failed');
    res.status(200).type('text/plain').send(challenge);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    if (!this.webhooks.enabled) throw AppException.notFound('Webhook');
    if (!this.webhooks.verifySignature(req.rawBody, signature)) {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Invalid signature');
    }
    await this.webhooks.handle(body);
    return { received: true };
  }
}
