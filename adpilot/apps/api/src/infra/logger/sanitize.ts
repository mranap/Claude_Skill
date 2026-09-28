/**
 * Removes secrets from arbitrary data before it is logged or persisted (audit log metadata,
 * Meta API logs, job payload snapshots). Matching is done on key names and on value shapes
 * (Meta access tokens, bearer tokens, URLs with credentials or access_token query params).
 */
const SECRET_KEY_PATTERN =
  /pass(word)?|secret|token|authorization|cookie|appsecret|api[_-]?key|private[_-]?key|credential|signature|otp|recovery/i;
const META_TOKEN_PATTERN = /\bEA[A-Za-z0-9]{20,}\b/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi;
const ACCESS_TOKEN_QS_PATTERN = /(access_token|appsecret_proof|input_token|client_secret|fb_exchange_token|token)=([^&\s"']+)/gi;
const URL_CREDENTIALS_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi;

export const REDACTED = '[REDACTED]';

export function sanitizeString(value: string): string {
  return value
    .replace(META_TOKEN_PATTERN, (m) => `${m.slice(0, 4)}…${REDACTED}`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(ACCESS_TOKEN_QS_PATTERN, (_m, k: string) => `${k}=${REDACTED}`)
    .replace(URL_CREDENTIALS_PATTERN, (_m, scheme: string) => `${scheme}${REDACTED}@`);
}

export function sanitize<T>(value: T, depth = 0): T {
  if (depth > 12) return '[TRUNCATED]' as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value) as unknown as T;
  if (typeof value === 'bigint') return value.toString() as unknown as T;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]` as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k) && !/^(token(Mask|Type|Expires|Scopes|Fingerprint)|tokenMask)/.test(k)) {
      out[k] = v === null || v === undefined || v === '' ? v : REDACTED;
    } else {
      out[k] = sanitize(v, depth + 1);
    }
  }
  return out as T;
}

/** Masks a secret for display: first 4 and last 3 characters, e.g. `EAAB************7ds`. */
export function maskSecret(secret: string, head = 4, tail = 3): string {
  if (!secret) return '';
  if (secret.length <= head + tail) return '*'.repeat(secret.length);
  return `${secret.slice(0, head)}${'*'.repeat(12)}${secret.slice(-tail)}`;
}
