import { describe, expect, it } from 'vitest';
import { applyPercent, currencyOffset, majorToMinor, minorToMajor } from '@adpilot/shared';

describe('money (minor units, no floating point)', () => {
  it('converts major → minor for offset-100 currencies', () => {
    expect(majorToMinor('25', 'USD')).toBe(2500n);
    expect(majorToMinor('25.5', 'EUR')).toBe(2550n);
    expect(majorToMinor('0.01', 'PLN')).toBe(1n);
    expect(majorToMinor('1234567.89', 'USD')).toBe(123456789n);
  });

  it('uses offset 1 for currencies without minor units', () => {
    expect(currencyOffset('JPY')).toBe(1);
    expect(currencyOffset('HUF')).toBe(1);
    expect(majorToMinor('1500', 'JPY')).toBe(1500n);
    expect(() => majorToMinor('1500.5', 'HUF')).toThrow(/cannot have decimals/);
  });

  it('rejects more decimals than the currency supports', () => {
    expect(() => majorToMinor('1.234', 'USD')).toThrow();
    expect(majorToMinor('1.230', 'USD')).toBe(123n);
  });

  it('formats minor → major exactly', () => {
    expect(minorToMajor(2550n, 'USD')).toBe('25.50');
    expect(minorToMajor('5', 'USD')).toBe('0.05');
    expect(minorToMajor(1500n, 'JPY')).toBe('1500');
    expect(minorToMajor(null, 'USD')).toBeNull();
  });

  it('avoids float drift (0.1 + 0.2)', () => {
    expect(majorToMinor('0.1', 'USD') + majorToMinor('0.2', 'USD')).toBe(majorToMinor('0.3', 'USD'));
  });

  it('applies percentages with half-up rounding', () => {
    expect(applyPercent(10000n, '20')).toBe(12000n);
    expect(applyPercent(10000n, '-15')).toBe(8500n);
    expect(applyPercent(333n, '10')).toBe(366n); // 366.3 → 366
    expect(applyPercent(335n, '10')).toBe(369n); // 368.5 → 369
    expect(applyPercent(1000n, '12.5')).toBe(1125n);
  });
});
