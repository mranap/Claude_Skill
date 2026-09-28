'use client';

import { KeyRound, RotateCcw, Trash, X } from 'lucide-react';
import { useId } from 'react';
import type * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';

/**
 * Write-only secret (SMTP password, bot token, app secret). The API never returns secret values, only
 * `<field>Set`. State: `undefined` keep · string replace · `null` clear on save.
 */
export function SecretField({
  label,
  description,
  isSet,
  value,
  onChange,
  disabled,
  placeholder = 'Enter a new value',
  error,
}: {
  label: string;
  description?: React.ReactNode;
  isSet: boolean;
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Server-side validation message for this secret (e.g. "re-enter the password"). */
  error?: string | null;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const editing = typeof value === 'string';
  const clearing = value === null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={editing ? id : undefined}>{label}</Label>
        {clearing ? (
          <Badge variant="danger" size="sm">
            Will be removed
          </Badge>
        ) : editing ? (
          <Badge variant="info" size="sm">
            {isSet ? 'Will be replaced' : 'Will be set'}
          </Badge>
        ) : isSet ? (
          <Badge variant="success" size="sm">
            Set
          </Badge>
        ) : (
          <Badge variant="muted" size="sm">
            Not set
          </Badge>
        )}
      </div>
      {editing ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <PasswordInput
              id={id}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              autoComplete="new-password"
              autoFocus
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(undefined)} aria-label="Cancel" disabled={disabled}>
            <X />
          </Button>
        </div>
      ) : (
        <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-1.5">
          <span className={isSet && !clearing ? 'flex-1 font-mono text-sm tracking-widest text-muted-foreground' : 'flex-1 text-sm text-muted-foreground'}>
            {clearing ? 'The stored value will be deleted when you save.' : isSet ? '••••••••••••' : 'No value stored'}
          </span>
          {clearing ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => onChange(undefined)} disabled={disabled}>
              <RotateCcw />
              Undo
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="xs" onClick={() => onChange('')} disabled={disabled}>
                <KeyRound />
                {isSet ? 'Replace' : 'Set'}
              </Button>
              {isSet ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => onChange(null)} disabled={disabled} className="text-destructive-fg">
                  <Trash />
                  Clear
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
      {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
