'use client';

import type * as React from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FormField } from '@/components/shared/form';
import { cn } from '@/lib/utils/cn';

/** Boolean setting rendered as a labelled switch row. */
export function SwitchField<TIn extends FieldValues, TName extends FieldPath<TIn>, TOut = TIn>({
  control,
  name,
  label,
  description,
  className,
  onCheckedChange,
}: {
  control: Control<TIn, unknown, TOut>;
  name: TName;
  label: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  /** Intercept changes (e.g. to confirm enabling maintenance). Return false to cancel. */
  onCheckedChange?: (checked: boolean) => boolean | void;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      orientation="horizontal"
      className={cn('rounded-lg border p-4', className)}
      render={({ field, controlProps }) => (
        <Switch
          id={controlProps.id}
          aria-describedby={controlProps['aria-describedby']}
          checked={!!field.value}
          onCheckedChange={(checked) => {
            if (onCheckedChange?.(checked) === false) return;
            field.onChange(checked);
          }}
          onBlur={field.onBlur}
          ref={field.ref}
        />
      )}
    />
  );
}

/** Enum setting rendered as a select. */
export function SelectField<TIn extends FieldValues, TName extends FieldPath<TIn>, TOut = TIn>({
  control,
  name,
  label,
  description,
  options,
  className,
  numeric = false,
}: {
  control: Control<TIn, unknown, TOut>;
  name: TName;
  label: React.ReactNode;
  description?: React.ReactNode;
  options: { value: string; label: string; description?: string }[];
  className?: string;
  /** Store the selected value as a number. */
  numeric?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      className={className}
      render={({ field, controlProps }) => (
        <Select
          value={field.value === undefined || field.value === null ? '' : String(field.value)}
          onValueChange={(v) => field.onChange(numeric ? Number(v) : v)}
        >
          <SelectTrigger id={controlProps.id} aria-invalid={controlProps['aria-invalid']} ref={field.ref}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value} description={o.description}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}
