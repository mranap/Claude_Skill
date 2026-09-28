'use client';

import { useMemo } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { getTimeZones, timeZoneOffset } from '@/lib/utils/timezones';

/** Searchable IANA time-zone picker (`Intl.supportedValuesOf('timeZone')`) with UTC offsets. */
export function TimeZoneSelect({
  value,
  onValueChange,
  id,
  disabled,
  'aria-invalid': ariaInvalid,
}: {
  value: string | undefined | null;
  onValueChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}) {
  const options = useMemo<ComboboxOption[]>(() => {
    const now = new Date();
    const zones = getTimeZones();
    const list = value && !zones.includes(value) ? [value, ...zones] : zones;
    return list.map((tz) => ({
      value: tz,
      label: tz.replace(/_/g, ' '),
      hint: timeZoneOffset(tz, now).replace('GMT', 'UTC'),
    }));
  }, [value]);

  return (
    <Combobox
      id={id}
      value={value}
      onValueChange={onValueChange}
      options={options}
      disabled={disabled}
      aria-invalid={ariaInvalid}
      placeholder="Select a time zone"
      searchPlaceholder="Search time zones (e.g. Berlin, New York)…"
      emptyText="No time zone found"
      maxResults={600}
    />
  );
}
