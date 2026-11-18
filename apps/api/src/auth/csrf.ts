import { HttpStatus } from '@nestjs/common';
import { CSRF_HEADER } from '@icon/contracts';
import type { Request } from 'express';

import { AppException } from '../common/app-exception.js';

/**
 * CSRF defence for cookie-authenticated endpoints (ADR 0010): a custom header
 * (forces a CORS preflight that the allow-list blocks) plus an Origin check.
 */
export function assertCsrfSafe(req: Request, allowedOrigins: readonly string[]): void {
  const rejected = new AppException(HttpStatus.FORBIDDEN, 'CSRF_REJECTED', 'Request rejected');
  if (req.header(CSRF_HEADER) !== '1') {
    throw rejected;
  }
  const origin = req.header('origin');
  if (origin !== undefined && !allowedOrigins.includes(origin)) {
    throw rejected;
  }
}
