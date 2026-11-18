import { hash, verify } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';

import { ARGON2_OPTIONS } from './password-hashing.js';

describe('ARGON2_OPTIONS', () => {
  it('produces Argon2id hashes with the configured cost', async () => {
    const digest = await hash('correct horse battery staple', ARGON2_OPTIONS);
    expect(digest).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verify(digest, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verify(digest, 'wrong password')).resolves.toBe(false);
  });
});
