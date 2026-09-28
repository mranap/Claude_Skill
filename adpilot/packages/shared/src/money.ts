/**
 * Money helpers without floating point. The Marketing API expresses budgets, bids, spend caps, balances and
 * amount_spent in the account currency's *minor units* ("offset"): 100 for most currencies (1000 = 10.00 USD)
 * and 1 for currencies without a commonly used minor unit (1000 = 1000 JPY).
 * Insights metrics (spend, cost_per_*, action_values) are decimal strings in *major* units.
 */

/** Currencies with offset 1 in the Marketing API currency table. */
export const OFFSET_ONE_CURRENCIES = new Set([
  'CLP',
  'COP',
  'CRC',
  'HUF',
  'ISK',
  'IDR',
  'JPY',
  'KRW',
  'PYG',
  'TWD',
  'VND',
]);

export function currencyOffset(currency: string): 1 | 100 {
  return OFFSET_ONE_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

export function currencyDecimals(currency: string): 0 | 2 {
  return currencyOffset(currency) === 1 ? 0 : 2;
}

const MAJOR_RE = /^(\d{1,15})(?:\.(\d{1,4}))?$/;

/** "12.34" (USD) → 1234n. Throws when the amount has more decimals than the currency allows. */
export function majorToMinor(major: string, currency: string): bigint {
  const m = MAJOR_RE.exec(major.trim());
  if (!m) throw new Error(`Invalid amount "${major}"`);
  const decimals = currencyDecimals(currency);
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > decimals) {
    throw new Error(
      decimals === 0 ? `${currency} amounts cannot have decimals` : `Use at most ${decimals} decimals`,
    );
  }
  return BigInt(m[1]!) * BigInt(10 ** decimals) + BigInt((frac + '00').slice(0, decimals) || '0');
}

/** 1234n (USD) → "12.34"; 1234n (JPY) → "1234". */
export function minorToMajor(
  minor: bigint | string | number | null | undefined,
  currency: string,
): string | null {
  if (minor === null || minor === undefined || minor === '') return null;
  const v = BigInt(minor);
  const decimals = currencyDecimals(currency);
  if (decimals === 0) return v.toString();
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Formats a major-unit decimal string for display (exact: Intl formats decimal strings without float loss). */
export function formatMoney(
  major: string | number | null | undefined,
  currency: string,
  locale = 'en-US',
): string {
  if (major === null || major === undefined || major === '') return '—';
  const decimals = currencyDecimals(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major as unknown as number);
  } catch {
    return `${major} ${currency}`;
  }
}

/**
 * Applies a percentage change to a minor-unit amount with integer arithmetic.
 * pct is a decimal string such as "20" or "-15.5"; the result is rounded half-up to the unit.
 */
export function applyPercent(minor: bigint, pct: string): bigint {
  const m = /^(-?)(\d{1,6})(?:\.(\d{1,4}))?$/.exec(pct.trim());
  if (!m) throw new Error(`Invalid percentage "${pct}"`);
  const scaled = BigInt(m[2]! + (m[3] ?? '').padEnd(4, '0')) * (m[1] === '-' ? -1n : 1n); // pct × 10^4
  const numerator = minor * (1_000_000n + scaled); // (100% × 10^4) = 1_000_000
  const q = numerator / 1_000_000n;
  const r = numerator % 1_000_000n;
  return r * 2n >= 1_000_000n ? q + 1n : r * 2n <= -1_000_000n ? q - 1n : q;
}
