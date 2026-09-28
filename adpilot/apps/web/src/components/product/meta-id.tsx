import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils/cn';

/** Monospace Meta object id with an optional copy button (`act_123`, campaign/ad set/ad ids). */
export function MetaId({
  value,
  prefix = '',
  copy = true,
  className,
}: {
  value: string | null | undefined;
  prefix?: string;
  copy?: boolean;
  className?: string;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const text = `${prefix}${value}`;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span className="truncate font-mono text-xs text-muted-foreground">{text}</span>
      {copy ? <CopyButton value={text} size="icon-xs" /> : null}
    </span>
  );
}
