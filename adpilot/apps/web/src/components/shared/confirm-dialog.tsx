'use client';

import { TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import type * as React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils/cn';
import { ErrorAlert } from './error-alert';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra content between the description and the buttons (explanations, a reason field…). */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** "Type to confirm": the confirm button stays disabled until this exact text is typed. */
  confirmText?: string;
  /**
   * Called on confirm. When it returns a promise the dialog shows a spinner, stays open on failure (the
   * error is displayed) and closes on success.
   */
  onConfirm: () => unknown | Promise<unknown>;
  /** Disables the confirm button (e.g. while a required reason is empty). */
  confirmDisabled?: boolean;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  // Mount the stateful body only while open so the typed text and errors reset every time.
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <ConfirmDialogBody {...props} /> : null}
    </AlertDialog>
  );
}

function ConfirmDialogBody({
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  confirmText,
  onConfirm,
  confirmDisabled,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inputId = useId();
  const matches = !confirmText || typed.trim() === confirmText;

  const handleConfirm = async () => {
    setError(null);
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setPending(true);
        await result;
      }
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialogContent
      onEscapeKeyDown={(e) => pending && e.preventDefault()}
      {...(description ? {} : { 'aria-describedby': undefined })}
    >
      <div className="flex flex-col gap-4 px-6 pt-6 pb-2">
        <div className="flex gap-3.5">
          {destructive ? (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive-fg">
              <TriangleAlert className="size-4" />
            </div>
          ) : null}
          <div className="min-w-0 space-y-1.5">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description ? (
              <AlertDialogDescription asChild>
                <div>{description}</div>
              </AlertDialogDescription>
            ) : null}
          </div>
        </div>
        {children ? <div className={cn(destructive && 'sm:pl-[3.125rem]')}>{children}</div> : null}
        {confirmText ? (
          <div className={cn('grid gap-2', destructive && 'sm:pl-[3.125rem]')}>
            <Label htmlFor={inputId} className="font-normal text-muted-foreground">
              Type <span className="font-mono font-medium text-foreground">{confirmText}</span> to confirm
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={typed.length > 0 && !matches}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches && !confirmDisabled && !pending) void handleConfirm();
              }}
            />
          </div>
        ) : null}
        {error ? <ErrorAlert error={error} /> : null}
      </div>
      <div className="mt-2 flex flex-col-reverse gap-2 border-t bg-muted/30 px-6 py-3.5 sm:flex-row sm:justify-end rounded-b-xl">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          onClick={() => void handleConfirm()}
          loading={pending}
          disabled={!matches || confirmDisabled}
        >
          {confirmLabel}
        </Button>
      </div>
    </AlertDialogContent>
  );
}
