'use client';

import { Check, Copy } from 'lucide-react';
import type * as React from 'react';
import { toast } from 'sonner';
import { useCopy } from '@/lib/hooks/use-copy';
import { cn } from '@/lib/utils/cn';
import { Button, type ButtonProps } from './button';
import { SimpleTooltip } from './tooltip';

export function CopyButton({
  value,
  label,
  className,
  variant = 'ghost',
  size = 'icon-xs',
  successMessage,
}: {
  value: string;
  /** Visible text; when omitted the button is icon-only with a tooltip. */
  label?: string;
  className?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  successMessage?: string;
}) {
  const { copied, copy } = useCopy();
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copy(value);
    if (!ok) toast.error('Could not copy to the clipboard');
    else if (successMessage) toast.success(successMessage);
  };
  const icon = copied ? <Check className="text-success-fg" /> : <Copy />;
  if (label) {
    return (
      <Button variant={variant} size={size === 'icon-xs' ? 'sm' : size} className={className} onClick={onClick}>
        {icon}
        {copied ? 'Copied' : label}
      </Button>
    );
  }
  return (
    <SimpleTooltip content={copied ? 'Copied' : 'Copy'}>
      <Button
        variant={variant}
        size={size}
        className={cn('text-muted-foreground hover:text-foreground', className)}
        onClick={onClick}
        aria-label="Copy to clipboard"
      >
        {icon}
      </Button>
    </SimpleTooltip>
  );
}
