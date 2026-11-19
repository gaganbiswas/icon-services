import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, expect, vi } from 'vitest';

// jsdom does not implement scrolling; the router calls it on navigation.
vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

/**
 * Accessibility gate (CLAUDE.md §5, WCAG 2.1 AA rules): every UI test ends
 * with an axe scan of what is on screen. Rules needing real layout/paint
 * (colour contrast) cannot run in jsdom and are checked in the browser E2E.
 */
afterEach(async () => {
  if (document.body.childElementCount > 0) {
    const results = await axe.run(document.body, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
      rules: {
        'color-contrast': { enabled: false },
        // Components are tested outside the app shell, so page landmarks are absent here.
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
