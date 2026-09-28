'use client';

import { Check } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { THEME_OPTIONS } from '@/components/layout/theme-toggle';
import { cn } from '@/lib/utils/cn';

function Preview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  const panel = (dark: boolean) => (
    <div className={cn('flex h-full gap-1.5 p-2', dark ? 'bg-zinc-950' : 'bg-zinc-50')}>
      <div className={cn('flex w-1/4 flex-col gap-1 rounded-sm p-1', dark ? 'bg-zinc-900' : 'bg-white')}>
        <span className="h-1.5 w-3/4 rounded-full bg-indigo-500" />
        <span className={cn('h-1 w-full rounded-full', dark ? 'bg-zinc-700' : 'bg-zinc-200')} />
        <span className={cn('h-1 w-2/3 rounded-full', dark ? 'bg-zinc-700' : 'bg-zinc-200')} />
      </div>
      <div className={cn('flex flex-1 flex-col gap-1 rounded-sm p-1.5', dark ? 'bg-zinc-900' : 'bg-white')}>
        <span className={cn('h-1.5 w-1/2 rounded-full', dark ? 'bg-zinc-600' : 'bg-zinc-300')} />
        <span className={cn('h-1 w-full rounded-full', dark ? 'bg-zinc-800' : 'bg-zinc-100')} />
        <span className={cn('h-1 w-5/6 rounded-full', dark ? 'bg-zinc-800' : 'bg-zinc-100')} />
        <span className="mt-auto h-2 w-1/3 rounded-sm bg-indigo-500" />
      </div>
    </div>
  );
  if (mode === 'system') {
    return (
      <div className="grid h-full grid-cols-2">
        <div className="overflow-hidden">{panel(false)}</div>
        <div className="overflow-hidden">{panel(true)}</div>
      </div>
    );
  }
  return panel(mode === 'dark');
}

const subscribeNoop = () => () => undefined;

export function AppearanceSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // next-themes only knows the stored theme after mount.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? 'system') : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>
          Choose how AdPilot looks on this device. System follows your operating system
          {mounted && theme === 'system' && resolvedTheme ? ` (currently ${resolvedTheme})` : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Theme" className="grid gap-4 sm:grid-cols-3">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = current === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(value)}
                className={cn(
                  'group overflow-hidden rounded-lg border text-left outline-none transition-[border-color,box-shadow]',
                  'hover:border-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/30',
                  selected && 'border-primary ring-1 ring-primary',
                )}
              >
                <div className="aspect-[16/9] border-b">
                  <Preview mode={value} />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="size-4 text-muted-foreground" />
                    {label}
                  </span>
                  <span
                    className={cn(
                      'flex size-4 items-center justify-center rounded-full border',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                  >
                    {selected ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
