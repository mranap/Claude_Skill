import type * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { fieldClasses } from './input';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClasses, 'flex min-h-20 resize-y px-3 py-2 leading-relaxed', className)}
      {...props}
    />
  );
}
