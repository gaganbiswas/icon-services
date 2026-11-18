import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ErrorCode, ErrorResponse } from '@icon/contracts';
import type { Response } from 'express';

import { AppException } from './app-exception.js';
import { currentRequestContext } from './request-context.js';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'FILE_TOO_LARGE',
};

/**
 * Converts every error into the standard envelope. Unexpected errors become a
 * generic 500: no stack traces, driver messages or secrets reach the client.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { requestId } = currentRequestContext();
    const [status, body] = this.toResponse(exception, requestId);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown, requestId: string): [number, ErrorResponse] {
    if (exception instanceof AppException) {
      return [
        exception.status,
        {
          error: {
            code: exception.code,
            message: exception.message,
            requestId,
            ...(exception.details ? { details: [...exception.details] } : {}),
          },
        },
      ];
    }
    if (exception instanceof ThrottlerException) {
      return [
        HttpStatus.TOO_MANY_REQUESTS,
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Try again later.',
            requestId,
          },
        },
      ];
    }
    if (exception instanceof HttpException) {
      const status: number = exception.getStatus();
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
      const message =
        status === (HttpStatus.NOT_FOUND as number)
          ? 'Route not found'
          : status >= 500
            ? 'An unexpected error occurred'
            : 'The request could not be processed';
      return [status, { error: { code, message, requestId } }];
    }
    const name = exception instanceof Error ? exception.name : 'non-error';
    this.logger.error(`Unhandled ${name} (request ${requestId})`);
    if (exception instanceof Error && exception.stack && process.env['NODE_ENV'] !== 'production') {
      this.logger.debug(exception.stack);
    }
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId } },
    ];
  }
}
