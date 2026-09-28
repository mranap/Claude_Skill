'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/features/auth/auth-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { Logo, LogoMark } from './logo';
import { ADMIN_NAV, MAIN_NAV, filterNav, findActiveNavItem, type NavItem } from './nav-config';

type NavMode = 'responsive' | 'full';

/**
 * Class helpers for the responsive rail: below `lg` (and when the user collapsed the sidebar) only icons
 * are shown; the full sidebar appears from `lg` up. `full` mode is used inside the mobile drawer.
 */
const railHidden = 'md:hidden lg:inline lg:group-data-[collapsed=true]/sidebar:hidden';

function NavLink({
  item,
  active,
  mode,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  mode: NavMode;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/link flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors',
        'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
        active && 'bg-sidebar-accent text-sidebar-accent-foreground',
        mode === 'responsive' &&
          'md:justify-center md:px-0 lg:justify-start lg:px-2.5 lg:group-data-[collapsed=true]/sidebar:justify-center lg:group-data-[collapsed=true]/sidebar:px-0',
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-colors group-hover/link:text-foreground',
          active && 'text-primary-fg group-hover/link:text-primary-fg',
        )}
        aria-hidden
      />
      <span className={cn('truncate', mode === 'responsive' && railHidden)}>{item.title}</span>
    </Link>
  );
  if (mode === 'full') return link;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className={cn(!collapsed && 'lg:hidden')}>
        {item.title}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarNav({
  mode,
  collapsed = false,
  onNavigate,
}: {
  mode: NavMode;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { can } = useAuth();
  const main = filterNav(MAIN_NAV, can);
  const admin = filterNav(ADMIN_NAV, can);
  const active = findActiveNavItem(pathname, [...main, ...admin]);

  return (
    <nav className="flex flex-col gap-5" aria-label="Main navigation">
      <ul className="flex flex-col gap-0.5">
        {main.map((item) => (
          <li key={item.href}>
            <NavLink item={item} active={active === item} mode={mode} collapsed={collapsed} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      {admin.length ? (
        <div className="flex flex-col gap-1">
          <p
            className={cn(
              'px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase',
              mode === 'responsive' && railHidden,
            )}
          >
            Administration
          </p>
          {mode === 'responsive' ? (
            <div className="mx-2 mb-1 hidden h-px bg-sidebar-border md:block lg:hidden lg:group-data-[collapsed=true]/sidebar:block" />
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {admin.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={active === item} mode={mode} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

/** Desktop/tablet sidebar: icon rail on `md`, full width on `lg` (collapsible), hidden on mobile. */
export function Sidebar({ collapsed, onToggleCollapsed }: { collapsed: boolean; onToggleCollapsed: () => void }) {
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'group/sidebar sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex',
        'w-[3.75rem] transition-[width] duration-200 ease-out lg:w-60 lg:data-[collapsed=true]:w-[3.75rem]',
      )}
    >
      <div className="flex h-14 shrink-0 items-center px-3.5">
        <Link href="/dashboard" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="AdPilot home">
          <span className={cn('hidden', 'lg:inline lg:group-data-[collapsed=true]/sidebar:hidden')}>
            <Logo />
          </span>
          <span className="inline lg:hidden lg:group-data-[collapsed=true]/sidebar:inline">
            <LogoMark />
          </span>
        </Link>
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-4">
        <SidebarNav mode="responsive" collapsed={collapsed} />
      </div>
      <div className="hidden shrink-0 border-t border-sidebar-border p-2.5 lg:block">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none transition-colors',
            'hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
            'group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          <span className="group-data-[collapsed=true]/sidebar:hidden">Collapse</span>
        </button>
      </div>
    </aside>
  );
}
