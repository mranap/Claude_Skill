'use client';

import {
  BID_STRATEGIES,
  BID_STRATEGY_LABELS,
  OBJECTIVE_RULES,
  SPECIAL_AD_CATEGORIES,
  SPECIAL_AD_CATEGORY_LABELS,
  objectiveRule,
  type BidStrategy,
  type GoalRule,
  type Objective,
} from '@adpilot/shared';
import { Eye, Heart, MousePointerClick, ShoppingBag, UserPlus } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { MultiCombobox } from '@/components/ui/multi-combobox';
import { FormField } from '@/components/shared/form';
import { countryOptions } from '@/lib/utils/countries';
import { formatAmount } from '@/lib/utils/money';
import { useGoal, useSettingsForm, useSettingsUi } from './context';
import { AmountInput, CheckboxGroup, OptionalInput, SelectInput, SettingsSection } from './fields';

const OBJECTIVE_ICONS: Record<Objective, React.ReactNode> = {
  OUTCOME_LEADS: <UserPlus />,
  OUTCOME_SALES: <ShoppingBag />,
  OUTCOME_TRAFFIC: <MousePointerClick />,
  OUTCOME_AWARENESS: <Eye />,
  OUTCOME_ENGAGEMENT: <Heart />,
};

const PROMOTED: Record<GoalRule['promotedObject'], string | undefined> = {
  NONE: undefined,
  PIXEL_EVENT: 'Needs a Pixel and a conversion event',
  PAGE: 'Uses the Facebook Page',
};

/** Objective → conversion location → optimization goal → billing event (only valid combinations). */
export function CampaignSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const { objective, destination, rule } = useGoal();
  const special = useWatch({ control: form.control, name: 'settings.specialAdCategories' }) ?? [];
  const objRule = objectiveRule(objective);
  const destRule = objRule?.destinations.find((d) => d.destination === destination);
  const set = form.setValue;
  const opts = { shouldDirty: true, shouldValidate: form.formState.isSubmitted } as const;

  const applyGoal = (goal: GoalRule) => {
    set('settings.optimizationGoal', goal.goal, opts);
    const billing = form.getValues('settings.billingEvent');
    set(
      'settings.billingEvent',
      billing && goal.billingEvents.includes(billing) ? billing : goal.billingEvents[0]!,
      opts,
    );
    if (goal.requiresVideo) set('settings.creative.format', 'SINGLE_VIDEO', opts);
    if (
      goal.goal !== 'VALUE' &&
      form.getValues('settings.budget.bidStrategy') === 'LOWEST_COST_WITH_MIN_ROAS'
    ) {
      set('settings.budget.bidStrategy', 'LOWEST_COST_WITHOUT_CAP', opts);
      set('settings.budget.roasFloor', undefined, opts);
    }
  };
  const applyDestination = (objectiveKey: Objective, dest: string) => {
    const d = objectiveRule(objectiveKey)?.destinations.find((x) => x.destination === dest);
    if (!d) return;
    set('settings.destination', d.destination, opts);
    const current = form.getValues('settings.optimizationGoal');
    applyGoal(d.goals.find((g) => g.goal === current) ?? d.goals[0]!);
  };
  const applyObjective = (next: Objective) => {
    const r = objectiveRule(next);
    if (!r) return;
    set('settings.objective', next, opts);
    const d = r.destinations.find((x) => x.destination === destination) ?? r.destinations[0]!;
    applyDestination(next, d.destination);
  };

  return (
    <SettingsSection
      id="campaign"
      title="Campaign"
      description="What you want to achieve. Only combinations Meta supports for this objective are offered."
    >
      <FormField
        control={form.control}
        name="settings.objective"
        label="Objective"
        render={({ field }) => (
          <RadioGroup
            value={field.value}
            onValueChange={(v) => applyObjective(v as Objective)}
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
            disabled={ui.disabled}
            aria-label="Objective"
          >
            {OBJECTIVE_RULES.map((o) => (
              <RadioCard
                key={o.objective}
                value={o.objective}
                title={o.label}
                description={o.description}
                icon={OBJECTIVE_ICONS[o.objective]}
              />
            ))}
          </RadioGroup>
        )}
      />
      {objRule && objRule.destinations.length > 1 ? (
        <FormField
          control={form.control}
          name="settings.destination"
          label="Conversion location"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(v) => applyDestination(objective, v)}
              className="grid gap-2 sm:grid-cols-2"
              disabled={ui.disabled}
              aria-label="Conversion location"
            >
              {objRule.destinations.map((d) => (
                <RadioCard
                  key={d.destination}
                  value={d.destination}
                  title={d.label}
                  description={d.description}
                />
              ))}
            </RadioGroup>
          )}
        />
      ) : destRule ? (
        <p className="text-sm text-muted-foreground">
          Conversion location: <span className="font-medium text-foreground">{destRule.label}</span> —{' '}
          {destRule.description}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="settings.optimizationGoal"
          label="Optimization goal"
          description={rule ? PROMOTED[rule.promotedObject] : undefined}
          render={({ field, controlProps }) => (
            <SelectInput
              controlProps={controlProps}
              value={field.value}
              disabled={ui.disabled}
              onChange={(v) => {
                const g = destRule?.goals.find((x) => x.goal === v);
                if (g) applyGoal(g);
              }}
              options={(destRule?.goals ?? []).map((g) => ({
                value: g.goal,
                label: g.label,
                description: PROMOTED[g.promotedObject],
              }))}
            />
          )}
        />
        <FormField
          control={form.control}
          name="settings.billingEvent"
          label="Charged for"
          description={
            rule && rule.billingEvents.length === 1 ? 'The only billing event for this goal.' : undefined
          }
          render={({ field, controlProps }) => (
            <SelectInput
              controlProps={controlProps}
              value={field.value}
              onChange={field.onChange}
              disabled={ui.disabled || (rule?.billingEvents.length ?? 0) <= 1}
              options={(rule?.billingEvents ?? []).map((b) => ({
                value: b,
                label:
                  b === 'IMPRESSIONS'
                    ? 'Impressions'
                    : b === 'LINK_CLICKS'
                      ? 'Link clicks (CPC)'
                      : 'ThruPlay',
              }))}
            />
          )}
        />
      </div>
      {ui.advanced ? (
        <>
          <FormField
            control={form.control}
            name="settings.specialAdCategories"
            label="Special ad categories"
            description="Required by Meta for credit, employment, housing, social issues/politics and gambling ads. They restrict targeting."
            render={({ field }) => (
              <CheckboxGroup
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={ui.disabled}
                options={SPECIAL_AD_CATEGORIES.map((c) => ({
                  value: c,
                  label: SPECIAL_AD_CATEGORY_LABELS[c],
                }))}
              />
            )}
          />
          {special.length ? (
            <FormField
              control={form.control}
              name="settings.specialAdCategoryCountries"
              label="Special ad category countries"
              description="Countries where the category applies. Empty = the targeted countries."
              render={({ field, controlProps }) => (
                <MultiCombobox
                  {...controlProps}
                  value={field.value ?? []}
                  onValueChange={field.onChange}
                  options={countryOptions().map((c) => ({ value: c.code, label: c.name, hint: c.code }))}
                  placeholder="Targeted countries"
                  addLabel="Add country"
                  searchPlaceholder="Search countries"
                  chipLabel={(o) => o.value}
                  disabled={ui.disabled}
                />
              )}
            />
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  );
}

export function BudgetSection() {
  const form = useSettingsForm();
  const ui = useSettingsUi();
  const { goal } = useGoal();
  const [level, type, strategy] = useWatch({
    control: form.control,
    name: ['settings.budget.level', 'settings.budget.type', 'settings.budget.bidStrategy'],
  });

  return (
    <SettingsSection
      id="budget"
      title="Budget & bidding"
      description={
        ui.currency
          ? `Amounts are in ${ui.currency}, the ad account currency.`
          : 'Amounts are in the currency of the ad account chosen at launch.'
      }
    >
      <FormField
        control={form.control}
        name="settings.budget.level"
        label="Where the budget is set"
        render={({ field }) => (
          <RadioGroup
            value={field.value}
            onValueChange={field.onChange}
            className="grid gap-2 sm:grid-cols-2"
            disabled={ui.disabled}
            aria-label="Budget level"
          >
            <RadioCard
              value="ADSET"
              title="Ad set budget"
              description="Each language/geo group gets its own budget. Best for strict per-country spend."
            />
            <RadioCard
              value="CAMPAIGN"
              title="Advantage campaign budget"
              description="One campaign budget; Meta distributes it across the ad sets."
            />
          </RadioGroup>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <FormField
          control={form.control}
          name="settings.budget.type"
          label="Budget type"
          render={({ field }) => (
            <SegmentedControl
              aria-label="Budget type"
              value={field.value ?? 'DAILY'}
              onValueChange={field.onChange}
              disabled={ui.disabled}
              options={[
                { value: 'DAILY', label: 'Daily' },
                { value: 'LIFETIME', label: 'Lifetime' },
              ]}
            />
          )}
        />
        <FormField
          control={form.control}
          name="settings.budget.amount"
          label={
            level === 'CAMPAIGN'
              ? `Campaign ${type === 'LIFETIME' ? 'lifetime' : 'daily'} budget`
              : `${type === 'LIFETIME' ? 'Lifetime' : 'Daily'} budget per ad set`
          }
          required
          description={
            [
              level === 'ADSET' ? 'Default for every group; a group can override it.' : null,
              ui.minDailyBudget && type !== 'LIFETIME'
                ? `Minimum for this account: ${formatAmount(ui.minDailyBudget, ui.currency)}.`
                : null,
              type === 'LIFETIME' ? 'A lifetime budget needs an end date.' : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          render={({ field, controlProps }) => (
            <AmountInput
              controlProps={controlProps}
              value={field.value}
              onChange={(v) => field.onChange(v ?? '')}
              currency={ui.currency}
              placeholder="20.00"
              disabled={ui.disabled}
            />
          )}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="settings.budget.bidStrategy"
          label="Bid strategy"
          render={({ field, controlProps }) => (
            <SelectInput
              controlProps={controlProps}
              value={field.value}
              disabled={ui.disabled}
              onChange={(v) => {
                field.onChange(v as BidStrategy);
                if (v !== 'COST_CAP' && v !== 'LOWEST_COST_WITH_BID_CAP')
                  form.setValue('settings.budget.bidAmount', undefined, { shouldDirty: true });
                if (v !== 'LOWEST_COST_WITH_MIN_ROAS')
                  form.setValue('settings.budget.roasFloor', undefined, { shouldDirty: true });
              }}
              options={BID_STRATEGIES.map((b) => ({
                value: b,
                label: BID_STRATEGY_LABELS[b].label,
                description:
                  b === 'LOWEST_COST_WITH_MIN_ROAS' && goal !== 'VALUE'
                    ? 'Requires the “Maximise value of conversions” goal'
                    : BID_STRATEGY_LABELS[b].description,
                disabled: b === 'LOWEST_COST_WITH_MIN_ROAS' && goal !== 'VALUE',
              }))}
            />
          )}
        />
        {strategy === 'COST_CAP' || strategy === 'LOWEST_COST_WITH_BID_CAP' ? (
          <FormField
            control={form.control}
            name="settings.budget.bidAmount"
            label={strategy === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap'}
            required
            render={({ field, controlProps }) => (
              <AmountInput
                controlProps={controlProps}
                value={field.value}
                onChange={field.onChange}
                currency={ui.currency}
                optional
                placeholder="5.00"
                disabled={ui.disabled}
              />
            )}
          />
        ) : null}
        {strategy === 'LOWEST_COST_WITH_MIN_ROAS' ? (
          <FormField
            control={form.control}
            name="settings.budget.roasFloor"
            label="Minimum ROAS"
            required
            description="1.5 means 150 % (1.50 of purchase value per 1.00 spent). 0.01–1000."
            render={({ field, controlProps }) => (
              <OptionalInput
                controlProps={controlProps}
                value={field.value}
                onChange={field.onChange}
                inputMode="decimal"
                placeholder="1.5"
                disabled={ui.disabled}
              />
            )}
          />
        ) : null}
      </div>
      {ui.advanced ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="settings.budget.spendCap"
            label="Campaign spend limit"
            description="Optional. Delivery stops when the campaign has spent this amount in total."
            render={({ field, controlProps }) => (
              <AmountInput
                controlProps={controlProps}
                value={field.value}
                onChange={field.onChange}
                currency={ui.currency}
                optional
                placeholder="No limit"
                disabled={ui.disabled}
              />
            )}
          />
          {level === 'ADSET' ? (
            <FormField
              control={form.control}
              name="settings.budget.budgetSharing"
              orientation="horizontal"
              label="Budget sharing"
              description="Let ad sets share up to 20 % of their budget with other ad sets of the campaign."
              render={({ field, controlProps }) => (
                <Switch
                  {...controlProps}
                  checked={!!field.value}
                  onCheckedChange={field.onChange}
                  disabled={ui.disabled}
                />
              )}
            />
          ) : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}
