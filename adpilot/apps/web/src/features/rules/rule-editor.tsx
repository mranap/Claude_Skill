'use client';

import {
  RULE_METRIC_LABELS,
  RULE_METRICS,
  RULE_METRICS_DAILY_ONLY,
  RULE_OPERATOR_LABELS,
  RULE_OPERATORS,
  ruleCreateSchema,
  type RuleMetric,
  type RuleOperator,
} from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch, type Control, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput, sanitizeDecimal } from '@/components/ui/money-input';
import { MultiCombobox } from '@/components/ui/multi-combobox';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { applyServerErrors, FormField, FormRootError, NumberField, TextField } from '@/components/shared/form';
import { queryKeys } from '@/lib/api/query-keys';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes';
import { moneyDecimals } from '@/lib/utils/money';
import { useConnectedAdAccounts } from '../ad-accounts/api';
import { useCampaigns } from '../campaigns/api';
import { rulesApi } from './api';
import { ACTION_LABELS, isBudgetAction, TIME_RANGE_LABELS } from './labels';
import type { RuleAction, RuleDto, RuleTimeRange } from './types';

type RuleFormInput = z.input<typeof ruleCreateSchema>;
type RuleFormOutput = z.output<typeof ruleCreateSchema>;

function initialValues(rule?: RuleDto): RuleFormInput {
  if (!rule) {
    return {
      name: '',
      description: '',
      isActive: true,
      isDryRun: false,
      targetLevel: 'ADSET',
      scope: { adAccountIds: [], campaignIds: [], nameContains: '' },
      conditions: [{ metric: 'cpl', operator: 'gt', value: '' }],
      timeRange: 'TODAY',
      timeRangeValue: undefined,
      action: 'PAUSE',
      actionValue: undefined,
      maxBudgetChangePercent: undefined,
      minBudget: undefined,
      maxBudget: undefined,
      cooldownMinutes: 360,
      maxActionsPerDay: 3,
      checkIntervalMinutes: 60,
      notify: true,
    };
  }
  return {
    name: rule.name,
    description: rule.description ?? '',
    isActive: rule.isActive,
    isDryRun: rule.isDryRun,
    targetLevel: rule.targetLevel,
    scope: { adAccountIds: rule.scope.adAccountIds ?? [], campaignIds: rule.scope.campaignIds ?? [], nameContains: rule.scope.nameContains ?? '' },
    conditions: rule.conditions.map((c) => ({ metric: c.metric, operator: c.operator, value: c.value, valueTo: c.valueTo })),
    timeRange: rule.timeRange,
    timeRangeValue: rule.timeRangeValue ?? undefined,
    action: rule.action,
    actionValue: trimDecimal(rule.actionValue),
    maxBudgetChangePercent: trimDecimal(rule.maxBudgetChangePercent),
    minBudget: rule.minBudget ?? undefined,
    maxBudget: rule.maxBudget ?? undefined,
    cooldownMinutes: rule.cooldownMinutes,
    maxActionsPerDay: rule.maxActionsPerDay,
    checkIntervalMinutes: rule.checkIntervalMinutes,
    notify: rule.notify,
  };
}

/** Decimal(18,4) columns come back as "20.0000": show "20". */
function trimDecimal(value: string | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

/** Empty optional decimals must be `undefined` (an empty string fails the schema's number format). */
const orUndefined = (v: string) => (v === '' ? undefined : v);

export function RuleEditor({ rule, onSaved }: { rule?: RuleDto; onSaved?: (rule: RuleDto) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accounts = useConnectedAdAccounts();
  const form = useForm<RuleFormInput, unknown, RuleFormOutput>({ resolver: zodResolver(ruleCreateSchema), defaultValues: initialValues(rule) });
  useUnsavedChangesWarning(form.formState.isDirty && !form.formState.isSubmitSuccessful);
  const [adAccountIds, action, targetLevel, timeRange] = useWatch({ control: form.control, name: ['scope.adAccountIds', 'action', 'targetLevel', 'timeRange'] });
  const conditions = useWatch({ control: form.control, name: 'conditions' });

  // Activation can also change from the page header: follow it without discarding other unsaved edits.
  const serverActive = rule?.isActive;
  useEffect(() => {
    if (serverActive !== undefined) form.resetField('isActive', { defaultValue: serverActive });
  }, [serverActive, form]);

  const selectedAccounts = (accounts.data ?? []).filter((a) => (adAccountIds ?? []).includes(a.id));
  const currencies = [...new Set(selectedAccounts.map((a) => a.currency))];
  const currency = currencies.length === 1 ? currencies[0]! : undefined;
  const usesMoney = (conditions ?? []).some((c) => c?.metric && RULE_METRIC_LABELS[c.metric as RuleMetric]?.money) || action === 'SET_BUDGET';
  const budget = isBudgetAction(action);

  const onValid = async (values: RuleFormOutput) => {
    try {
      const saved = rule ? await rulesApi.update(rule.id, values) : await rulesApi.create(values);
      queryClient.setQueryData(queryKeys.rules.detail(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.rules.all });
      toast.success(rule ? 'Rule saved' : 'Rule created', {
        description: saved.isActive ? `"${saved.name}" runs ${saved.isDryRun ? 'in dry-run mode ' : ''}on its schedule.` : `"${saved.name}" is inactive.`,
      });
      form.reset(initialValues(saved));
      onSaved?.(saved);
      if (!rule) router.replace(`/rules/${saved.id}`);
    } catch (error) {
      applyServerErrors(form, error);
    }
  };

  const onInvalid = () => toast.error('Some fields need your attention');

  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={form.handleSubmit(onValid, onInvalid)} className="grid gap-4">
        <FormRootError />

        <Card>
          <CardHeader>
            <CardTitle>Rule</CardTitle>
            <CardDescription>Give it a name that says what it does, e.g. “Pause expensive leads”.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <TextField control={form.control} name="name" label="Name" required maxLength={120} placeholder="Pause ad sets with CPL above 10" />
            <FormField
              control={form.control}
              name="description"
              label="Description"
              render={({ field, controlProps }) => <Textarea {...controlProps} {...field} value={field.value ?? ''} rows={1} maxLength={500} placeholder="Optional notes" />}
            />
            <SwitchField control={form.control} name="isActive" label="Active" description="Inactive rules keep their settings but never run." />
            <SwitchField
              control={form.control}
              name="isDryRun"
              label="Dry run"
              description="Evaluate and record what would happen, without changing anything in Meta."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Apply to</CardTitle>
            <CardDescription>The rule evaluates every matching object of the selected ad accounts separately.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <FormField
              control={form.control}
              name="targetLevel"
              label="Objects"
              className="lg:col-span-2"
              render={({ field }) => (
                <SegmentedControl
                  aria-label="Objects"
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    if (v === 'AD' && isBudgetAction(form.getValues('action'))) form.setValue('action', 'PAUSE', { shouldDirty: true });
                  }}
                  options={[
                    { value: 'CAMPAIGN', label: 'Campaigns' },
                    { value: 'ADSET', label: 'Ad sets' },
                    { value: 'AD', label: 'Ads' },
                  ]}
                  className="w-fit"
                />
              )}
            />
            <FormField
              control={form.control}
              name="scope.adAccountIds"
              label="Ad accounts"
              required
              description={currency ? `Money amounts are in ${currency}.` : currencies.length > 1 ? undefined : 'Amounts use the currency of the selected accounts.'}
              render={({ field, controlProps }) => (
                <MultiCombobox
                  {...controlProps}
                  value={field.value ?? []}
                  onValueChange={(v) => {
                    field.onChange(v);
                    // Campaigns of accounts that were removed no longer apply.
                    const campaigns = form.getValues('scope.campaignIds') ?? [];
                    if (campaigns.length) form.setValue('scope.campaignIds', [], { shouldDirty: true });
                  }}
                  options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name, hint: `${a.currency} · act_${a.metaAccountId}` }))}
                  placeholder={accounts.isLoading ? 'Loading ad accounts…' : 'Select ad accounts'}
                  addLabel="Add ad account"
                  searchPlaceholder="Search ad accounts"
                  emptyText="No connected ad accounts"
                />
              )}
            />
            <CampaignScopeField control={form.control} adAccountIds={adAccountIds ?? []} />
            <TextField
              control={form.control}
              name="scope.nameContains"
              label="Name contains"
              description="Optional: only objects whose name contains this text (case-insensitive)."
              maxLength={100}
              placeholder="e.g. | PL |"
            />
            {usesMoney && currencies.length > 1 ? (
              <Alert variant="warning" className="lg:col-span-2">
                <AlertTitle>Ad accounts use different currencies ({currencies.join(', ')})</AlertTitle>
                <AlertDescription>Money amounts would be ambiguous. Select ad accounts with one currency, or use conditions without amounts.</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conditions</CardTitle>
            <CardDescription>All conditions must be true (AND). Metrics are read fresh from Meta for the chosen period, in each ad account&apos;s time zone.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ConditionsEditor form={form} currency={currency} hourly={timeRange === 'LAST_N_HOURS'} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="timeRange"
                label="Period"
                render={({ field, controlProps }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      if (v === 'TODAY' || v === 'YESTERDAY') form.setValue('timeRangeValue', undefined, { shouldDirty: true });
                    }}
                  >
                    <SelectTrigger {...controlProps}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TIME_RANGE_LABELS) as RuleTimeRange[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {TIME_RANGE_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {timeRange === 'LAST_N_HOURS' || timeRange === 'LAST_N_DAYS' ? (
                <NumberField
                  control={form.control}
                  name="timeRangeValue"
                  label={timeRange === 'LAST_N_HOURS' ? 'Number of hours' : 'Number of days'}
                  unit={timeRange === 'LAST_N_HOURS' ? 'hours' : 'days'}
                  min={1}
                  max={timeRange === 'LAST_N_HOURS' ? 48 : 90}
                />
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Action</CardTitle>
            <CardDescription>What happens to each object whose conditions are met.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="action"
              label="Action"
              render={({ field, controlProps }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    form.setValue('actionValue', undefined, { shouldDirty: true });
                  }}
                >
                  <SelectTrigger {...controlProps}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTION_LABELS) as RuleAction[]).map((k) => (
                      <SelectItem key={k} value={k} disabled={targetLevel === 'AD' && isBudgetAction(k)} description={targetLevel === 'AD' && isBudgetAction(k) ? 'Ads have no budget' : undefined}>
                        {ACTION_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {action === 'INCREASE_BUDGET' || action === 'DECREASE_BUDGET' ? (
              <PercentField control={form.control} name="actionValue" label={action === 'INCREASE_BUDGET' ? 'Increase by' : 'Decrease by'} description={action === 'INCREASE_BUDGET' ? '1–500 % of the current budget' : '1–90 % of the current budget'} />
            ) : action === 'SET_BUDGET' ? (
              <MoneyField control={form.control} name="actionValue" label="New budget" currency={currency} decimals={4} />
            ) : (
              <p className="self-end pb-2 text-sm text-muted-foreground">
                {action === 'NOTIFY_ONLY' ? 'You get a notification; nothing is changed in Meta.' : action === 'PAUSE' ? 'Objects that are already paused are skipped.' : 'Objects that are already active are skipped.'}
              </p>
            )}
            {budget ? (
              <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
                <PercentField control={form.control} name="maxBudgetChangePercent" label="Max change per run" description="Optional cap on a single change" />
                <MoneyField control={form.control} name="minBudget" label="Minimum budget" currency={currency} description="Never go below" />
                <MoneyField control={form.control} name="maxBudget" label="Maximum budget" currency={currency} description="Never go above" />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule and safeguards</CardTitle>
            <CardDescription>Limits that keep a rule from acting too often on the same object.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <NumberField control={form.control} name="checkIntervalMinutes" label="Check every" unit="minutes" min={15} max={1440} description="The administrator sets the minimum." />
            <NumberField control={form.control} name="cooldownMinutes" label="Cooldown per object" unit="minutes" min={30} max={10080} description="Wait after acting on an object." />
            <NumberField control={form.control} name="maxActionsPerDay" label="Max actions per object per day" min={1} max={50} />
            <SwitchField control={form.control} name="notify" label="Notify me" description="One summary notification per run when the rule acts." className="sm:col-span-3" />
          </CardContent>
        </Card>

        <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          <Button type="button" variant="outline" onClick={() => (rule ? form.reset(initialValues(rule)) : router.push('/rules'))} disabled={form.formState.isSubmitting}>
            {rule ? 'Discard changes' : 'Cancel'}
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!!rule && !form.formState.isDirty}>
            <Save />
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

function SwitchField({
  control,
  name,
  label,
  description,
  className,
}: {
  control: Control<RuleFormInput, unknown, RuleFormOutput>;
  name: 'isActive' | 'isDryRun' | 'notify';
  label: string;
  description: string;
  className?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      orientation="horizontal"
      className={className}
      render={({ field, controlProps }) => <Switch {...controlProps} checked={!!field.value} onCheckedChange={field.onChange} />}
    />
  );
}

function PercentField({
  control,
  name,
  label,
  description,
}: {
  control: Control<RuleFormInput, unknown, RuleFormOutput>;
  name: 'actionValue' | 'maxBudgetChangePercent';
  label: string;
  description?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      render={({ field, controlProps }) => (
        <div className="relative">
          <Input
            {...controlProps}
            inputMode="decimal"
            autoComplete="off"
            value={field.value ?? ''}
            onChange={(e) => field.onChange(orUndefined(sanitizeDecimal(e.target.value, 2, 3)))}
            onBlur={field.onBlur}
            className="pr-8 tabular-nums"
          />
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-muted-foreground">%</span>
        </div>
      )}
    />
  );
}

function MoneyField({
  control,
  name,
  label,
  currency,
  description,
  decimals,
}: {
  control: Control<RuleFormInput, unknown, RuleFormOutput>;
  name: 'actionValue' | 'minBudget' | 'maxBudget';
  label: string;
  currency: string | undefined;
  description?: string;
  decimals?: number;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description ?? (currency ? undefined : 'Select ad accounts to see the currency')}
      render={({ field, controlProps }) => (
        <MoneyInput
          {...controlProps}
          value={field.value ?? ''}
          onValueChange={(v) => field.onChange(orUndefined(v))}
          onBlur={field.onBlur}
          currency={currency}
          decimals={Math.min(decimals ?? 2, moneyDecimals(currency))}
        />
      )}
    />
  );
}

function CampaignScopeField({ control, adAccountIds }: { control: Control<RuleFormInput, unknown, RuleFormOutput>; adAccountIds: string[] }) {
  const campaigns = useCampaigns({ pageSize: 200, sort: 'name:asc' }, adAccountIds.length > 0);
  const options = useMemo(
    () =>
      (campaigns.data?.items ?? [])
        .filter((c) => adAccountIds.includes(c.adAccount.id))
        .map((c) => ({ value: c.id, label: c.name, hint: `${c.adAccount.name} · ${c.metaCampaignId}`, keywords: [c.metaCampaignId] })),
    [campaigns.data, adAccountIds],
  );
  return (
    <FormField
      control={control}
      name="scope.campaignIds"
      label="Campaigns"
      description="Optional: leave empty for all campaigns of the selected ad accounts."
      render={({ field, controlProps }) => (
        <MultiCombobox
          {...controlProps}
          value={field.value ?? []}
          onValueChange={field.onChange}
          options={options}
          disabled={!adAccountIds.length}
          placeholder={!adAccountIds.length ? 'Select ad accounts first' : campaigns.isLoading ? 'Loading campaigns…' : 'All campaigns'}
          addLabel="Add campaign"
          searchPlaceholder="Search campaigns"
          emptyText="No campaigns in these ad accounts"
        />
      )}
    />
  );
}

function ConditionsEditor({
  form,
  currency,
  hourly,
}: {
  form: UseFormReturn<RuleFormInput, unknown, RuleFormOutput>;
  currency: string | undefined;
  /** "Last N hours": Meta has no hourly website conversions, so conversion metrics are unavailable. */
  hourly: boolean;
}) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'conditions' });
  const values = useWatch({ control: form.control, name: 'conditions' });
  const rootError = form.formState.errors.conditions?.root?.message ?? form.formState.errors.conditions?.message;

  return (
    <div className="grid gap-2">
      {fields.map((field, index) => {
        const metric = (values?.[index]?.metric ?? 'spend') as RuleMetric;
        const operator = (values?.[index]?.operator ?? 'gt') as RuleOperator;
        const meta = RULE_METRIC_LABELS[metric];
        const valueInput = (name: `conditions.${number}.value` | `conditions.${number}.valueTo`, label: string) => (
          <FormField
            control={form.control}
            name={name}
            render={({ field: f, controlProps }) =>
              meta.money ? (
                <MoneyInput {...controlProps} aria-label={label} value={f.value ?? ''} onValueChange={(v) => f.onChange(name.endsWith('valueTo') ? orUndefined(v) : v)} onBlur={f.onBlur} currency={currency} decimals={4} />
              ) : (
                <Input
                  {...controlProps}
                  aria-label={label}
                  inputMode="decimal"
                  autoComplete="off"
                  value={f.value ?? ''}
                  onChange={(e) => {
                    const v = sanitizeDecimal(e.target.value, 4);
                    f.onChange(name.endsWith('valueTo') ? orUndefined(v) : v);
                  }}
                  onBlur={f.onBlur}
                  className="tabular-nums"
                />
              )
            }
          />
        );
        return (
          <div key={field.id} className="grid gap-2">
            {index > 0 ? <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">and</span> : null}
            <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
              <FormField
                control={form.control}
                name={`conditions.${index}.metric`}
                render={({ field: f, controlProps }) => (
                  <Select value={f.value} onValueChange={f.onChange}>
                    <SelectTrigger {...controlProps} aria-label={`Condition ${index + 1} metric`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_METRICS.map((m) => {
                        const unavailable = hourly && RULE_METRICS_DAILY_ONLY.includes(m);
                        return (
                          <SelectItem key={m} value={m} disabled={unavailable} description={unavailable ? 'Not reported by hour; use a daily period' : undefined}>
                            {RULE_METRIC_LABELS[m].label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              />
              <FormField
                control={form.control}
                name={`conditions.${index}.operator`}
                render={({ field: f, controlProps }) => (
                  <Select
                    value={f.value}
                    onValueChange={(v) => {
                      f.onChange(v);
                      if (v !== 'between') form.setValue(`conditions.${index}.valueTo`, undefined, { shouldDirty: true });
                    }}
                  >
                    <SelectTrigger {...controlProps} aria-label={`Condition ${index + 1} operator`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_OPERATORS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {RULE_OPERATOR_LABELS[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {valueInput(`conditions.${index}.value`, `Condition ${index + 1} value`)}
              {operator === 'between' ? valueInput(`conditions.${index}.valueTo`, `Condition ${index + 1} upper value`) : <span className="hidden sm:block" />}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove condition ${index + 1}`}
                disabled={fields.length === 1}
                onClick={() => remove(index)}
                className="justify-self-end"
              >
                <Trash2 />
              </Button>
              {meta.hint ? <p className="text-xs text-muted-foreground sm:col-span-5">{meta.hint}</p> : null}
            </div>
          </div>
        );
      })}
      {rootError ? <p className="text-xs font-medium text-destructive-fg">{rootError}</p> : null}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={fields.length >= 10} onClick={() => append({ metric: 'spend', operator: 'gt', value: '' })}>
          <Plus />
          Add condition
        </Button>
      </div>
    </div>
  );
}
