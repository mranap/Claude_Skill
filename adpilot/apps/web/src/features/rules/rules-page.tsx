'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ellipsis, History, ListChecks, Pencil, Play, Plus, Trash2, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { NavTabs } from '@/components/ui/tabs';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  DataTable,
  DataTableToolbar,
  FilterSelect,
  useUrlTableState,
  type DataTableColumn,
  type TableController,
} from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { getErrorMessage, getErrorTitle, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/utils/format';
import { rulesApi, useRuleExecutions, useRules } from './api';
import { ACTION_LABELS, describeAction, describeInterval, describeTimeRange, RESULT_LABELS, TARGET_LABELS } from './labels';
import type { RuleDto, RuleExecutionDto, RuleExecutionResult } from './types';

/** Activate/deactivate, run now and delete, shared by the list and the detail page. */
export function useRuleActions(options: { onCooldown?: (error: unknown) => boolean } = {}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.rules.all });
  const setActive = useMutation({
    mutationFn: ({ rule, active }: { rule: RuleDto; active: boolean }) => (active ? rulesApi.activate(rule.id) : rulesApi.deactivate(rule.id)),
    onSuccess: (rule) => {
      toast.success(rule.isActive ? 'Rule activated' : 'Rule deactivated', { description: rule.name });
      void invalidate();
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });
  const run = useMutation({
    mutationFn: (rule: RuleDto) => rulesApi.run(rule.id),
    onSuccess: (_res, rule) => {
      toast.success('Rule started', {
        description: `"${rule.name}" is being evaluated now${rule.isDryRun ? ' (dry run: nothing is changed in Meta)' : ''}. Results appear in the execution history.`,
      });
      // The run takes a few seconds; refresh the history a little later as well.
      setTimeout(() => void invalidate(), 4000);
    },
    onError: (error) => {
      if (options.onCooldown?.(error)) return;
      if (isApiError(error, 'COOLDOWN', 'RATE_LIMITED')) toast.info('Please wait a moment', { description: getErrorMessage(error) });
      else toast.error(getErrorTitle(error), { description: getErrorMessage(error) });
    },
  });
  const remove = useMutation({
    mutationFn: (rule: RuleDto) => rulesApi.remove(rule.id),
    onSuccess: (_res, rule) => {
      toast.success('Rule deleted', { description: rule.name });
      void invalidate();
    },
  });
  return { setActive, run, remove };
}

export function RulesPage() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'history' ? 'history' : 'rules';
  return (
    <>
      <PageHeader
        title="Auto Rules"
        description="Rules check your campaigns, ad sets or ads on a schedule and pause, start or re-budget them when their conditions are met. Safeguards limit how often and how much a rule can change."
        actions={
          <Button asChild>
            <Link href="/rules/new">
              <Plus />
              New rule
            </Link>
          </Button>
        }
      />
      <NavTabs
        className="mb-4"
        activeHref={tab === 'history' ? '/rules?tab=history' : '/rules'}
        items={[
          { href: '/rules', label: 'Rules', icon: <ListChecks /> },
          { href: '/rules?tab=history', label: 'Execution history', icon: <History /> },
        ]}
      />
      {tab === 'history' ? <HistoryTab /> : <RulesTable />}
    </>
  );
}

function RulesTable() {
  const router = useRouter();
  const state = useUrlTableState({ filterKeys: ['active'] });
  const rules = useRules(state.params);
  const actions = useRuleActions();
  const [deleting, setDeleting] = useState<RuleDto | null>(null);

  const columns: DataTableColumn<RuleDto>[] = [
    {
      id: 'name',
      header: 'Rule',
      interactive: true,
      cell: (r) => (
        <div className="grid min-w-0 max-w-[26rem] gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Link href={`/rules/${r.id}`} className="truncate font-medium hover:underline">
              {r.name}
            </Link>
            {r.isDryRun ? (
              <Badge variant="info" size="sm">
                Dry run
              </Badge>
            ) : null}
          </span>
          <span className="line-clamp-2 text-xs whitespace-normal text-muted-foreground">
            If {r.summary} ({describeTimeRange(r)})
          </span>
        </div>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (r) => (
        <div className="grid gap-0.5">
          <span>{describeAction(r)}</span>
          <span className="text-xs text-muted-foreground">
            {TARGET_LABELS[r.targetLevel].many} · {describeInterval(r.checkIntervalMinutes)}
          </span>
        </div>
      ),
    },
    {
      id: 'active',
      header: 'Active',
      interactive: true,
      cell: (r) => (
        <Switch
          checked={r.isActive}
          disabled={actions.setActive.isPending && actions.setActive.variables?.rule.id === r.id}
          onCheckedChange={(active) => actions.setActive.mutate({ rule: r, active })}
          aria-label={`${r.isActive ? 'Deactivate' : 'Activate'} ${r.name}`}
        />
      ),
    },
    {
      id: 'lastRun',
      header: 'Last run',
      cell: (r) => (
        <div className="grid gap-0.5">
          {r.lastRunAt ? <RelativeTime value={r.lastRunAt} /> : <span className="text-muted-foreground">Never</span>}
          {r.lastRunError ? (
            <SimpleTooltip content={r.lastRunError}>
              <span className="w-fit text-xs text-destructive-fg">Failed</span>
            </SimpleTooltip>
          ) : r.lastRunStatus === 'PARTIAL' ? (
            <span className="text-xs text-warning-fg">Some actions failed</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'nextRun',
      header: 'Next run',
      cell: (r) => (r.isActive && r.nextRunAt ? <RelativeTime value={r.nextRunAt} /> : <span className="text-muted-foreground">—</span>),
    },
    {
      id: 'stats',
      header: 'Last 7 days',
      cell: (r) => <Stats7d stats={r.stats7d} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      interactive: true,
      cell: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => router.push(`/rules/${r.id}`)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.run.mutate(r)}>
              <Play />
              Run now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push(`/rules/${r.id}?tab=history`)}>
              <History />
              Executions
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(r)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <DataTable
        aria-label="Rules"
        columns={columns}
        data={rules.data?.items}
        total={rules.data?.total}
        state={state}
        getRowId={(r) => r.id}
        isLoading={rules.isLoading}
        isFetching={rules.isFetching}
        error={rules.error}
        onRetry={() => void rules.refetch()}
        onRowClick={(r) => router.push(`/rules/${r.id}`)}
        minWidth={1100}
        toolbar={
          <DataTableToolbar
            state={state}
            searchPlaceholder="Search rules"
            filters={
              <FilterSelect
                state={state}
                filterKey="active"
                allLabel="Active and inactive"
                options={[
                  { value: 'true', label: 'Active' },
                  { value: 'false', label: 'Inactive' },
                ]}
              />
            }
          />
        }
        emptyState={
          state.hasActiveFilters ? (
            <EmptyState compact icon={Workflow} title="No rules match the filters" action={<Button variant="outline" size="sm" onClick={state.reset}>Reset filters</Button>} />
          ) : (
            <EmptyState
              icon={Workflow}
              title="No rules yet"
              description="For example: pause ad sets whose cost per lead is above 10 USD today, or raise the budget of campaigns with a ROAS above 3."
              action={
                <Button asChild>
                  <Link href="/rules/new">
                    <Plus />
                    New rule
                  </Link>
                </Button>
              }
            />
          )
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete rule?"
        description={deleting ? `"${deleting.name}" stops running immediately. Its execution history is kept.` : undefined}
        confirmLabel="Delete rule"
        destructive
        onConfirm={() => (deleting ? actions.remove.mutateAsync(deleting) : undefined)}
      />
    </>
  );
}

function Stats7d({ stats }: { stats: RuleDto['stats7d'] }) {
  const entries = (Object.entries(stats ?? {}) as [RuleExecutionResult, number][]).filter(([, n]) => n > 0);
  if (!entries.length) return <span className="text-muted-foreground">No executions</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([result, n]) => (
        <StatusBadge key={result} status={result} label={`${n} ${RESULT_LABELS[result]?.label.toLowerCase() ?? result}`} tone={RESULT_LABELS[result]?.tone} size="sm" />
      ))}
    </div>
  );
}

// ───────────── Executions ─────────────

function HistoryTab() {
  const state = useUrlTableState({ filterKeys: ['result', 'ruleId'] });
  const rules = useRules({ pageSize: 100 });
  return (
    <RuleExecutionsTable
      state={state}
      ruleOptions={(rules.data?.items ?? []).map((r) => ({ value: r.id, label: r.name }))}
    />
  );
}

export function RuleExecutionsTable({
  state,
  ruleId,
  ruleOptions,
  poll = false,
}: {
  state: TableController;
  /** Fixed rule (detail page): hides the rule column and filter. */
  ruleId?: string;
  ruleOptions?: { value: string; label: string }[];
  poll?: boolean;
}) {
  const params = { ...state.params, ...(ruleId ? { ruleId } : {}) };
  const executions = useRuleExecutions(params, { poll });

  const columns: DataTableColumn<RuleExecutionDto>[] = [
    {
      id: 'time',
      header: 'Time',
      cell: (e) => (
        <SimpleTooltip content={formatDateTime(e.executedAt, { seconds: true })}>
          <span className="whitespace-nowrap">
            <RelativeTime value={e.executedAt} />
          </span>
        </SimpleTooltip>
      ),
    },
    ...(ruleId
      ? []
      : [
          {
            id: 'rule',
            header: 'Rule',
            interactive: true,
            cell: (e: RuleExecutionDto) => (
              <Link href={`/rules/${e.ruleId}`} className="block max-w-[14rem] truncate hover:underline">
                {e.ruleName}
              </Link>
            ),
          },
        ]),
    {
      id: 'object',
      header: 'Object',
      cell: (e) => (
        <div className="grid min-w-0 max-w-[18rem] gap-0.5">
          <span className="truncate">{e.entityName ?? e.entityMetaId}</span>
          <span className="truncate text-xs text-muted-foreground">
            {TARGET_LABELS[e.entityLevel]?.one ?? e.entityLevel} · <span className="font-mono">{e.entityMetaId}</span>
          </span>
        </div>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (e) => (
        <div className="grid gap-0.5">
          <span>{ACTION_LABELS[e.action] ?? e.action}</span>
          {e.oldValueDisplay || e.newValueDisplay ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {e.oldValueDisplay ?? '—'} → {e.newValueDisplay ?? '—'}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'result',
      header: 'Result',
      cell: (e) => <StatusBadge status={e.result} label={RESULT_LABELS[e.result]?.label} tone={RESULT_LABELS[e.result]?.tone} />,
    },
    {
      id: 'reason',
      header: 'Details',
      cell: (e) => (
        <span className={`line-clamp-2 max-w-[22rem] text-xs whitespace-normal ${e.errorMessage ? 'text-destructive-fg' : 'text-muted-foreground'}`}>
          {e.errorMessage ?? e.reason ?? '—'}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      aria-label="Rule executions"
      columns={columns}
      data={executions.data?.items}
      total={executions.data?.total}
      state={state}
      getRowId={(e) => e.id}
      isLoading={executions.isLoading}
      isFetching={executions.isFetching}
      error={executions.error}
      onRetry={() => void executions.refetch()}
      renderExpanded={(e) => <ExecutionDetails execution={e} />}
      minWidth={ruleId ? 900 : 1080}
      toolbar={
        <DataTableToolbar
          state={state}
          searchPlaceholder="Search object name or ID"
          filters={
            <>
              <FilterSelect
                state={state}
                filterKey="result"
                allLabel="Any result"
                options={(Object.keys(RESULT_LABELS) as RuleExecutionResult[]).map((r) => ({ value: r, label: RESULT_LABELS[r].label }))}
              />
              {!ruleId && ruleOptions?.length ? <FilterSelect state={state} filterKey="ruleId" allLabel="All rules" options={ruleOptions} /> : null}
            </>
          }
        />
      }
      emptyState={
        <EmptyState
          compact
          icon={History}
          title={state.hasActiveFilters ? 'No executions match the filters' : 'No executions yet'}
          description="A rule records an execution for every object whose conditions were met, including dry runs and skipped actions."
        />
      }
    />
  );
}

function ExecutionDetails({ execution }: { execution: RuleExecutionDto }) {
  const data = execution.conditionData;
  return (
    <div className="grid gap-3 pt-1 text-sm sm:grid-cols-2">
      <div className="grid content-start gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Conditions when evaluated</span>
        {data?.conditions?.length ? (
          <ul className="grid gap-1">
            {data.conditions.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span>{c.text}</span>
                <span className="text-xs text-muted-foreground tabular-nums">actual: {c.actual === null || c.actual === undefined ? 'n/a' : String(c.actual)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">No condition data</span>
        )}
      </div>
      <div className="grid content-start gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Outcome</span>
        <p>{execution.reason ?? RESULT_LABELS[execution.result]?.label}</p>
        {execution.errorMessage ? (
          <p className="text-destructive-fg">
            {execution.errorMessage}
            {execution.errorCode ? <span className="ml-1 text-xs text-muted-foreground">(code {execution.errorCode})</span> : null}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Run <span className="font-mono">{execution.runId.slice(0, 8)}</span> · {formatDateTime(execution.executedAt, { seconds: true })}
          {execution.isDryRun ? ' · dry run' : ''}
        </p>
      </div>
    </div>
  );
}
