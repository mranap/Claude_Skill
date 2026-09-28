'use client';

import { CircleAlert, Rocket, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorAlert } from '@/components/shared/error-alert';
import { formatAmount } from '@/lib/utils/money';
import type { AdAccountDto } from '../../ad-accounts/types';
import type { PlanSummary } from '../types';
import { PlanSummaryCard } from './review-step';

export function LaunchStep({
  account,
  summary,
  checked,
  stale,
  blocked,
  launching,
  error,
  onLaunch,
  onReview,
}: {
  account?: AdAccountDto;
  summary?: PlanSummary;
  /** A dry run for the current configuration passed. */
  checked: boolean;
  stale: boolean;
  blocked: boolean;
  launching: boolean;
  error: unknown;
  onLaunch: () => void;
  onReview: () => void;
}) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Launch</CardTitle>
          <CardDescription>
            Every object is created paused first and verified at Meta. The launch keeps running in the background — you can close this page and follow the
            progress in the launch history.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {blocked ? (
            <Alert variant="destructive" icon={<CircleAlert />}>
              <AlertTitle>The configuration has errors</AlertTitle>
              <AlertDescription>Fix the problems listed in the review step before launching.</AlertDescription>
            </Alert>
          ) : !checked || stale ? (
            <Alert variant="info" icon={<ShieldCheck />}>
              <AlertTitle>{stale ? 'The configuration changed after the last check' : 'Not checked yet'}</AlertTitle>
              <AlertDescription>The configuration is validated again when you launch. A dry run shows every payload first.</AlertDescription>
            </Alert>
          ) : null}
          {summary ? (
            <p className="text-sm">
              You are about to create <strong>1 campaign</strong>, <strong>{summary.adSets} ad {summary.adSets === 1 ? 'set' : 'sets'}</strong> and{' '}
              <strong>
                {summary.ads} {summary.ads === 1 ? 'ad' : 'ads'}
              </strong>{' '}
              in <strong>{account?.name ?? 'the ad account'}</strong> with a total {summary.budget.type === 'LIFETIME' ? 'lifetime' : 'daily'} budget of{' '}
              <strong>{formatAmount(summary.budget.total, summary.currency)}</strong>.{' '}
              {summary.activateOnSuccess ? 'They are activated when everything was created.' : 'They stay paused until you activate them.'}
            </p>
          ) : null}
          {error ? <ErrorAlert error={error} title="The launch could not start" /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" onClick={onLaunch} loading={launching} disabled={blocked || launching} data-testid="launch-now">
              <Rocket />
              Launch now
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={onReview} disabled={launching}>
              Back to review
            </Button>
          </div>
        </CardContent>
      </Card>
      {summary && !stale ? <PlanSummaryCard summary={summary} /> : null}
    </div>
  );
}
