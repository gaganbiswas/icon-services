import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';

export interface NormalizedPhone {
  /** E.164, e.g. +919812345678 — stored and used for matching. */
  readonly e164: string;
  /** International format for display. */
  readonly display: string;
}

/**
 * Normalizes a phone number to E.164. Without a confirmed default region
 * (ADR 0012), numbers must include the country code (e.g. +91…).
 */
export function normalizePhone(input: string, defaultRegion?: string): NormalizedPhone | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultRegion as CountryCode | undefined);
  if (!parsed?.isValid()) {
    return null;
  }
  return { e164: parsed.number, display: parsed.formatInternational() };
}
