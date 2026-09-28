'use client';

import type { MetaErrorDetails } from '@adpilot/shared';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CopyButton } from '@/components/ui/copy-button';
import { ApiError, getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { humanize } from '@/lib/utils/strings';

function MetaTechnicalDetails({ meta }: { meta: MetaErrorDetails }) {
  const [open, setOpen] = useState(false);
  const rows: { label: string; value: string | number | undefined; copy?: boolean; mono?: boolean }[] = [
    { label: 'Error code', value: meta.code, mono: true },
    { label: 'Subcode', value: meta.subcode, mono: true },
    { label: 'Type', value: meta.type, mono: true },
    { label: 'HTTP status', value: meta.httpStatus, mono: true },
    { label: 'Category', value: meta.category ? humanize(meta.category) : undefined },
    { label: 'Retryable', value: meta.retryable ? 'Yes' : 'No' },
    { label: 'fbtrace_id', value: meta.fbtraceId, copy: true, mono: true },
  ];
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1">
      <CollapsibleTrigger className="inline-flex items-center gap-1 rounded text-xs font-medium text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        Technical details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md border bg-card/60 p-3 text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {rows
              .filter((r) => r.value !== undefined && r.value !== null && r.value !== '')
              .map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd
                    className={cn('flex min-w-0 items-center gap-1 text-foreground', r.mono && 'font-mono')}
                  >
                    <span className="break-all">{String(r.value)}</span>
                    {r.copy ? <CopyButton value={String(r.value)} /> : null}
                  </dd>
                </div>
              ))}
          </dl>
          {meta.message ? (
            <div className="mt-2.5 border-t pt-2.5">
              <p className="mb-1 text-muted-foreground">Original message</p>
              <p className="font-mono break-words text-foreground">{meta.message}</p>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Friendly error block. Shows the server's message, the Meta API technical details (code, subcode,
 * type, fbtrace_id, original message) when present, the request id for support, and an optional retry.
 */
export function ErrorAlert({
  error,
  title,
  onRetry,
  className,
  showFieldErrors = true,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
  showFieldErrors?: boolean;
}) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const meta = apiError?.meta;
  const message = getErrorMessage(error);
  const fieldErrors = showFieldErrors ? (apiError?.fieldErrors ?? []) : [];
  const variant = apiError?.is('MAINTENANCE', 'INTEGRATION_NOT_CONFIGURED') ? 'warning' : 'destructive';

  return (
    <Alert variant={variant} className={className}>
      <AlertTitle>{title ?? getErrorTitle(error)}</AlertTitle>
      <AlertDescription className="text-foreground/80">
        <p>
          {meta?.userMessage && meta.userMessage !== message ? `${message} ${meta.userMessage}` : message}
        </p>
        {fieldErrors.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {fieldErrors.map((fe) => (
              <li key={`${fe.path}:${fe.message}`}>
                {fe.path ? <span className="font-medium">{humanize(fe.path)}: </span> : null}
                {fe.message}
              </li>
            ))}
          </ul>
        ) : null}
        {meta ? <MetaTechnicalDetails meta={meta} /> : null}
        {onRetry || apiError?.requestId ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {onRetry ? (
              <Button size="xs" variant="outline" onClick={onRetry}>
                <RotateCcw />
                Try again
              </Button>
            ) : null}
            {apiError?.requestId ? (
              <span className="text-xs text-muted-foreground">
                Reference <code className="font-mono">{apiError.requestId}</code>
              </span>
            ) : null}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
