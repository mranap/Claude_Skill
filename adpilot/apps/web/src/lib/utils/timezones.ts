const FALLBACK_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Kyiv',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

let cached: string[] | null = null;

/** IANA time zones supported by the browser (`Intl.supportedValuesOf('timeZone')`), with UTC first. */
export function getTimeZones(): string[] {
  if (cached) return cached;
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = FALLBACK_ZONES;
  }
  cached = ['UTC', ...zones.filter((z) => z !== 'UTC' && z !== 'Etc/UTC')];
  return cached;
}

/** "GMT+02:00" for the given zone at the given instant. */
export function timeZoneOffset(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(
      at,
    );
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return name === 'GMT' ? 'GMT+00:00' : name;
  } catch {
    return '';
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
