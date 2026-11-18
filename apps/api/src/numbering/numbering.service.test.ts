import { describe, expect, it } from 'vitest';

import { yearIn } from './numbering.service.js';

describe('yearIn', () => {
  it('uses the given time zone at year boundaries', () => {
    const instant = new Date('2026-12-31T20:00:00Z');
    expect(yearIn(instant, 'UTC')).toBe(2026);
    expect(yearIn(instant, 'Asia/Kolkata')).toBe(2027);
    expect(yearIn(instant, 'America/New_York')).toBe(2026);
  });

  it('falls back to UTC for missing or invalid zones', () => {
    const instant = new Date('2026-06-01T00:00:00Z');
    expect(yearIn(instant, null)).toBe(2026);
    expect(yearIn(instant, 'Not/AZone')).toBe(2026);
  });
});
