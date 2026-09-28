'use client';

import { BID_STRATEGY_LABELS, goalRule, objectiveRule, type BidStrategy } from '@adpilot/shared';
import { ArrowRight, ChevronDown, CircleAlert, CircleCheck, FileJson, FlaskConical, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/shared/error-alert';
import { JsonViewer } from '@/components/shared/json-viewer';
import { KeyValueList } from '@/components/shared/key-value';
import { StatCard } from '@/components/shared/stat-card';
import { formatAmount } from '@/lib/utils/money';
import { humanize } from '@/lib/utils/strings';
import { describePath } from '../../campaign-settings/paths';
import type { DryRunItem, DryRunResult, PlanSummary, ValidationIssue, ValidationResult } from '../types';
import { WIZARD_STEPS, stepOfPath } from './steps';

export interface ReviewState {
  validation?: ValidationResult;
  dryRun?: DryRunResult;
  /** JSON of the configuration the results belong to. */
  snapshot?: string;
}

export function IssueList({
  issues,
  tone,
  variantLabels,
  onGoTo,
}: {
  issues: ValidationIssue[];
  tone: 'error' | 'warning';
  variantLabels: string[];
  onGoTo: (step: number) => void;
}) {
  return (
    <ul className="grid gap-2">
      {issues.map((issue, i) => {
        const step = stepOfPath(issue.path);
        return (
          <li key={`${issue.path}:${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm">
            {tone === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive-fg" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden />}
            <span className="min-w-0 flex-1">
              {issue.path ? <span className="font-medium">{describePath(issue.path, variantLabels)}: </span> : null}
              <span className="text-muted-foreground">{issue.message}</span>
            </span>
            {step < WIZARD_STEPS.length - 2 ? (
              <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => onGoTo(step)}>
                {WIZARD_STEPS[step]!.title}
                <ArrowRight />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ReviewStep({
  review,
  stale,
  running,
  error,
  variantLabels,
  onRun,
  onGoTo,
}: {
  review: ReviewState;
  stale: boolean;
  running: 'validate' | 'dry-run' | null;
  error: unknown;
  variantLabels: string[];
  onRun: (kind: 'validate' | 'dry-run') => void;
  onGoTo: (step: number) => void;
}) {
  const result = review.dryRun ?? review.validation;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle>Check before launching</CardTitle>
            <CardDescription>Validation runs every rule locally. The dry run also shows each object that would be created, with the exact Meta payload. Nothing is sent to Meta.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => onRun('validate')} loading={running === 'validate'} disabled={!!running}>
              <ShieldCheck />
              Validate
            </Button>
            <Button type="button" onClick={() => onRun('dry-run')} loading={running === 'dry-run'} disabled={!!running}>
              <FlaskConical />
              Dry run
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error ? <ErrorAlert error={error} /> : null}
          {running && !result ? <Skeleton className="h-24" /> : null}
          {result && stale ? (
            <Alert variant="info">
              <AlertDescription>The configuration changed since this check. Run it again to see the current result.</AlertDescription>
            </Alert>
          ) : null}
          {result ? (
            result.ok ? (
              <Alert variant="success" icon={<CircleCheck />}>
                <AlertTitle>Ready to launch</AlertTitle>
                <AlertDescription>
                  No blocking problems{result.warnings.length ? `, ${result.warnings.length} ${result.warnings.length === 1 ? 'warning' : 'warnings'} to review` : ''}.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive" icon={<CircleAlert />}>
                <AlertTitle>
                  {result.errors.length} {result.errors.length === 1 ? 'problem blocks' : 'problems block'} the launch
                </AlertTitle>
                <AlertDescription>Fix them in the steps shown next to each problem.</AlertDescription>
              </Alert>
            )
          ) : !running ? (
            <p className="text-sm text-muted-foreground">Run a validation or a dry run to check the configuration.</p>
          ) : null}
          {result?.errors.length ? <IssueList issues={result.errors} tone="error" variantLabels={variantLabels} onGoTo={onGoTo} /> : null}
          {result?.warnings.length ? (
            <div className="grid gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Warnings</p>
              <IssueList issues={result.warnings} tone="warning" variantLabels={variantLabels} onGoTo={onGoTo} />
            </div>
          ) : null}
        </CardContent>
      </Card>
      {review.dryRun?.ok && review.dryRun.summary ? <PlanSummaryCard summary={review.dryRun.summary} /> : null}
      {review.dryRun?.ok && review.dryRun.items ? <PlanItems items={review.dryRun.items} /> : null}
    </div>
  );
}

export function PlanSummaryCard({ summary, title = 'What will be created' }: { summary: PlanSummary; title?: string }) {
  const goal = goalRule(summary.objective, summary.destination, summary.optimizationGoal);
  const budgetLabel = summary.budget.type === 'LIFETIME' ? 'lifetime' : 'daily';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Amounts are in {summary.currency}, the ad account currency.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Campaigns" value={String(summary.campaigns)} />
          <StatCard label="Ad sets" value={String(summary.adSets)} />
          <StatCard label="Ads" value={String(summary.ads)} />
          <StatCard label="Creatives" value={String(summary.creatives)} />
          <StatCard label="Media uploads" value={String(summary.mediaUploads)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <KeyValueList
            items={[
              { label: 'Objective', value: `${objectiveRule(summary.objective)?.label ?? summary.objective} · ${goal?.label ?? humanize(summary.optimizationGoal)}` },
              { label: 'Budget', value: `${summary.budget.level === 'CAMPAIGN' ? 'Campaign' : 'Per ad set'}, ${budgetLabel}` },
              { label: 'Total budget', value: `${formatAmount(summary.budget.total, summary.currency)} ${budgetLabel}` },
              { label: 'Bid strategy', value: BID_STRATEGY_LABELS[summary.bidStrategy as BidStrategy]?.label ?? humanize(summary.bidStrategy) },
              { label: 'Placements', value: summary.placements },
              { label: 'After launch', value: summary.activateOnSuccess ? 'Activated automatically' : 'Stays paused for review' },
            ]}
          />
          <KeyValueList
            items={[
              {
                label: 'Audience',
                value: `${summary.audience.ageMin}–${summary.audience.ageMax === 65 ? '65+' : summary.audience.ageMax}, ${summary.audience.genders === 'ALL' ? 'all genders' : humanize(summary.audience.genders).toLowerCase()}${summary.audience.advantageAudience ? ', Advantage+ audience' : ''}`,
              },
              { label: 'Custom audiences', value: `${summary.audience.customAudiences} included · ${summary.audience.excludedAudiences} excluded`, hidden: !summary.audience.customAudiences && !summary.audience.excludedAudiences },
              { label: 'Interests', value: summary.audience.interests, hidden: !summary.audience.interests },
              { label: 'Creative files', value: summary.creativeFiles.map((f) => f.name).join(', ') },
            ]}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-surface-subtle text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Group (ad set)</th>
                <th className="px-3 py-2 font-medium">Countries</th>
                <th className="px-3 py-2 font-medium">Languages</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.geos.map((g, i) => (
                <tr key={`${g.variant}:${i}`}>
                  <td className="px-3 py-2 font-medium">{g.variant}</td>
                  <td className="px-3 py-2">{g.countries.join(', ')}</td>
                  <td className="px-3 py-2 text-muted-foreground">{g.locales.join(', ') || 'All'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {summary.budget.level === 'ADSET' ? formatAmount(summary.budget.perAdSet[i]?.amount, summary.currency) : 'Campaign budget'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

const KIND_LABEL: Record<DryRunItem['kind'], string> = {
  MEDIA_IMAGE: 'Image upload',
  MEDIA_VIDEO: 'Video upload',
  CAMPAIGN: 'Campaign',
  ADSET: 'Ad set',
  CREATIVE: 'Ad creative',
  AD: 'Ad',
};

function PlanItems({ items }: { items: DryRunItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Objects and payloads</CardTitle>
        <CardDescription>Exactly what will be sent to Meta, in order. References such as ‹metaId of campaign› are filled in while launching.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2">
          {items.map((item) => (
            <PlanItemRow key={item.key} item={item} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function PlanItemRow({ item }: { item: DryRunItem }) {
  const [open, setOpen] = useState(false);
  const indent = item.kind === 'CREATIVE' || item.kind === 'AD' ? 'sm:ml-10' : item.kind === 'ADSET' ? 'sm:ml-5' : '';
  return (
    <li className={indent}>
      <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
        <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Badge variant={item.kind === 'CAMPAIGN' ? 'default' : item.kind === 'ADSET' ? 'info' : item.kind.startsWith('MEDIA') ? 'muted' : 'secondary'} size="sm">
            {KIND_LABEL[item.kind]}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
          <FileJson className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          <span className="sr-only">Show payload</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t p-3">
            <JsonViewer value={item.payload} maxHeightClass="max-h-96" />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
