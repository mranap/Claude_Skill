'use client';

import { Check, TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type StepState = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepperStep {
  id: string;
  title: string;
  description?: string;
  /** Explicit state; when omitted it is derived from `current`. */
  state?: StepState;
  disabled?: boolean;
}

function stateOf(step: StepperStep, index: number, current: number): StepState {
  if (step.state) return step.state;
  if (index < current) return 'complete';
  if (index === current) return 'current';
  return 'upcoming';
}

const CIRCLE: Record<StepState, string> = {
  complete: 'border-primary bg-primary text-primary-foreground',
  current: 'border-primary bg-card text-primary-fg ring-4 ring-primary/15',
  upcoming: 'border-input bg-card text-muted-foreground',
  error: 'border-destructive bg-destructive text-destructive-foreground ring-4 ring-destructive/15',
};

/**
 * Horizontal progress stepper (built for the multi-step launch wizard). Completed/errored steps can be
 * clicked to navigate back when `onStepClick` is provided. On narrow screens the list scrolls
 * horizontally and a compact "Step x of n" summary is shown.
 */
export function Stepper({
  steps,
  current,
  onStepClick,
  className,
}: {
  steps: StepperStep[];
  current: number;
  onStepClick?: (index: number, step: StepperStep) => void;
  className?: string;
}) {
  const active = steps[current];
  return (
    <div className={cn('w-full min-w-0', className)}>
      <p className="mb-3 text-xs font-medium text-muted-foreground sm:hidden">
        Step {Math.min(current + 1, steps.length)} of {steps.length}
        {active ? <span className="text-foreground"> · {active.title}</span> : null}
      </p>
      <ol
        className="scrollbar-none flex w-full items-start overflow-x-auto px-1 pt-1 pb-1.5"
        aria-label="Progress"
      >
        {steps.map((step, index) => {
          const state = stateOf(step, index, current);
          const clickable = !!onStepClick && !step.disabled && (state === 'complete' || state === 'error');
          const last = index === steps.length - 1;
          const content: React.ReactNode = (
            <>
              <span
                className={cn(
                  'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors',
                  CIRCLE[state],
                )}
              >
                {state === 'complete' ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : state === 'error' ? (
                  <TriangleAlert className="size-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="mt-2 hidden max-w-[9rem] flex-col items-center gap-0.5 text-center sm:flex">
                <span
                  className={cn(
                    'text-xs leading-tight font-medium',
                    state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                    state === 'error' && 'text-destructive-fg',
                  )}
                >
                  {step.title}
                </span>
                {step.description ? (
                  <span className="text-[11px] leading-tight text-muted-foreground">{step.description}</span>
                ) : null}
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              className={cn('relative flex min-w-14 flex-1 flex-col items-center sm:min-w-24')}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-3.5 left-[calc(50%+1.125rem)] h-px w-[calc(100%-2.25rem)]',
                    index < current ? 'bg-primary' : 'bg-border',
                  )}
                />
              ) : null}
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(index, step)}
                  className="flex flex-col items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {content}
                </button>
              ) : (
                <div className="flex flex-col items-center">{content}</div>
              )}
              <span className="sr-only">{`${step.title}: ${state}`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
