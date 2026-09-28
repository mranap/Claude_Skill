'use client';

import { useQueries } from '@tanstack/react-query';
import {
  ArrowRight,
  Bell,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Shield,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandShortcut,
} from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { useAuth } from '@/features/auth/auth-context';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { ADMIN_NAV, MAIN_NAV, filterNav } from './nav-config';

export interface CommandEntry {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon;
  /** Navigates to this path… */
  href?: string;
  /** …or runs this action. */
  perform?: () => void;
  keywords?: string[];
  hint?: string;
}

/**
 * Pluggable remote result provider (e.g. a future global search API). Results are fetched with
 * TanStack Query, debounced, and rendered as their own group.
 */
export interface CommandSource {
  id: string;
  heading: string;
  minQueryLength?: number;
  search: (query: string, signal: AbortSignal) => Promise<CommandEntry[]>;
}

interface CommandMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

export function useCommandMenu(): CommandMenuContextValue {
  const ctx = useContext(CommandMenuContext);
  if (!ctx) throw new Error('useCommandMenu() must be used inside <CommandMenuProvider>');
  return ctx;
}

export function CommandMenuProvider({
  children,
  sources = [],
}: {
  children: React.ReactNode;
  sources?: CommandSource[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <CommandMenuContext.Provider value={value}>
      {children}
      <CommandMenu open={open} onOpenChange={setOpen} sources={sources} />
    </CommandMenuContext.Provider>
  );
}

function matches(entry: CommandEntry, q: string): number {
  if (!q) return 1;
  const label = entry.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (entry.keywords?.some((k) => k.toLowerCase().includes(q)) || entry.group.toLowerCase().includes(q))
    return 1;
  return 0;
}

function CommandMenu({
  open,
  onOpenChange,
  sources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: CommandSource[];
}) {
  const router = useRouter();
  const { can, signOut } = useAuth();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 200);

  const entries = useMemo<CommandEntry[]>(() => {
    const nav = filterNav(MAIN_NAV, can).map((item) => ({
      id: `nav:${item.href}`,
      label: item.title,
      group: 'Pages',
      icon: item.icon,
      href: item.href,
      keywords: item.keywords,
    }));
    const admin = filterNav(ADMIN_NAV, can).map((item) => ({
      id: `admin:${item.href}`,
      label: item.title,
      group: 'Administration',
      icon: item.icon,
      href: item.href,
      keywords: item.keywords,
    }));
    const settings: CommandEntry[] = [
      {
        id: 'settings:profile',
        label: 'Profile',
        group: 'Settings',
        icon: UserRound,
        href: '/settings/profile',
        keywords: ['name', 'time zone', 'email'],
      },
      {
        id: 'settings:security',
        label: 'Security & 2FA',
        group: 'Settings',
        icon: Shield,
        href: '/settings/security',
        keywords: ['password', 'two-factor', 'sessions'],
      },
      {
        id: 'settings:password',
        label: 'Change password',
        group: 'Settings',
        icon: KeyRound,
        href: '/settings/security',
        keywords: ['security'],
      },
      {
        id: 'settings:notifications',
        label: 'Notification preferences',
        group: 'Settings',
        icon: Bell,
        href: '/settings/notifications',
        keywords: ['telegram', 'email'],
      },
      {
        id: 'settings:appearance',
        label: 'Appearance',
        group: 'Settings',
        icon: Palette,
        href: '/settings/appearance',
        keywords: ['theme', 'dark mode'],
      },
    ];
    const actions: CommandEntry[] = [
      {
        id: 'theme:light',
        label: 'Switch to light theme',
        group: 'Actions',
        icon: Sun,
        perform: () => setTheme('light'),
        keywords: ['appearance'],
      },
      {
        id: 'theme:dark',
        label: 'Switch to dark theme',
        group: 'Actions',
        icon: Moon,
        perform: () => setTheme('dark'),
        keywords: ['appearance'],
      },
      {
        id: 'theme:system',
        label: 'Use system theme',
        group: 'Actions',
        icon: Monitor,
        perform: () => setTheme('system'),
        keywords: ['appearance'],
      },
      {
        id: 'auth:signout',
        label: 'Sign out',
        group: 'Actions',
        icon: LogOut,
        perform: () => void signOut(),
        keywords: ['logout'],
      },
    ];
    return [...nav, ...admin, ...settings, ...actions];
  }, [can, setTheme, signOut]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = entries
      .map((entry) => ({ entry, score: matches(entry, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => (q ? b.score - a.score : 0));
    const byGroup = new Map<string, CommandEntry[]>();
    for (const { entry } of scored) byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry]);
    return [...byGroup.entries()];
  }, [entries, query]);

  const remote = useQueries({
    queries: sources.map((source) => ({
      queryKey: ['command-menu', source.id, debounced],
      queryFn: ({ signal }: { signal: AbortSignal }) => source.search(debounced, signal),
      enabled: open && debounced.length >= (source.minQueryLength ?? 2),
      staleTime: 30_000,
    })),
  });

  const run = useCallback(
    (entry: CommandEntry) => {
      onOpenChange(false);
      setQuery('');
      if (entry.href) router.push(entry.href);
      else entry.perform?.();
    },
    [onOpenChange, router],
  );

  const remoteActive = sources.some(
    (s, i) =>
      debounced.length >= (s.minQueryLength ?? 2) && (remote[i]?.isFetching || remote[i]?.data?.length),
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
      title="Search AdPilot"
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={sources.length ? 'Search pages, campaigns, ad accounts…' : 'Search pages and settings…'}
        trailing={<Kbd>Esc</Kbd>}
      />
      <CommandList className="max-h-[min(24rem,60vh)]">
        {!groups.length && !remoteActive ? <CommandEmpty>No results for “{query}”</CommandEmpty> : null}
        {groups.map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map((entry) => {
              const Icon = entry.icon ?? ArrowRight;
              return (
                <CommandItem key={entry.id} value={entry.id} onSelect={() => run(entry)}>
                  <Icon />
                  <span className="truncate">{entry.label}</span>
                  {entry.href ? (
                    <CommandShortcut className="tracking-normal">{entry.href}</CommandShortcut>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
        {sources.map((source, index) => {
          const result = remote[index];
          if (debounced.length < (source.minQueryLength ?? 2) || !result) return null;
          if (result.isFetching && !result.data)
            return <CommandLoading key={source.id}>Searching {source.heading.toLowerCase()}…</CommandLoading>;
          if (!result.data?.length) return null;
          // A source may return several kinds of results: one group per `entry.group`, in order of appearance.
          const byGroup = new Map<string, CommandEntry[]>();
          for (const entry of result.data)
            byGroup.set(entry.group || source.heading, [
              ...(byGroup.get(entry.group || source.heading) ?? []),
              entry,
            ]);
          return [...byGroup.entries()].map(([group, items]) => (
            <CommandGroup key={`${source.id}:${group}`} heading={group}>
              {items.map((entry) => {
                const Icon = entry.icon ?? ArrowRight;
                return (
                  <CommandItem key={entry.id} value={entry.id} onSelect={() => run(entry)}>
                    <Icon />
                    <span className="truncate">{entry.label}</span>
                    {entry.hint ? (
                      <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                        {entry.hint}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ));
        })}
      </CommandList>
      <div className="flex items-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>/</Kbd> or <Kbd>⌘K</Kbd> to open
        </span>
      </div>
    </CommandDialog>
  );
}
