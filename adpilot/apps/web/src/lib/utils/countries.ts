import { COUNTRY_CODES, EU_COUNTRY_CODES } from '@adpilot/shared';

let regionNames: Intl.DisplayNames | null = null;
const cache = new Map<string, string>();

/** "PL" → "Poland" (Intl.DisplayNames; falls back to the code). */
export function countryName(code: string): string {
  const upper = code.toUpperCase();
  const cached = cache.get(upper);
  if (cached) return cached;
  let name = upper;
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    name = regionNames.of(upper) ?? upper;
  } catch {
    name = upper;
  }
  cache.set(upper, name);
  return name;
}

export interface CountryOption {
  code: string;
  name: string;
  eu: boolean;
}

let options: CountryOption[] | null = null;

/** Every country the Marketing API accepts, sorted by display name. */
export function countryOptions(): CountryOption[] {
  options ??= [...COUNTRY_CODES]
    .map((code) => ({ code, name: countryName(code), eu: (EU_COUNTRY_CODES as readonly string[]).includes(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return options;
}

/** "PL, DE, FR" or "Poland, Germany +3" for compact cells. */
export function describeCountries(codes: readonly string[], max = 3): string {
  if (!codes.length) return '—';
  if (codes.length <= max) return codes.join(', ');
  return `${codes.slice(0, max).join(', ')} +${codes.length - max}`;
}
