import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@icon/contracts';

export interface ErrorDetail {
  readonly path: string;
  readonly message: string;
}

/** Domain error mapped to the standard error envelope by AppExceptionFilter. */
export class AppException extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: readonly ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppException';
  }

  static notFound(entity = 'Resource'): AppException {
    return new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${entity} not found`);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppException {
    return new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }

  static unauthenticated(message = 'Authentication required'): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);
  }

  static conflict(message: string): AppException {
    return new AppException(HttpStatus.CONFLICT, 'CONFLICT', message);
  }

  static versionConflict(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      'VERSION_CONFLICT',
      'The record was changed by someone else. Reload and try again.',
    );
  }
}
