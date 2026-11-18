import { describe, expect, it } from 'vitest';

import { MAX_ATTEMPTS, backoffSeconds } from './notification-dispatcher.service.js';

describe('backoffSeconds', () => {
  it('grows exponentially and is bounded by the attempt limit', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([30, 60, 120, 240]);
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
