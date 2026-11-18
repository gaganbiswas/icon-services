import { describe, expect, it } from 'vitest';

import { REDACTED, redact } from './redact.js';

describe('redact', () => {
  it('removes secrets at any depth and keeps other fields', () => {
    const input = {
      email: 'a@example.test',
      passwordHash: '$argon2id$...',
      nested: { refreshToken: 'abc', name: 'x', list: [{ apiSecret: 's', ok: 1 }] },
      Authorization: 'Bearer x',
    };
    expect(redact(input)).toEqual({
      email: 'a@example.test',
      passwordHash: REDACTED,
      nested: { refreshToken: REDACTED, name: 'x', list: [{ apiSecret: REDACTED, ok: 1 }] },
      Authorization: REDACTED,
    });
  });

  it('serialises dates and bigints', () => {
    expect(redact({ at: new Date('2026-01-01T00:00:00Z'), n: 10n })).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      n: '10',
    });
  });

  it('limits depth', () => {
    type Deep = { next?: Deep };
    const root: Deep = {};
    let cursor = root;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(JSON.stringify(redact(root))).toContain('[TRUNCATED]');
  });
});
