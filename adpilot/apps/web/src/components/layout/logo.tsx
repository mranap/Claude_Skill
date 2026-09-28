import { cn } from '@/lib/utils/cn';

/** Product mark: a stylised paper plane on the primary colour. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[18px]">
        <path d="M3.5 11.2 20 4l-4.6 16.2-4.3-6.1L3.5 11.2Z" fill="currentColor" fillOpacity="0.95" />
        <path d="m11.1 14.1 3.2-3.4" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Logo({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {!collapsed ? (
        <span className="text-[15px] font-semibold tracking-tight text-foreground">AdPilot</span>
      ) : null}
    </span>
  );
}
