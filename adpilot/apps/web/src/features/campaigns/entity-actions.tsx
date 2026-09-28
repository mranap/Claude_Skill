'use client';

import { applyPercent } from '@adpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput, sanitizeDecimal } from '@/components/ui/money-input';
import { Progress } from '@/components/ui/progress';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorAlert } from '@/components/shared/error-alert';
import { isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils/cn';
import { decimalToMinor, formatAmount, minorToDecimal, moneyDecimals } from '@/lib/utils/money';
import { campaignsApi, isBulkDone, useBulkOperation, type BudgetChangeBody } from './api';
import type { BulkOperationDto, EntityActionLevel, EntityRef, LargeBudgetChange } from './types';

export const LEVEL_LABEL: Record<EntityActionLevel, { one: string; many: string; title: string }> = {
  CAMPAIGN: { one: 'campaign', many: 'campaigns', title: 'Campaign' },
  ADSET: { one: 'ad set', many: 'ad sets', title: 'Ad set' },
  AD: { one: 'ad', many: 'ads', title: 'Ad' },
};

export function countLabel(level: EntityActionLevel, count: number): string {
  return `${count} ${count === 1 ? LEVEL_LABEL[level].one : LEVEL_LABEL[level].many}`;
}

/** Refreshes every view that shows campaign objects after a change. */
export function useInvalidateCampaignData() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.statistics.all }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
    [queryClient],
  );
}

// ───────────── Status toggle ─────────────

/**
 * Pause/start switch bound to the configured status (the badge next to it shows Meta's delivery status).
 * Every change is confirmed first; the server re-reads the current status from Meta before acting.
 */
export function StatusToggle({ entity, canManage }: { entity: EntityRef; canManage: boolean }) {
  const [target, setTarget] = useState<'ACTIVE' | 'PAUSED' | null>(null);
  const invalidate = useInvalidateCampaignData();
  const label = LEVEL_LABEL[entity.level];
  const toggleable = entity.status === 'ACTIVE' || entity.status === 'PAUSED';
  const checked = entity.status === 'ACTIVE';

  const mutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'PAUSED') =>
      campaignsApi.setStatus({ level: entity.level, id: entity.id, status }),
    onSuccess: (result, status) => {
      const verb = status === 'PAUSED' ? 'paused' : 'started';
      if (result.changed) toast.success(`${label.title} ${verb}`, { description: entity.name });
      else
        toast.info(`${label.title} was already ${status === 'PAUSED' ? 'paused' : 'active'} in Meta`, {
          description: entity.name,
        });
      void invalidate();
    },
  });

  const reason = !canManage
    ? 'You do not have permission to change delivery'
    : !toggleable
      ? `This ${label.one} cannot be paused or started`
      : null;

  return (
    <>
      <SimpleTooltip content={reason ?? (checked ? `Pause this ${label.one}` : `Start this ${label.one}`)}>
        <span className="inline-flex">
          <Switch
            checked={checked}
            disabled={!!reason || mutation.isPending}
            onCheckedChange={(next) => setTarget(next ? 'ACTIVE' : 'PAUSED')}
            aria-label={`${checked ? 'Pause' : 'Start'} ${label.one} ${entity.name}`}
          />
        </span>
      </SimpleTooltip>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={target === 'PAUSED' ? `Pause ${label.one}?` : `Start ${label.one}?`}
        description={
          <>
            <span className="font-medium text-foreground">{entity.name}</span>
            <br />
            {target === 'PAUSED'
              ? 'Delivery stops in Meta right away. You can start it again at any time.'
              : `Delivery resumes in Meta and starts spending. ${entity.level === 'CAMPAIGN' ? 'Its ad sets and ads keep their own status.' : 'It only delivers while its campaign' + (entity.level === 'AD' ? ' and ad set are' : ' is') + ' active too.'}`}
          </>
        }
        confirmLabel={target === 'PAUSED' ? 'Pause' : 'Start'}
        onConfirm={() => (target ? mutation.mutateAsync(target) : undefined)}
      />
    </>
  );
}

// ───────────── Budget ─────────────

type BudgetMode = BudgetChangeBody['mode'];

const PERCENT_RE = /^\d{1,6}(\.\d{1,2})?$/;

function previewBudget(
  current: string,
  currency: string,
  mode: BudgetMode,
  value: string,
): { next: string | null; changePct: number | null } {
  const currentMinor = decimalToMinor(current, currency);
  if (currentMinor === null || !value) return { next: null, changePct: null };
  let nextMinor: bigint | null = null;
  if (mode === 'SET') nextMinor = decimalToMinor(value, currency);
  else if (PERCENT_RE.test(value))
    nextMinor = applyPercent(currentMinor, mode === 'INCREASE_PCT' ? value : `-${value}`);
  if (nextMinor === null) return { next: null, changePct: null };
  // Display only: the server computes and enforces the real change.
  const changePct =
    currentMinor > 0n ? Number(((nextMinor - currentMinor) * 10000n) / currentMinor) / 100 : null;
  return { next: minorToDecimal(nextMinor, currency), changePct };
}

export function BudgetCell({ entity, canManage }: { entity: EntityRef; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  if (!entity.budget) {
    const hint =
      entity.level === 'CAMPAIGN'
        ? 'Budgets are set on the ad sets'
        : entity.level === 'ADSET'
          ? 'Uses the campaign budget'
          : '';
    return (
      <SimpleTooltip content={hint}>
        <span className="text-muted-foreground">—</span>
      </SimpleTooltip>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1">
      <div className="grid justify-items-end leading-tight">
        <span className="tabular-nums">{formatAmount(entity.budget.amount, entity.currency)}</span>
        <span className="text-xs text-muted-foreground">
          {entity.budget.type === 'DAILY' ? 'daily' : 'lifetime'}
        </span>
      </div>
      {canManage && entity.level !== 'AD' ? (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Edit budget of ${entity.name}`}
            onClick={() => setOpen(true)}
          >
            <Pencil />
          </Button>
          <BudgetDialog entity={entity} open={open} onOpenChange={setOpen} />
        </>
      ) : null}
    </div>
  );
}

export function BudgetDialog({
  entity,
  open,
  onOpenChange,
}: {
  entity: EntityRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {open && entity.budget ? (
          <BudgetDialogBody entity={entity} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BudgetDialogBody({ entity, onDone }: { entity: EntityRef; onDone: () => void }) {
  const budget = entity.budget!;
  const currency = entity.currency;
  const [mode, setMode] = useState<BudgetMode>('SET');
  const [value, setValue] = useState(budget.amount);
  const [largeChange, setLargeChange] = useState<LargeBudgetChange | null>(null);
  const [touched, setTouched] = useState(false);
  const invalidate = useInvalidateCampaignData();
  const kind = budget.type === 'DAILY' ? 'Daily' : 'Lifetime';

  // One idempotency key per requested change: a retry of the same change reuses it (and can never apply a
  // relative change twice), a different value or mode gets a new one.
  const keyRef = useRef<{ change: string; key: string } | null>(null);
  const idempotencyKey = () => {
    const change = `${mode}:${value}`;
    if (keyRef.current?.change !== change) keyRef.current = { change, key: crypto.randomUUID() };
    return keyRef.current.key;
  };
  const mutation = useMutation({
    mutationFn: (confirmLargeChange: boolean) =>
      campaignsApi.changeBudget(
        { level: entity.level as 'CAMPAIGN' | 'ADSET', id: entity.id, mode, value, confirmLargeChange },
        idempotencyKey(),
      ),
    onSuccess: (result) => {
      toast.success(`${kind} budget updated`, {
        description: `${entity.name}: ${formatAmount(result.before, result.currency)} → ${formatAmount(result.after, result.currency)}`,
      });
      void invalidate();
      onDone();
    },
    onError: (error) => {
      if (
        isApiError(error, 'CONFLICT') &&
        (error.details as LargeBudgetChange | undefined)?.requiresConfirmation
      ) {
        setLargeChange(error.details as LargeBudgetChange);
      }
    },
  });

  const preview = previewBudget(budget.amount, currency, mode, value);
  const invalid =
    !value ||
    (mode === 'SET'
      ? decimalToMinor(value, currency) === null || /^0*(\.0*)?$/.test(value)
      : !PERCENT_RE.test(value) || Number(value) <= 0 || (mode === 'DECREASE_PCT' && Number(value) >= 100));
  const unchanged =
    mode === 'SET'
      ? preview.next === minorToDecimal(decimalToMinor(budget.amount, currency) ?? 0n, currency)
      : false;
  const needsConfirmation = isApiError(mutation.error, 'CONFLICT') && !!largeChange;

  const changeMode = (next: BudgetMode) => {
    setMode(next);
    setValue(next === 'SET' ? budget.amount : '');
    setLargeChange(null);
    mutation.reset();
  };

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (invalid || unchanged) return;
        mutation.mutate(!!largeChange);
      }}
    >
      <DialogHeader>
        <DialogTitle>Change {kind.toLowerCase()} budget</DialogTitle>
        <DialogDescription>
          {LEVEL_LABEL[entity.level].title} <span className="font-medium text-foreground">{entity.name}</span>
          . The change is applied in Meta immediately; relative changes start from the budget currently set in
          Meta.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        <div className="flex items-baseline justify-between rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">Current {kind.toLowerCase()} budget</span>
          <span className="font-medium tabular-nums">{formatAmount(budget.amount, currency)}</span>
        </div>
        <SegmentedControl
          aria-label="How to change the budget"
          value={mode}
          onValueChange={changeMode}
          options={[
            { value: 'SET', label: 'Set amount' },
            { value: 'INCREASE_PCT', label: 'Increase %' },
            { value: 'DECREASE_PCT', label: 'Decrease %' },
          ]}
          className="w-full [&>*]:flex-1"
        />
        <div className="grid gap-1.5">
          <Label htmlFor="budget-value">
            {mode === 'SET'
              ? `New ${kind.toLowerCase()} budget`
              : mode === 'INCREASE_PCT'
                ? 'Increase by'
                : 'Decrease by'}
          </Label>
          {mode === 'SET' ? (
            <MoneyInput
              id="budget-value"
              value={value}
              onValueChange={(v) => {
                setValue(v);
                setLargeChange(null);
              }}
              currency={currency}
              decimals={moneyDecimals(currency)}
              aria-invalid={touched && invalid}
              autoFocus
            />
          ) : (
            <div className="relative">
              <Input
                id="budget-value"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) => {
                  setValue(sanitizeDecimal(e.target.value, 2, 6));
                  setLargeChange(null);
                }}
                className="pr-8 tabular-nums"
                aria-invalid={touched && invalid}
                autoFocus
              />
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-muted-foreground">
                %
              </span>
            </div>
          )}
          {touched && invalid ? (
            <p className="text-xs text-destructive-fg">
              {mode === 'SET'
                ? `Enter an amount greater than zero${moneyDecimals(currency) === 0 ? ' (no decimals for ' + currency + ')' : ''}`
                : mode === 'DECREASE_PCT'
                  ? 'Enter a percentage between 0 and 100'
                  : 'Enter a percentage greater than zero'}
            </p>
          ) : touched && unchanged ? (
            <p className="text-xs text-muted-foreground">That is the current budget.</p>
          ) : null}
        </div>
        {preview.next !== null && !invalid ? (
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">New budget</span>
            <span className="tabular-nums">
              <span className="font-medium">{formatAmount(preview.next, currency)}</span>
              {preview.changePct !== null && preview.changePct !== 0 ? (
                <span
                  className={cn(
                    'ml-2 text-xs',
                    Math.abs(preview.changePct) > 50 ? 'text-warning-fg' : 'text-muted-foreground',
                  )}
                >
                  {preview.changePct > 0 ? '+' : ''}
                  {preview.changePct.toFixed(1)} %
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
        {needsConfirmation && largeChange ? (
          <Alert variant="warning">
            <AlertTitle>Confirm a large budget change</AlertTitle>
            <AlertDescription>
              This changes the budget by{' '}
              <span className="font-medium text-foreground tabular-nums">
                {largeChange.changePct > 0 ? '+' : ''}
                {largeChange.changePct.toFixed(1)} %
              </span>{' '}
              ({formatAmount(largeChange.before, largeChange.currency)} →{' '}
              {formatAmount(largeChange.after, largeChange.currency)}). Large jumps can restart Meta&apos;s
              learning phase.
            </AlertDescription>
          </Alert>
        ) : mutation.error ? (
          <ErrorAlert error={mutation.error} />
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={mutation.isPending}
          variant={needsConfirmation ? 'destructive' : 'default'}
        >
          {needsConfirmation ? 'Confirm large change' : 'Change budget'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ───────────── Bulk status ─────────────

export interface BulkRequest {
  level: EntityActionLevel;
  status: 'ACTIVE' | 'PAUSED';
  targets: { id: string; name: string }[];
}

/**
 * Confirmation for bulk pause/start. Mount it only while open: the idempotency key is created once per
 * confirmation, so a retried request after a network error can never run the action twice.
 */
export function BulkStatusDialog({
  request,
  onClose,
  onStarted,
}: {
  request: BulkRequest;
  onClose: () => void;
  onStarted: (op: BulkOperationDto) => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { level, status, targets } = request;
  const verb = status === 'PAUSED' ? 'Pause' : 'Start';
  const shown = targets.slice(0, 8);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${verb} ${countLabel(level, targets.length)}?`}
      description={
        status === 'PAUSED'
          ? 'Delivery stops in Meta for every selected object. Objects that are already paused are skipped.'
          : 'Delivery resumes in Meta and the selected objects start spending. Objects that are already active are skipped.'
      }
      confirmLabel={`${verb} ${countLabel(level, targets.length)}`}
      onConfirm={async () => {
        const op = await campaignsApi.bulkStatus({
          level,
          ids: targets.map((t) => t.id),
          status,
          idempotencyKey,
          confirmed: true,
        });
        onStarted(op);
      }}
    >
      <ul className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        {shown.map((t) => (
          <li key={t.id} className="truncate py-0.5">
            {t.name}
          </li>
        ))}
        {targets.length > shown.length ? (
          <li className="py-0.5 text-muted-foreground">and {targets.length - shown.length} more</li>
        ) : null}
      </ul>
    </ConfirmDialog>
  );
}

/** Live progress of a bulk operation (polls GET /campaigns/bulk/:id until it finishes). */
export function BulkOperationBanner({
  operation,
  onDismiss,
  className,
}: {
  operation: BulkOperationDto;
  onDismiss: () => void;
  className?: string;
}) {
  const query = useBulkOperation(operation.id, operation);
  const op = query.data ?? operation;
  const done = isBulkDone(op);
  const invalidate = useInvalidateCampaignData();
  const onFinished = useEffectEvent(() => void invalidate());
  useEffect(() => {
    if (done) onFinished();
  }, [done]);

  const results = op.results ?? [];
  const processed = results.length;
  const failures = results.filter((r) => !r.ok);
  const unchanged = results.filter((r) => r.ok && r.changed === false).length;
  const verb = op.action === 'PAUSE' ? 'Paus' : 'Start';
  const variant = !done
    ? 'info'
    : failures.length === 0
      ? 'success'
      : op.succeeded === 0
        ? 'destructive'
        : 'warning';

  return (
    <Alert variant={variant} className={className} aria-live="polite" data-testid="bulk-operation">
      <AlertTitle className="flex items-center gap-2 pr-8">
        {!done
          ? `${verb}ing ${countLabel(op.level, op.total)}…`
          : `${verb}ed ${op.succeeded} of ${countLabel(op.level, op.total)}${failures.length ? ` · ${failures.length} failed` : ''}`}
      </AlertTitle>
      <AlertDescription className="grid gap-2">
        {!done ? (
          <div className="grid gap-1">
            <Progress
              value={op.total ? (processed / op.total) * 100 : 0}
              indeterminate={processed === 0}
              aria-label="Bulk action progress"
            />
            <span className="text-xs tabular-nums">
              {processed} of {op.total} processed
            </span>
          </div>
        ) : unchanged > 0 ? (
          <span className="text-xs">
            {unchanged} {unchanged === 1 ? 'was' : 'were'} already{' '}
            {op.action === 'PAUSE' ? 'paused' : 'active'}.
          </span>
        ) : null}
        {failures.length ? (
          <ul className="grid gap-1 text-xs">
            {failures.slice(0, 10).map((f) => (
              <li key={f.id} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive-fg" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">{f.name ?? f.id}</span>: {f.error ?? 'Failed'}
                </span>
              </li>
            ))}
            {failures.length > 10 ? <li>and {failures.length - 10} more</li> : null}
          </ul>
        ) : null}
        {query.error && !done ? (
          <span className="text-xs text-destructive-fg">Could not refresh the progress; retrying…</span>
        ) : null}
      </AlertDescription>
      {done ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-2.5 right-2.5"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <X />
        </Button>
      ) : null}
    </Alert>
  );
}
