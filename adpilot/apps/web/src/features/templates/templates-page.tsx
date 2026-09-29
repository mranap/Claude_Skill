'use client';

import { OBJECTIVE_RULES, goalRule } from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Ellipsis,
  LayoutTemplate,
  Pencil,
  Plus,
  Rocket,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NavTabs } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  DataTable,
  DataTableToolbar,
  FilterSelect,
  useUrlTableState,
  type DataTableColumn,
} from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { RelativeTime } from '@/components/shared/relative-time';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { describeCountries } from '@/lib/utils/countries';
import { templatesApi, useTemplates, type TemplateListItem } from './api';

export function describeBudget(budget: TemplateListItem['budget'], currency?: string): string {
  if (!budget?.amount) return '—';
  const per = budget.type === 'LIFETIME' ? 'lifetime' : '/ day';
  const where = budget.level === 'CAMPAIGN' ? 'campaign' : 'per ad set';
  return `${budget.amount}${currency ? ` ${currency}` : ''} ${per} · ${where}`;
}

export function TemplatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can('app.templates.manage');
  const canLaunch = can('app.campaigns.launch');
  const state = useUrlTableState({ filterKeys: ['archived', 'objective'], defaultSort: 'updatedAt:desc' });
  const archived = state.filters.archived === 'true';
  const templates = useTemplates(state.params);
  const [deleting, setDeleting] = useState<TemplateListItem | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.all });
  const clone = useMutation({
    mutationFn: (t: TemplateListItem) => templatesApi.clone(t.id),
    onSuccess: async (copy) => {
      toast.success('Template cloned', { description: copy.name });
      await invalidate();
      router.push(`/templates/${copy.id}`);
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });
  const setArchived = useMutation({
    mutationFn: ({ t, value }: { t: TemplateListItem; value: boolean }) =>
      templatesApi.update(t.id, { isArchived: value }),
    onSuccess: async (_r, { t, value }) => {
      toast.success(value ? `“${t.name}” archived` : `“${t.name}” restored`);
      await invalidate();
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const columns: DataTableColumn<TemplateListItem>[] = [
    {
      id: 'name',
      header: 'Template',
      sortField: 'name',
      interactive: true,
      cell: (t) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/templates/${t.id}`} className="truncate font-medium hover:underline">
            {t.name}
          </Link>
          {t.description ? (
            <span className="truncate text-xs text-muted-foreground">{t.description}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'objective',
      header: 'Objective',
      cell: (t) => (
        <div className="grid gap-0.5">
          <span>{t.objectiveLabel}</span>
          <span className="text-xs text-muted-foreground">
            {t.destination && t.optimizationGoal
              ? (goalRule(t.objective, t.destination, t.optimizationGoal)?.label ?? t.optimizationGoal)
              : '—'}
          </span>
        </div>
      ),
    },
    {
      id: 'budget',
      header: 'Budget',
      cell: (t) => <span className="tabular-nums">{describeBudget(t.budget)}</span>,
    },
    { id: 'countries', header: 'Countries', cell: (t) => describeCountries(t.countries) },
    {
      id: 'groups',
      header: 'Groups',
      align: 'right',
      cell: (t) => <span className="tabular-nums">{t.variantsCount}</span>,
    },
    {
      id: 'used',
      header: 'Last used',
      sortField: 'lastUsedAt',
      cell: (t) =>
        t.lastUsedAt ? (
          <RelativeTime value={t.lastUsedAt} />
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      id: 'updated',
      header: 'Updated',
      sortField: 'updatedAt',
      cell: (t) => <RelativeTime value={t.updatedAt} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      interactive: true,
      cell: (t) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => router.push(`/templates/${t.id}`)}>
              <Pencil />
              {canManage ? 'Edit' : 'View'}
            </DropdownMenuItem>
            {canLaunch && !t.isArchived ? (
              <DropdownMenuItem onSelect={() => router.push(`/launch/new?template=${t.id}`)}>
                <Rocket />
                Launch from template
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <>
                <DropdownMenuItem onSelect={() => clone.mutate(t)}>
                  <Copy />
                  Clone
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setArchived.mutate({ t, value: !t.isArchived })}>
                  {t.isArchived ? <ArchiveRestore /> : <Archive />}
                  {t.isArchived ? 'Restore' : 'Archive'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(t)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable campaign and ad set settings with optional predefined language/geo groups. Start a launch from a template in one click."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/templates/new">
                <Plus />
                New template
              </Link>
            </Button>
          ) : null
        }
      />
      <NavTabs
        className="mb-4"
        activeHref={archived ? '/templates?archived=true' : '/templates'}
        items={[
          { href: '/templates', label: 'Active' },
          { href: '/templates?archived=true', label: 'Archived' },
        ]}
      />
      <DataTable
        aria-label="Templates"
        columns={columns}
        data={templates.data?.items}
        total={templates.data?.total}
        state={state}
        getRowId={(t) => t.id}
        isLoading={templates.isLoading}
        isFetching={templates.isFetching}
        error={templates.error}
        onRetry={() => void templates.refetch()}
        onRowClick={(t) => router.push(`/templates/${t.id}`)}
        minWidth={960}
        toolbar={
          <DataTableToolbar
            state={state}
            searchPlaceholder="Search templates"
            filters={
              <FilterSelect
                state={state}
                filterKey="objective"
                allLabel="All objectives"
                options={OBJECTIVE_RULES.map((o) => ({ value: o.objective, label: o.label }))}
              />
            }
          />
        }
        emptyState={
          <EmptyState
            icon={LayoutTemplate}
            title={
              archived
                ? 'No archived templates'
                : state.hasActiveFilters
                  ? 'No templates match'
                  : 'No templates yet'
            }
            description={
              archived || state.hasActiveFilters
                ? undefined
                : 'Save your usual objective, budget, targeting, placements and naming once and reuse them for every launch.'
            }
            action={
              canManage && !archived && !state.hasActiveFilters ? (
                <Button asChild>
                  <Link href="/templates/new">
                    <Plus />
                    Create a template
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="Templates that were already used for launches are archived instead of deleted, so the launch history keeps its reference."
        confirmLabel="Delete template"
        onConfirm={async () => {
          if (!deleting) return;
          const res = await templatesApi.remove(deleting.id);
          toast.success(
            res.archived ? 'The template was used by launches and has been archived' : 'Template deleted',
          );
          await invalidate();
        }}
      />
    </>
  );
}
