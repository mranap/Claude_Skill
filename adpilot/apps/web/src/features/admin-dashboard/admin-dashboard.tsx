'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Ban, Gauge, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ADMIN_NAV, filterNav } from '@/components/layout/nav-config';
import { useAuth } from '@/features/auth/auth-context';
import { adminUsersApi } from '@/features/admin-users/api';
import { formatNumber } from '@/lib/utils/format';

function useUserCount(params: Record<string, string | number>, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'users', 'count', params],
    queryFn: () => adminUsersApi.list({ ...params, pageSize: 1 }),
    enabled,
    select: (res) => res.total,
    staleTime: 60_000,
  });
}

export function AdminDashboard() {
  const { can } = useAuth();
  const canUsers = can('admin.users.view');
  const active = useUserCount({ status: 'ACTIVE' }, canUsers);
  const blocked = useUserCount({ status: 'BLOCKED' }, canUsers);
  const links = filterNav(ADMIN_NAV, can).filter((item) => item.href !== '/admin');

  return (
    <>
      <PageHeader
        title="Admin dashboard"
        description="Platform health and shortcuts. Detailed system metrics will appear here once the monitoring endpoints are connected."
        meta={<Badge variant="muted" size="sm">Preview</Badge>}
      />
      {canUsers ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Active users" value={formatNumber(active.data ?? 0)} icon={Users} loading={active.isPending} />
          <StatCard label="Blocked users" value={formatNumber(blocked.data ?? 0)} icon={Ban} loading={blocked.isPending} />
          <StatCard label="System health" value="—" icon={Gauge} hint="Queue and worker metrics coming soon" />
        </div>
      ) : null}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Administration</CardTitle>
          <CardDescription>Everything you have access to.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {can('admin.users.create') ? (
            <Link
              href="/admin/users"
              className="group flex items-center gap-3 rounded-lg border border-dashed p-3.5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary-fg">
                <UserPlus className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium">Invite a user</span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : null}
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 rounded-lg border p-3.5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <item.icon className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium">{item.title}</span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
