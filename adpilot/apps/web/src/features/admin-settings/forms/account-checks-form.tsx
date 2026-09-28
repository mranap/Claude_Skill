'use client';

import { accountCheckSettingsSchema } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/shared/form';
import type { AdminSettingGroup } from '@/lib/api/types';
import { formatMinutes } from '@/lib/utils/format';
import { pickSchemaValues, useSaveSettings } from '../api';
import { managePermission } from '../categories';
import { SelectField } from '../fields';
import { FieldGrid, SettingsFormCard } from '../settings-form-card';

const schema = accountCheckSettingsSchema.refine(
  (v) => v.allowedIntervalsMinutes.includes(v.defaultIntervalMinutes),
  {
    path: ['defaultIntervalMinutes'],
    message: 'Pick one of the allowed intervals',
  },
);

const SUGGESTIONS = [30, 60, 120, 180, 360, 720, 1440, 2880, 10080];

function IntervalEditor({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const sorted = [...value].sort((a, b) => a - b);
  const add = (minutes: number) => {
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10080 || value.includes(minutes)) return;
    onChange([...value, minutes].sort((a, b) => a - b));
    setDraft('');
  };

  return (
    <div
      className={
        invalid
          ? 'grid gap-3 rounded-lg border border-destructive/60 p-3'
          : 'grid gap-3 rounded-lg border p-3'
      }
    >
      <div className="flex flex-wrap gap-2">
        {sorted.length ? (
          sorted.map((minutes) => (
            <Badge key={minutes} variant="secondary" className="h-7 gap-1.5 pr-1 pl-2.5 text-[13px]">
              {formatMinutes(minutes)}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((m) => m !== minutes))}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none"
                aria-label={`Remove ${formatMinutes(minutes)}`}
              >
                <X className="size-3.5" />
              </button>
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">No intervals — add at least one.</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-36">
          <Input
            type="number"
            min={15}
            max={10080}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(Number(draft));
              }
            }}
            placeholder="Minutes"
            className="h-8 pr-10"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            min
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !draft}
          onClick={() => add(Number(draft))}
        >
          <Plus />
          Add
        </Button>
        <span className="text-xs text-muted-foreground">Quick add:</span>
        {SUGGESTIONS.filter((m) => !value.includes(m))
          .slice(0, 4)
          .map((m) => (
            <Button
              key={m}
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={() => add(m)}
            >
              {formatMinutes(m)}
            </Button>
          ))}
      </div>
    </div>
  );
}

export function AccountChecksSettingsForm({
  values,
  readOnly,
}: {
  values: AdminSettingGroup<'accountChecks'>;
  readOnly: boolean;
}) {
  const save = useSaveSettings('accountChecks');
  const form = useForm({
    resolver: zodResolver(schema),
    values: pickSchemaValues(accountCheckSettingsSchema.shape, values),
  });
  const allowed = useWatch({ control: form.control, name: 'allowedIntervalsMinutes' }) ?? [];

  return (
    <SettingsFormCard
      title="Account checks"
      description="How often ad account status (active, disabled, unsettled…) is checked. Users choose from the allowed intervals."
      form={form}
      readOnly={readOnly}
      permission={managePermission('accountChecks')}
      onSubmit={(v) => save.mutateAsync({ values: v })}
    >
      <FormField
        control={form.control}
        name="allowedIntervalsMinutes"
        label="Allowed intervals"
        description="Between 15 minutes and 7 days."
        render={({ field, fieldState }) => (
          <IntervalEditor
            value={field.value ?? []}
            onChange={field.onChange}
            disabled={readOnly}
            invalid={!!fieldState.error}
          />
        )}
      />
      <FieldGrid>
        <SelectField
          control={form.control}
          name="defaultIntervalMinutes"
          label="Default interval"
          description="Applied to newly connected ad accounts."
          numeric
          options={[...allowed]
            .sort((a, b) => a - b)
            .map((m) => ({ value: String(m), label: formatMinutes(m) }))}
        />
      </FieldGrid>
    </SettingsFormCard>
  );
}
