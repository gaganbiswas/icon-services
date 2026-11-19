import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;

/** RFC 4648 base32 without padding (authenticator apps' secret format). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret (RFC 4226 recommendation). */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** HOTP (RFC 4226) with HMAC-SHA-1, 6 digits. */
export function hotp(secret: Buffer, counter: bigint): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, '0');
}

export function timeStep(at: Date): bigint {
  return BigInt(Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS));
}

/**
 * Returns the matching time step (current ±1 for clock drift), or null.
 * Comparison is constant-time per candidate.
 */
export function matchTotp(secret: Buffer, code: string, at: Date): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = timeStep(at);
  let found: bigint | null = null;
  for (const step of [now - 1n, now, now + 1n]) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) found = step;
  }
  return found;
}

export function otpauthUri(secret: Buffer, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
