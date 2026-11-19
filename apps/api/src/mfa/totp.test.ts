import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SecretBox } from './secret-box.js';
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUri, timeStep } from './totp.js';

// RFC 6238 Appendix B (SHA-1 secret "12345678901234567890", 8 digits → last 6 here).
const RFC_SECRET = Buffer.from('12345678901234567890');
const VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(VECTORS)('t=%i gives the reference code', (seconds, expected8) => {
    expect(hotp(RFC_SECRET, timeStep(new Date(seconds * 1000)))).toBe(expected8.slice(-6));
  });

  it('accepts the previous, current and next step only', () => {
    const at = new Date(1_700_000_000_000);
    const step = timeStep(at);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step), at)).toBe(step);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1n), at)).toBe(step - 1n);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1n), at)).toBe(step + 1n);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2n), at)).toBeNull();
    expect(matchTotp(RFC_SECRET, '12345', at)).toBeNull();
  });

  it('round-trips base32 and builds an otpauth URI', () => {
    const secret = randomBytes(20);
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(otpauthUri(RFC_SECRET, 'a@b.test', 'ICON Service')).toBe(
      'otpauth://totp/ICON%20Service%3Aa%40b.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ICON+Service&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));
  it('seals and opens; detects tampering and purpose changes', () => {
    const sealed = box.seal(Buffer.from('secret'), 'mfa:user-1');
    expect(sealed).not.toContain('secret');
    expect(box.open(sealed, 'mfa:user-1').toString()).toBe('secret');
    expect(() => box.open(sealed, 'mfa:user-2')).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('other!').toString('base64url');
    expect(() => box.open(parts.join('.'), 'mfa:user-1')).toThrow();
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
