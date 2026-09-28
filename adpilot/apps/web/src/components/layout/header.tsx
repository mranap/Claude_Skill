'use client';

import { Menu, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Breadcrumbs, type Crumb } from '@/components/shared/page-header';
import { useAuth } from '@/features/auth/auth-context';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { useCommandMenu } from './command-menu';
import { ADMIN_NAV, MAIN_NAV, filterNav, findActiveNavItem } from './nav-config';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

function useHeaderCrumbs(): Crumb[] {
  const pathname = usePathname();
  const { can } = useAuth();
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  const items = admin ? filterNav(ADMIN_NAV, can) : MAIN_NAV;
  const active = findActiveNavItem(pathname, items);
  const crumbs: Crumb[] = [];
  if (admin) crumbs.push({ label: 'Administration', href: can('admin.dashboard.view') ? '/admin' : undefined });
  if (active) crumbs.push({ label: active.title, href: active.href });
  return crumbs;
}

export function Header({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const crumbs = useHeaderCrumbs();
  const { setOpen } = useCommandMenu();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-5 lg:px-6">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu />
      </Button>
      <Breadcrumbs items={crumbs} className="min-w-0 flex-1 text-[13px] [&_li:last-child]:font-medium" />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="hidden w-56 justify-start gap-2 px-2.5 font-normal text-muted-foreground lg:flex"
          aria-label="Open search"
        >
          <Search />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          className="text-muted-foreground hover:text-foreground lg:hidden"
          aria-label="Open search"
        >
          <Search />
        </Button>
        <NotificationBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
