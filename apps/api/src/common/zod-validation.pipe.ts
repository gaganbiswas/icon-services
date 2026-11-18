import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { AppException } from './app-exception.js';

/**
 * Validates and parses input with a shared Zod contract (ADR 0004).
 * Messages describe the rule, never echo submitted values.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The request is invalid',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
