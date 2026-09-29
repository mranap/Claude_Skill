'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useScrollActiveIntoView } from '@/lib/hooks/use-scroll-active-into-view';
import { cn } from '@/lib/utils/cn';
import { SETTINGS_CATEGORIES, managePermission } from './categories';

/** Category navigation: vertical list on large screens, horizontal scroller on small ones. */
export function SettingsNav() {
  const pathname = usePathname();
  const { can } = useAuth();
  const listRef = useRef<HTMLUListElement>(null);
  useScrollActiveIntoView(listRef, pathname);
  return (
    <nav aria-label="Settings categories" className="min-w-0 lg:sticky lg:top-20">
      <ul
        ref={listRef}
        className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-col lg:overflow-visible lg:pb-0"
      >
        {SETTINGS_CATEGORIES.map((category) => {
          const href = `/admin/settings/${category.slug}`;
          const active = pathname === href;
          const Icon = category.icon;
          const locked = !can(managePermission(category.key));
          return (
            <li key={category.slug} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap outline-none transition-colors',
                  'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                  active && 'bg-accent text-foreground',
                  'max-lg:border max-lg:bg-card max-lg:aria-[current=page]:border-primary/40 max-lg:aria-[current=page]:bg-primary/[0.06]',
                )}
              >
                <Icon
                  className={cn('size-4 shrink-0', active ? 'text-primary-fg' : 'text-muted-foreground')}
                />
                <span className="flex-1">{category.title}</span>
                {locked ? <Lock className="size-3 text-muted-foreground/70" aria-label="Read-only" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
