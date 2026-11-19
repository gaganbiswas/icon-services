import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, expect } from 'vitest';

/** Accessibility gate: every UI test ends with an axe scan (contrast needs a real browser). */
afterEach(async () => {
  if (document.body.childElementCount > 0) {
    const results = await axe.run(document.body, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
      rules: {
        'color-contrast': { enabled: false },
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
      },
    });
    const problems = results.violations.map(
      (v) =>
        `${v.id} (${v.impact ?? 'n/a'}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
    expect(problems, 'accessibility violations').toEqual([]);
  }
  cleanup();
});
