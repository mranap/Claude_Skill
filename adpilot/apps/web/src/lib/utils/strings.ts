/** "PARTIAL_FAILURE" → "Partial failure", "admin.user.created" → "Admin user created". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const text = value
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Two-letter avatar initials from a name, falling back to the e-mail address. */
export function initials(name: string | null | undefined, email?: string | null): string {
  const source = (name ?? '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
    return (first + last).toUpperCase();
  }
  const local = (email ?? '?').split('@')[0] ?? '?';
  return local.slice(0, 2).toUpperCase();
}

/** "9363decd-ac05-…-49fd701b31ce" → "9363decd…1b31ce". */
export function shortId(id: string | null | undefined, head = 8, tail = 4): string {
  if (!id) return '—';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Only allow in-app paths (and https links) as navigation targets coming from data. */
export function safeHref(link: string | null | undefined): { href: string; external: boolean } | null {
  if (!link) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return { href: link, external: false };
  try {
    const url = new URL(link);
    if (url.protocol === 'https:') return { href: url.toString(), external: true };
  } catch {
    // not a URL
  }
  return null;
}

const PARSE_BASE = 'http://x.invalid';

/**
 * Sanitises the `?next=` parameter used after sign-in: only same-origin paths are returned.
 * Control characters and backslashes are rejected outright — URL parsing strips tab/CR/LF and treats `\`
 * like `/`, so `/\t/evil.com` or `/\evil.com` would otherwise become the protocol-relative `//evil.com`.
 * The result is the pathname + search + hash of the *parsed* URL, i.e. exactly what the router navigates to.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/')) return fallback;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be rejected
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, PARSE_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== PARSE_BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  if (/^\/(login|forgot-password|reset-password|confirm-email)(\/|$)/.test(url.pathname)) return fallback;
  return path;
}
