import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderLifecycleDoc } from './lifecycle-doc.js';

describe('docs/job-lifecycle.md', () => {
  it('matches the transition matrix (run `bun run docs:lifecycle` to regenerate)', () => {
    const file = readFileSync(
      path.resolve(import.meta.dirname, '../../../../docs/job-lifecycle.md'),
      'utf8',
    );
    expect(file).toBe(renderLifecycleDoc());
  });
});
