'use client';

import { useId } from 'react';
import type * as React from 'react';
import {
  Controller,
  FormProvider,
  useFormState,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError, getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';

/**
 * `<form>` + react-hook-form provider. `onSubmit` receives the zod-parsed output values. Errors thrown by
 * `onSubmit` are mapped with `applyServerErrors` (field errors → fields, everything else → root).
 */
export function Form<TIn extends FieldValues, TOut>({
  form,
  onSubmit,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'form'>, 'onSubmit'> & {
  form: UseFormReturn<TIn, unknown, TOut>;
  onSubmit: (values: TOut) => unknown | Promise<unknown>;
}) {
  return (
    <FormProvider {...form}>
      <form
        noValidate
        className={className}
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await onSubmit(values);
          } catch (error) {
            applyServerErrors(form, error);
          }
        })}
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}

/**
 * Maps an API error onto the form: VALIDATION_ERROR `details[{ path, message }]` become field errors for
 * fields that exist in the form; anything else is stored as the `root.server` error (shown by
 * `<FormRootError />`). Returns true when at least one field error was mapped.
 */
export function applyServerErrors<TIn extends FieldValues, TOut>(
  form: UseFormReturn<TIn, unknown, TOut>,
  error: unknown,
  pathMap: Record<string, string> | ((path: string) => string) = {},
): boolean {
  let mapped = 0;
  if (error instanceof ApiError && error.fieldErrors.length) {
    const values = form.getValues() as Record<string, unknown>;
    for (const fe of error.fieldErrors) {
      const path = typeof pathMap === 'function' ? pathMap(fe.path) : (pathMap[fe.path] ?? fe.path);
      const top = path.split('.')[0];
      if (!path || !top || !(top in values)) continue;
      form.setError(path as Path<TIn>, { type: 'server', message: fe.message }, { shouldFocus: mapped === 0 });
      mapped++;
    }
  }
  if (!mapped) {
    form.setError('root.server' as Path<TIn>, {
      type: error instanceof ApiError ? error.code : 'unknown',
      message: `${getErrorTitle(error)}|${getErrorMessage(error)}`,
    });
  }
  return mapped > 0;
}

/** Displays the non-field server error of the surrounding `<Form>`. */
export function FormRootError({ className }: { className?: string }) {
  const { errors } = useFormState();
  const raw = (errors.root as { server?: { message?: string } } | undefined)?.server?.message;
  if (!raw) return null;
  const [title, ...rest] = raw.split('|');
  return (
    <Alert variant="destructive" className={className}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-foreground/80">{rest.join('|')}</AlertDescription>
    </Alert>
  );
}

export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
}

export interface FormFieldRenderProps<TIn extends FieldValues, TName extends FieldPath<TIn>> {
  field: ControllerRenderProps<TIn, TName>;
  fieldState: ControllerFieldState;
  /** Spread onto the control element for label/description/error wiring. */
  controlProps: FieldControlProps;
}

/** Label + control + description + error message, bound to react-hook-form through `control`. */
export function FormField<TIn extends FieldValues, TName extends FieldPath<TIn>, TOut = TIn>({
  control,
  name,
  label,
  description,
  labelAction,
  required,
  className,
  render,
  orientation = 'vertical',
}: {
  control: Control<TIn, unknown, TOut>;
  name: TName;
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned content on the label row (e.g. "Forgot password?"). */
  labelAction?: React.ReactNode;
  required?: boolean;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
  render: (props: FormFieldRenderProps<TIn, TName>) => React.ReactNode;
}) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const descriptionId = description ? `${id}-description` : undefined;
        const errorId = fieldState.error ? `${id}-error` : undefined;
        const controlProps: FieldControlProps = {
          id,
          'aria-invalid': !!fieldState.error,
          'aria-describedby': [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
        };
        const labelNode = label ? (
          <Label htmlFor={id} className={cn(orientation === 'horizontal' && 'leading-5')}>
            {label}
            {required ? <span className="text-destructive-fg" aria-hidden>*</span> : null}
          </Label>
        ) : null;
        const messages = (
          <>
            {description ? (
              <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
            {fieldState.error?.message ? (
              <p id={errorId} role="alert" className="text-xs font-medium text-destructive-fg">
                {fieldState.error.message}
              </p>
            ) : null}
          </>
        );
        if (orientation === 'horizontal') {
          return (
            <div className={cn('flex items-start justify-between gap-6', className)} data-invalid={!!fieldState.error || undefined}>
              <div className="grid min-w-0 gap-1">
                {labelNode}
                {messages}
              </div>
              <div className="shrink-0 pt-0.5">{render({ field, fieldState, controlProps })}</div>
            </div>
          );
        }
        return (
          <div className={cn('grid content-start gap-2', className)} data-invalid={!!fieldState.error || undefined}>
            {labelNode || labelAction ? (
              <div className="flex min-h-4 items-center justify-between gap-2">
                {labelNode}
                {labelAction}
              </div>
            ) : null}
            {render({ field, fieldState, controlProps })}
            {messages}
          </div>
        );
      }}
    />
  );
}

/** Text input field shortcut. */
export function TextField<TIn extends FieldValues, TName extends FieldPath<TIn>, TOut = TIn>({
  control,
  name,
  label,
  description,
  required,
  className,
  labelAction,
  ...inputProps
}: {
  control: Control<TIn, unknown, TOut>;
  name: TName;
  label?: React.ReactNode;
  description?: React.ReactNode;
  required?: boolean;
  className?: string;
  labelAction?: React.ReactNode;
} & Omit<React.ComponentProps<'input'>, 'name' | 'value' | 'onChange' | 'onBlur' | 'className'>) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      labelAction={labelAction}
      render={({ field, controlProps }) => (
        <Input
          {...inputProps}
          {...controlProps}
          name={field.name}
          ref={field.ref}
          value={(field.value as string | number | undefined | null) ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          disabled={inputProps.disabled ?? field.disabled}
        />
      )}
    />
  );
}

/** Integer input bound to a numeric form value (empty input → undefined so zod reports "required"). */
export function NumberField<TIn extends FieldValues, TName extends FieldPath<TIn>, TOut = TIn>({
  control,
  name,
  label,
  description,
  unit,
  className,
  min,
  max,
  step = 1,
  disabled,
}: {
  control: Control<TIn, unknown, TOut>;
  name: TName;
  label?: React.ReactNode;
  description?: React.ReactNode;
  unit?: string;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      className={className}
      render={({ field, controlProps }) => (
        <div className="relative">
          <Input
            {...controlProps}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            name={field.name}
            ref={field.ref}
            value={typeof field.value === 'number' && Number.isFinite(field.value) ? field.value : ''}
            onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)}
            onBlur={field.onBlur}
            className={cn(unit && 'pr-16')}
          />
          {unit ? (
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </div>
      )}
    />
  );
}
