'use client';

import { History, Play, Settings2, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { NavTabs } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useLocalTableState } from '@/components/shared/data-table';
import { ErrorAlert } from '@/components/shared/error-alert';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { CooldownButton } from '@/components/product/cooldown-button';
import { useCooldown } from '@/lib/hooks/use-cooldown';
import { useRule } from './api';
import { describeAction, describeInterval, describeTimeRange, TARGET_LABELS } from './labels';
import { RuleEditor } from './rule-editor';
import { RuleExecutionsTable, useRuleActions } from './rules-page';
import type { RuleDto } from './types';

export function RuleDetailPage({ id }: { id: string }) {
  const rule = useRule(id);
  if (rule.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }
  if (rule.isError || !rule.data) {
    return (
      <>
        <PageHeader title="Rule" breadcrumbs={[{ label: 'Auto Rules', href: '/rules' }, { label: 'Not available' }]} />
        <ErrorAlert error={rule.error} onRetry={() => void rule.refetch()} />
      </>
    );
  }
  return <RuleDetail rule={rule.data} />;
}

function RuleDetail({ rule }: { rule: RuleDto }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'history' ? 'history' : 'settings';
  const cooldown = useCooldown();
  const actions = useRuleActions({ onCooldown: cooldown.fromError });
  const [deleting, setDeleting] = useState(false);
  const executions = useLocalTableState({ filterKeys: ['result'] });

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Auto Rules', href: '/rules' }, { label: rule.name }]}
        title={rule.name}
        meta={
          <>
            <Badge variant={rule.isActive ? 'success' : 'muted'}>{rule.isActive ? 'Active' : 'Inactive'}</Badge>
            {rule.isDryRun ? <Badge variant="info">Dry run</Badge> : null}
          </>
        }
        description={
          <>
            If {rule.summary} ({describeTimeRange(rule)}) → {describeAction(rule).toLowerCase()} · {TARGET_LABELS[rule.targetLevel].many.toLowerCase()} ·{' '}
            {describeInterval(rule.checkIntervalMinutes)}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 items-center gap-2 rounded-md border bg-field px-3 text-sm">
              <Switch
                checked={rule.isActive}
                disabled={actions.setActive.isPending}
                onCheckedChange={(active) => actions.setActive.mutate({ rule, active })}
                aria-label={rule.isActive ? 'Deactivate rule' : 'Activate rule'}
              />
              {rule.isActive ? 'Active' : 'Inactive'}
            </label>
            <CooldownButton
              cooldown={cooldown}
              variant="outline"
              loading={actions.run.isPending}
              cooldownHint="A rule can be started manually once per minute"
              onClick={() =>
                actions.run.mutate(rule, {
                  onSuccess: () => cooldown.start(60),
                })
              }
            >
              <Play />
              Run now
            </CooldownButton>
            <Button variant="ghost" size="icon" aria-label="Delete rule" onClick={() => setDeleting(true)}>
              <Trash2 />
            </Button>
          </div>
        }
      />

      <Card className="mb-4 grid gap-3 p-4 text-sm sm:grid-cols-3">
        <div className="grid gap-0.5">
          <span className="text-xs text-muted-foreground">Last run</span>
          <span>
            {rule.lastRunAt ? <RelativeTime value={rule.lastRunAt} /> : 'Never'}
            {rule.lastRunStatus ? <span className="text-muted-foreground"> · {rule.lastRunStatus === 'OK' ? 'completed' : rule.lastRunStatus === 'PARTIAL' ? 'some actions failed' : rule.lastRunStatus.toLowerCase()}</span> : null}
          </span>
        </div>
        <div className="grid gap-0.5">
          <span className="text-xs text-muted-foreground">Next scheduled run</span>
          <span>{rule.isActive && rule.nextRunAt ? <RelativeTime value={rule.nextRunAt} /> : 'Not scheduled'}</span>
        </div>
        <div className="grid gap-0.5">
          <span className="text-xs text-muted-foreground">Safeguards</span>
          <span>
            Cooldown {rule.cooldownMinutes} min · max {rule.maxActionsPerDay} per object per day
          </span>
        </div>
      </Card>
      {rule.lastRunError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>The last run failed</AlertTitle>
          <AlertDescription>{rule.lastRunError}</AlertDescription>
        </Alert>
      ) : null}

      <NavTabs
        className="mb-4"
        activeHref={tab === 'history' ? `/rules/${rule.id}?tab=history` : `/rules/${rule.id}`}
        items={[
          { href: `/rules/${rule.id}`, label: 'Settings', icon: <Settings2 /> },
          { href: `/rules/${rule.id}?tab=history`, label: 'Execution history', icon: <History /> },
        ]}
      />
      {tab === 'history' ? <RuleExecutionsTable state={executions} ruleId={rule.id} poll /> : <RuleEditor key={rule.id} rule={rule} />}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete rule?"
        description={`"${rule.name}" stops running immediately. Its execution history is kept.`}
        confirmLabel="Delete rule"
        destructive
        onConfirm={async () => {
          await actions.remove.mutateAsync(rule);
          router.replace('/rules');
        }}
      />
    </>
  );
}
