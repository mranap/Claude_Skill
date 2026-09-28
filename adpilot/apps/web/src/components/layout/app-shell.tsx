'use client';

import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type * as React from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/features/auth/auth-context';
import { adminUserCommandSource } from '@/features/admin-users/command-source';
import { globalSearchSource } from '@/features/search/command-source';
import { useSystemStatus } from '@/lib/api/system-status';
import { READ_ACCESS } from '@/lib/permissions';
import { CommandMenuProvider, type CommandSource } from './command-menu';
import { Header } from './header';
import { Logo } from './logo';
import { Sidebar, SidebarNav } from './sidebar';

const COLLAPSED_KEY = 'adpilot.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Authenticated layout: sidebar (rail/full/drawer), sticky header, command palette and content area. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { can, canAny, maintenanceMessage } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const status = useSystemStatus();
  const maintenance = status.data?.maintenance.enabled
    ? `Maintenance mode is on${status.data.maintenance.message ? `: ${status.data.maintenance.message}` : '.'}`
    : status.data
      ? null
      : maintenanceMessage;
  const [mobileOpen, setMobileOpen] = useState(false);

  const sources = useMemo<CommandSource[]>(
    () => [
      ...(canAny(READ_ACCESS.adAccounts) ? [globalSearchSource] : []),
      ...(can('admin.users.view') ? [adminUserCommandSource] : []),
    ],
    [can, canAny],
  );

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // storage unavailable (private mode)
      }
      return next;
    });
  };

  return (
    <CommandMenuProvider sources={sources}>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main navigation</SheetDescription>
            <div className="flex h-14 items-center border-b border-sidebar-border px-4">
              <Logo />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <SidebarNav mode="full" onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenMobileNav={() => setMobileOpen(true)} />
          {maintenance ? (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground sm:px-6"
            >
              <TriangleAlert className="size-4 shrink-0 text-warning-fg" />
              <span>{maintenance}</span>
            </div>
          ) : null}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 px-4 pt-6 pb-12 outline-none sm:px-6 lg:px-8 lg:pt-8"
          >
            <div className="mx-auto w-full max-w-[1280px]">{children}</div>
          </main>
        </div>
      </div>
    </CommandMenuProvider>
  );
}
