'use client';

import { useMutation } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleMinus, Stethoscope, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/shared/error-alert';
import { cn } from '@/lib/utils/cn';
import { adminOpsApi, useHealth, type HealthCheck } from './api';

const STATUS: Record<
  HealthCheck['status'],
  { label: string; icon: typeof CircleCheck; tone: string; badge: 'success' | 'warning' | 'danger' | 'muted' }
> = {
  ok: { label: 'OK', icon: CircleCheck, tone: 'text-success-fg', badge: 'success' },
  warning: { label: 'Warning', icon: TriangleAlert, tone: 'text-warning-fg', badge: 'warning' },
  error: { label: 'Down', icon: CircleAlert, tone: 'text-destructive-fg', badge: 'danger' },
  disabled: { label: 'Off', icon: CircleMinus, tone: 'text-muted-foreground', badge: 'muted' },
};

/** Status of every dependency (database, Redis, storage, Meta, workers, scheduler, SMTP, Telegram). */
export function HealthChecksCard({ className }: { className?: string }) {
  const health = useHealth();
  // The deep check also verifies the SMTP login, which takes a few seconds: run it on demand only.
  const deep = useMutation({ mutationFn: () => adminOpsApi.health(true) });
  const checks = deep.data ?? health.data;
  const problems = (checks ?? []).filter((c) => c.status === 'error' || c.status === 'warning').length;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          System health
          {checks ? (
            problems ? (
              <Badge variant="danger" size="sm">
                {problems} {problems === 1 ? 'problem' : 'problems'}
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                All systems operational
              </Badge>
            )
          ) : null}
        </CardTitle>
        <CardDescription>
          Refreshed every 30 seconds.{deep.data ? ' Showing the deep check (SMTP login verified).' : ''}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => deep.mutate()} loading={deep.isPending}>
            <Stethoscope />
            Deep check
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {health.error && !checks ? (
          <ErrorAlert error={health.error} onRetry={() => void health.refetch()} />
        ) : null}
        {deep.error ? <ErrorAlert error={deep.error} className="mb-3" /> : null}
        {!checks && !health.error ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : null}
        {checks ? (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Health checks">
            {checks.map((check) => {
              const s = STATUS[check.status] ?? STATUS.warning;
              return (
                <li
                  key={check.name}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3',
                    check.status === 'error' && 'border-destructive/40 bg-destructive/[0.04]',
                  )}
                >
                  <s.icon className={cn('mt-0.5 size-4 shrink-0', s.tone)} aria-hidden />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{check.name}</span>
                      <Badge variant={s.badge} size="sm">
                        {s.label}
                      </Badge>
                    </div>
                    <span className="text-xs break-words text-muted-foreground">
                      {check.detail}
                      {check.latencyMs !== undefined ? ` · ${check.latencyMs} ms` : ''}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
