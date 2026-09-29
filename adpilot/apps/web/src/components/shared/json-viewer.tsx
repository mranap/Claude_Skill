'use client';

import { useMemo } from 'react';
import type * as React from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils/cn';

/** Monospace block with an optional copy button (JSON, tokens, logs). */
export function CodeBlock({
  code,
  children,
  className,
  maxHeightClass = 'max-h-80',
  copy = true,
  wrap = false,
}: {
  code: string;
  children?: React.ReactNode;
  className?: string;
  maxHeightClass?: string;
  copy?: boolean;
  wrap?: boolean;
}) {
  return (
    <div
      className={cn('group/code relative min-w-0 rounded-md border bg-muted/40 dark:bg-black/25', className)}
    >
      {copy ? (
        <div className="absolute top-1.5 right-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/code:opacity-100 sm:focus-within:opacity-100">
          <CopyButton value={code} className="bg-card/80 backdrop-blur" />
        </div>
      ) : null}
      <pre
        className={cn(
          'overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed text-foreground',
          wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
          maxHeightClass,
        )}
      >
        <code>{children ?? code}</code>
      </pre>
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return (
      JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2) ?? 'null'
    );
  } catch {
    return String(value);
  }
}

const TOKEN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlight(json: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of json.matchAll(TOKEN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(json.slice(last, start));
    let cls = 'text-warning-fg';
    if (token.startsWith('"')) cls = match[2] ? 'text-info-fg' : 'text-success-fg';
    else if (token === 'true' || token === 'false') cls = 'text-primary-fg';
    else if (token === 'null') cls = 'text-muted-foreground';
    out.push(
      <span key={index++} className={cls}>
        {token}
      </span>,
    );
    last = start + token.length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

/** Pretty-printed, syntax-highlighted JSON (audit metadata, log context, Meta usage headers). */
export function JsonViewer({
  value,
  className,
  maxHeightClass,
}: {
  value: unknown;
  className?: string;
  maxHeightClass?: string;
}) {
  const json = useMemo(() => stringify(value), [value]);
  const nodes = useMemo(() => highlight(json), [json]);
  return (
    <CodeBlock code={json} className={className} maxHeightClass={maxHeightClass}>
      {nodes}
    </CodeBlock>
  );
}
