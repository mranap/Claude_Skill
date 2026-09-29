'use client';

import {
  goalRule,
  objectiveRule,
  templateSettingsSchema,
  type GoalRule,
  type Objective,
  type variantSchema,
} from '@adpilot/shared';
import { createContext, useContext } from 'react';
import type * as React from 'react';
import { useFormContext, useWatch, type FieldPath, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';

export type SettingsInput = z.input<typeof templateSettingsSchema>;
export type SettingsOutput = z.output<typeof templateSettingsSchema>;
export type VariantInput = z.input<typeof variantSchema>;

/** Shape shared by the template editor and the launch wizard forms. */
export interface SettingsFormValues {
  settings: SettingsInput;
  variants: VariantInput[];
}

export type SettingsPath = FieldPath<SettingsFormValues>;

export interface SettingsUi {
  mode: 'template' | 'launch';
  /** Show the advanced fields (templates have a Basic/Advanced switch; the wizard always shows them). */
  advanced: boolean;
  /** Ad account currency (launch wizard); templates are currency-less. */
  currency?: string;
  /** Minimum daily budget of the ad account, in major units. */
  minDailyBudget?: string | null;
  /** Ad account whose pages, pixels and audiences are offered in pickers. */
  assetsAccountId?: string | null;
  disabled?: boolean;
}

const SettingsUiContext = createContext<SettingsUi>({ mode: 'template', advanced: true });

export function SettingsUiProvider({ value, children }: { value: SettingsUi; children: React.ReactNode }) {
  return <SettingsUiContext.Provider value={value}>{children}</SettingsUiContext.Provider>;
}

export function useSettingsUi(): SettingsUi {
  return useContext(SettingsUiContext);
}

export function useSettingsForm(): UseFormReturn<SettingsFormValues> {
  return useFormContext<SettingsFormValues>();
}

/** Watches the objective/destination/goal triple and resolves the matching rules. */
export function useGoal(): {
  objective: Objective;
  destination: string;
  goal: string;
  rule: GoalRule | undefined;
} {
  const { control } = useSettingsForm();
  const [objective, destination, goal] = useWatch({
    control,
    name: ['settings.objective', 'settings.destination', 'settings.optimizationGoal'],
  }) as [Objective, string, string];
  return { objective, destination, goal, rule: goalRule(objective, destination, goal) };
}

/** Complete settings for a new template/launch (every nested default comes from the shared schema). */
export function defaultSettings(): SettingsInput {
  const objective = 'OUTCOME_LEADS';
  const destination = objectiveRule(objective)!.destinations[0]!;
  const goal = destination.goals[0]!;
  return templateSettingsSchema.parse({
    objective,
    destination: destination.destination,
    optimizationGoal: goal.goal,
    billingEvent: goal.billingEvents[0],
    budget: { amount: '20' },
  });
}

let variantCounter = 0;

export function newKey(prefix: string): string {
  variantCounter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${variantCounter}`;
}

export function newVariant(index: number, countries: string[] = []): VariantInput {
  return { key: newKey('g'), label: `Group ${index + 1}`, countries, locales: [], ads: [] };
}

/** Removes empty strings recursively so optional zod fields receive `undefined` (RHF inputs produce ''). */
export function stripEmpty<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripEmpty) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === '' || v === null || v === undefined) continue;
      out[k] = stripEmpty(v);
    }
    return out as T;
  }
  return value;
}
