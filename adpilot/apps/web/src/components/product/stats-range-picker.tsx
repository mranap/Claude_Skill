'use client';

import { DATE_RANGE_KEYS, DATE_RANGE_LABELS, type DateRangeKey } from '@adpilot/shared';
import { format } from 'date-fns';
import {
  DateRangePicker,
  resolvePreset,
  type DateRangePreset,
  type DateRangeValue,
} from '@/components/shared/date-range-picker';

/**
 * Statistics date range as the API takes it: a range key evaluated by the server in each ad account's own
 * time zone ("Today" in Warsaw is not "Today" in New York), or custom YYYY-MM-DD dates.
 */
export interface StatsRange {
  range: DateRangeKey;
  from?: string;
  to?: string;
}

type PresetKey = Exclude<DateRangeKey, 'custom'>;
type PickerPreset = Exclude<DateRangePreset, 'custom'>;

const TO_PICKER: Record<PresetKey, PickerPreset> = {
  today: 'today',
  yesterday: 'yesterday',
  last_3d: 'last3',
  last_7d: 'last7',
  last_14d: 'last14',
  last_30d: 'last30',
};
const FROM_PICKER = Object.fromEntries(Object.entries(TO_PICKER).map(([key, preset]) => [preset, key])) as Record<PickerPreset, PresetKey>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseStatsRange(range: string | null | undefined, from: string | null | undefined, to: string | null | undefined, fallback: PresetKey): StatsRange {
  const key = (DATE_RANGE_KEYS as readonly string[]).includes(range ?? '') ? (range as DateRangeKey) : fallback;
  if (key !== 'custom') return { range: key };
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) return { range: 'custom', from, to };
  return { range: fallback };
}

/** Query parameters for the statistics endpoints. */
export function statsRangeParams(value: StatsRange): Record<string, string> {
  return value.range === 'custom' && value.from && value.to ? { range: 'custom', from: value.from, to: value.to } : { range: value.range };
}

/** URL filter patch (clears from/to for presets). */
export function statsRangePatch(value: StatsRange): Record<string, string | undefined> {
  return { range: value.range, from: value.range === 'custom' ? value.from : undefined, to: value.range === 'custom' ? value.to : undefined };
}

export function statsRangeLabel(value: StatsRange): string {
  if (value.range === 'custom' && value.from && value.to) return value.from === value.to ? value.from : `${value.from} – ${value.to}`;
  return DATE_RANGE_LABELS[value.range];
}

function toPickerValue(value: StatsRange): DateRangeValue {
  if (value.range === 'custom' && value.from && value.to) {
    return { preset: 'custom', from: new Date(`${value.from}T00:00:00`), to: new Date(`${value.to}T23:59:59`) };
  }
  const preset = TO_PICKER[value.range as PresetKey] ?? 'today';
  return { preset, ...resolvePreset(preset) };
}

export function StatsRangePicker({
  value,
  onChange,
  className,
  align = 'start',
}: {
  value: StatsRange;
  onChange: (value: StatsRange) => void;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <DateRangePicker
      value={toPickerValue(value)}
      allowClear={false}
      align={align}
      className={className}
      onChange={(next) => {
        if (!next) return;
        if (next.preset === 'custom') onChange({ range: 'custom', from: format(next.from, 'yyyy-MM-dd'), to: format(next.to, 'yyyy-MM-dd') });
        else onChange({ range: FROM_PICKER[next.preset] });
      }}
    />
  );
}
