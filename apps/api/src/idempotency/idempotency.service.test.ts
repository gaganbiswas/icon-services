import { describe, expect, it } from 'vitest';

import { hashRequest, requireIdempotencyKey } from './idempotency.service.js';

describe('hashRequest', () => {
  it('ignores key order and detects value changes', () => {
    expect(hashRequest({ a: 1, b: { c: [1, 2] } })).toBe(hashRequest({ b: { c: [1, 2] }, a: 1 }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
    expect(hashRequest({ list: [1, 2] })).not.toBe(hashRequest({ list: [2, 1] }));
  });
});

describe('requireIdempotencyKey', () => {
  it('accepts safe keys and rejects missing or malformed ones', () => {
    expect(requireIdempotencyKey('01HZX-abc_123')).toBe('01HZX-abc_123');
    expect(() => requireIdempotencyKey(undefined)).toThrow(/required/);
    expect(() => requireIdempotencyKey('short')).toThrow();
    expect(() => requireIdempotencyKey('has space in it')).toThrow();
  });
});
