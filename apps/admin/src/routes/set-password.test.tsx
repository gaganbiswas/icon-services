import { describe, expect, it } from 'vitest';

import { readTokenFromHash } from './set-password';

describe('readTokenFromHash', () => {
  it('reads a well-formed token from the fragment', () => {
    const token = 'A'.repeat(43);
    expect(readTokenFromHash(`#token=${token}`)).toBe(token);
  });

  it('rejects missing or malformed tokens', () => {
    expect(readTokenFromHash('')).toBeNull();
    expect(readTokenFromHash('#token=short')).toBeNull();
    expect(readTokenFromHash(`#token=${'A'.repeat(40)}<script>`)).toBeNull();
  });
});
