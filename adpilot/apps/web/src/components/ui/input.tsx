import type * as React from 'react';
import { cn } from '@/lib/utils/cn';

export const fieldClasses = cn(
  'w-full min-w-0 rounded-md border border-input bg-field text-sm text-foreground outline-none',
  'transition-[color,box-shadow,border-color] placeholder:text-muted-foreground/75',
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20',
  'disabled:cursor-not-allowed disabled:opacity-55 read-only:bg-muted/40',
  'aria-invalid:border-destructive/70 aria-invalid:focus-visible:ring-destructive/20',
);

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        'flex h-9 px-3 py-1',
        'file:mr-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        type === 'number' && 'tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

/** Input with leading/trailing adornments (icons, units, buttons) rendered inside the field. */
export function InputGroup({
  className,
  leading,
  trailing,
  children,
}: {
  className?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <div className={cn('relative flex w-full items-center', className)}>
      {leading ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground [&_svg]:size-4">
          {leading}
        </div>
      ) : null}
      <div className={cn('w-full', leading && '[&_input]:pl-9', trailing && '[&_input]:pr-10')}>{children}</div>
      {trailing ? <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">{trailing}</div> : null}
    </div>
  );
}
