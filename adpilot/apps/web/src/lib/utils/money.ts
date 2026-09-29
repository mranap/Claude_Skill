import { currencyDecimals, formatMoney, majorToMinor, minorToMajor } from '@adpilot/shared';

/**
 * Money is handled as decimal strings end to end (the API sends major-unit strings or minor-unit BigInt
 * strings). Nothing here converts an amount to a float except chart geometry, which never leaves the UI.
 */

/** "1234.5" + "USD" → "$1,234.50"; without a currency the plain decimal string is returned. */
export function formatAmount(
  value: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (!currency) return String(value);
  return formatMoney(String(value), currency);
}

/** Minor units (BigInt string) → formatted money, e.g. "2550" USD → "$25.50". */
export function formatMinor(
  minor: string | number | bigint | null | undefined,
  currency: string | null | undefined,
): string {
  if (minor === null || minor === undefined || minor === '' || !currency) return '—';
  return formatAmount(minorToMajor(minor, currency), currency);
}

/** Minor units → major decimal string ("2550" USD → "25.50"). */
export function minorToDecimal(
  minor: string | number | bigint | null | undefined,
  currency: string,
): string | null {
  if (minor === null || minor === undefined || minor === '') return null;
  try {
    return minorToMajor(minor, currency);
  } catch {
    return null;
  }
}

/** Major decimal string → minor units, or null when the amount is invalid for the currency. */
export function decimalToMinor(value: string, currency: string): bigint | null {
  try {
    return majorToMinor(value, currency);
  } catch {
    return null;
  }
}

/** Number of decimals the MoneyInput should accept for a currency (JPY → 0, USD → 2). */
export function moneyDecimals(currency: string | null | undefined): number {
  return currency ? currencyDecimals(currency) : 2;
}

/** Compact axis label: 12500 → "12.5K" (display only). */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Compact money label for chart axes: "$12.5K". */
export function compactMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${compactNumber(value)} ${currency}`;
  }
}
