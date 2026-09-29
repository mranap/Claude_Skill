import { test as base, expect } from '@playwright/test';
import { watchErrors } from './app';

/**
 * Playwright's `test` with one automatic check: an uncaught exception in the page fails the test. Console
 * errors are not counted, since some specs provoke failed requests on purpose.
 */
export const test = base.extend<{ noPageErrors: void }>({
  noPageErrors: [
    async ({ page }, provide) => {
      const errors = watchErrors(page);
      await provide();
      expect(errors, 'uncaught exceptions in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
