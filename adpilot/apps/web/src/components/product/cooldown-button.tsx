'use client';

import { Timer } from 'lucide-react';
import type * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import type { Cooldown } from '@/lib/hooks/use-cooldown';

/**
 * Action button for server-side cooldowns (429 COOLDOWN): while the countdown runs it is disabled and
 * shows the remaining time instead of the label.
 */
export function CooldownButton({
  cooldown,
  children,
  cooldownHint = 'Available again when the countdown ends',
  cooldownPrefix = 'Again in',
  disabled,
  ...props
}: ButtonProps & { cooldown: Cooldown; cooldownHint?: string; cooldownPrefix?: string; children: React.ReactNode }) {
  if (cooldown.active) {
    return (
      <SimpleTooltip content={cooldownHint}>
        <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Button {...props} disabled aria-live="polite" className={props.className}>
            <Timer />
            <span>
              {cooldownPrefix} <span className="tabular-nums">{cooldown.label}</span>
            </span>
          </Button>
        </span>
      </SimpleTooltip>
    );
  }
  return (
    <Button {...props} disabled={disabled}>
      {children}
    </Button>
  );
}
