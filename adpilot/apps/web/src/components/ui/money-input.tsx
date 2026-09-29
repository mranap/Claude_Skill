'use client';

import type * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Input } from './input';

/**
 * Normalises user input into a decimal string without ever converting to a float:
 * "1,5" → "1.5", "0012.345" → "12.34" (with 2 decimals), letters are dropped.
 */
export function sanitizeDecimal(raw: string, decimals = 2, maxIntegerDigits = 12): string {
  let value = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const firstDot = value.indexOf('.');
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '');
  }
  const [rawInt = '', fracPart] = value.split('.');
  const intPart = rawInt.replace(/^0+(?=\d)/, '').slice(0, maxIntegerDigits);
  if (fracPart === undefined || decimals === 0) return intPart;
  return `${intPart || '0'}.${fracPart.slice(0, decimals)}`;
}

/** "12.5" + 2 decimals → "1250" (minor units as a string; safe for BigInt conversion). */
export function decimalToMinorUnits(value: string, decimals = 2): string {
  const [intPart = '0', fracPart = ''] = sanitizeDecimal(value, decimals).split('.');
  const minor = `${intPart}${fracPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return minor || '0';
}

/** "1250" minor units + 2 decimals → "12.50". */
export function minorUnitsToDecimal(minor: string | number | bigint, decimals = 2): string {
  const digits = String(minor).replace(/^-/, '');
  const negative = String(minor).startsWith('-');
  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const frac = decimals ? `.${padded.slice(-decimals)}` : '';
  return `${negative ? '-' : ''}${intPart}${frac}`;
}

/** String-based money field with a currency suffix. `value`/`onValueChange` are decimal strings. */
export function MoneyInput({
  value,
  onValueChange,
  currency,
  decimals = 2,
  className,
  onBlur,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (value: string) => void;
  currency?: string;
  decimals?: number;
}) {
  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onValueChange(sanitizeDecimal(e.target.value, decimals))}
        onBlur={(e) => {
          if (value.endsWith('.')) onValueChange(value.slice(0, -1));
          onBlur?.(e);
        }}
        className={cn('tabular-nums', currency && 'pr-14', className)}
        {...props}
      />
      {currency ? (
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-medium text-muted-foreground">
          {currency}
        </span>
      ) : null}
    </div>
  );
}
