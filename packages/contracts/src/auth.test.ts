import { describe, expect, it } from 'vitest';

import { LoginRequestSchema, PasswordSchema } from './auth.js';
import { UpdateUserRequestSchema } from './users.js';

describe('PasswordSchema', () => {
  it('enforces length bounds', () => {
    expect(PasswordSchema.safeParse('short').success).toBe(false);
    expect(PasswordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(PasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

describe('LoginRequestSchema', () => {
  it('trims e-mail and rejects invalid addresses', () => {
    expect(LoginRequestSchema.parse({ email: '  a@example.com ', password: 'x' }).email).toBe(
      'a@example.com',
    );
    expect(LoginRequestSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(
      false,
    );
  });
});

describe('UpdateUserRequestSchema', () => {
  it('requires a reason when deactivating', () => {
    expect(UpdateUserRequestSchema.safeParse({ version: 1, isActive: false }).success).toBe(false);
    expect(
      UpdateUserRequestSchema.safeParse({ version: 1, isActive: false, reason: 'Left company' })
        .success,
    ).toBe(true);
  });
});
