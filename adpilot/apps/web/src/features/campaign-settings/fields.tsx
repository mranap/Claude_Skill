'use client';

import type * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FieldControlProps } from '@/components/shared/form';
import { cn } from '@/lib/utils/cn';
import { moneyDecimals } from '@/lib/utils/money';

export function SettingsSection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card id={id} className={cn('scroll-mt-24', className)}>
      <CardHeader className={actions ? 'flex-row items-start justify-between gap-4' : undefined}>
        <div className="grid gap-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent className="grid gap-5">{children}</CardContent>
    </Card>
  );
}

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  controlProps,
  disabled,
  className,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  controlProps?: FieldControlProps;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger {...controlProps} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} description={o.description} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Text input for optional string fields: an empty input stores `undefined`. */
export function OptionalInput({
  value,
  onChange,
  onBlur,
  controlProps,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  controlProps?: FieldControlProps;
}) {
  return <Input {...props} {...controlProps} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} onBlur={onBlur} />;
}

/** Money amount (decimal string in major units) with the currency as suffix. */
export function AmountInput({
  value,
  onChange,
  currency,
  controlProps,
  placeholder,
  disabled,
  optional = false,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  currency?: string;
  controlProps?: FieldControlProps;
  placeholder?: string;
  disabled?: boolean;
  optional?: boolean;
}) {
  return (
    <MoneyInput
      {...controlProps}
      value={value ?? ''}
      onValueChange={(v) => onChange(v === '' && optional ? undefined : v)}
      currency={currency ?? 'account currency'}
      decimals={moneyDecimals(currency)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(!currency && 'pr-36')}
    />
  );
}

export function CheckboxGroup<T extends string>({
  value,
  onChange,
  options,
  columns = 2,
  disabled,
}: {
  value: readonly T[];
  onChange: (value: T[]) => void;
  options: { value: T; label: React.ReactNode; hint?: React.ReactNode }[];
  columns?: 1 | 2 | 3;
  disabled?: boolean;
}) {
  const set = new Set(value);
  return (
    <div className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
      {options.map((o) => (
        <label key={o.value} className={cn('flex items-start gap-2.5 rounded-md text-sm', disabled && 'opacity-60')}>
          <Checkbox
            className="mt-0.5"
            checked={set.has(o.value)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked === true ? [...value, o.value] : value.filter((v) => v !== o.value))}
          />
          <span className="grid gap-0.5">
            <span>{o.label}</span>
            {o.hint ? <span className="text-xs text-muted-foreground">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}
