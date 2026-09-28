'use client';

import { PASSWORD_MIN_LENGTH } from '@adpilot/shared';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Input } from './input';

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Mirrors the server policy: ≥ 10 characters, letters and at least one digit, no edge spaces. */
  meetsPolicy: boolean;
  hint: string;
}

export function evaluatePassword(value: string): PasswordStrength {
  const hasLetter = /[A-Za-z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasUpperLower = /[a-z]/.test(value) && /[A-Z]/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  const trimmedOk = value.trim() === value;
  const meetsPolicy = value.length >= PASSWORD_MIN_LENGTH && hasLetter && hasDigit && trimmedOk;

  let hint = '';
  if (!value) hint = `Use at least ${PASSWORD_MIN_LENGTH} characters with letters and a digit.`;
  else if (value.length < PASSWORD_MIN_LENGTH)
    hint = `${PASSWORD_MIN_LENGTH - value.length} more character${PASSWORD_MIN_LENGTH - value.length === 1 ? '' : 's'} needed.`;
  else if (!hasLetter || !hasDigit) hint = 'Use letters and at least one digit.';
  else if (!trimmedOk) hint = 'Remove spaces at the start or end.';

  if (!value) return { score: 0, label: '', meetsPolicy, hint };
  if (!meetsPolicy) return { score: 1, label: 'Too weak', meetsPolicy, hint };
  let points = 2;
  if (value.length >= 14) points++;
  if (hasUpperLower || hasSymbol) points++;
  if (value.length >= 18 && hasSymbol) points++;
  const score = Math.min(4, points) as 2 | 3 | 4;
  const label = score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';
  return {
    score,
    label,
    meetsPolicy,
    hint: score < 4 ? 'Longer passphrases with mixed characters are stronger.' : '',
  };
}

const BAR_TONES = ['bg-muted', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

export function PasswordStrengthMeter({ value, className }: { value: string; className?: string }) {
  const strength = evaluatePassword(value);
  return (
    <div className={cn('space-y-1.5', className)} aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full bg-muted transition-colors dark:bg-white/[0.08]',
              strength.score >= i && BAR_TONES[strength.score],
            )}
          />
        ))}
      </div>
      <p className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{strength.hint}</span>
        {strength.label ? (
          <span className="shrink-0 font-medium text-foreground/80">{strength.label}</span>
        ) : null}
      </p>
    </div>
  );
}

export function PasswordInput({
  className,
  showStrength = false,
  value,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { showStrength?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {showStrength ? <PasswordStrengthMeter value={typeof value === 'string' ? value : ''} /> : null}
    </div>
  );
}

/** Generates a random password that satisfies the server policy (for "temporary password" flows). */
export function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  if (!/\d/.test(out)) out = `${out.slice(0, -1)}7`;
  if (!/[A-Za-z]/.test(out)) out = `k${out.slice(1)}`;
  return out;
}
