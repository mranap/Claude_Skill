import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** Prints why tests were skipped (missing variables, a stored SMTP password …) after the run. */
export default class SkipReasons implements Reporter {
  private readonly reasons = new Set<string>();

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'skipped') return;
    for (const annotation of [...test.annotations, ...result.annotations]) {
      if (annotation.type === 'skip' && annotation.description) this.reasons.add(annotation.description);
    }
  }

  onEnd(): void {
    for (const reason of this.reasons) process.stdout.write(`  Skipped: ${reason}\n`);
  }
}
