import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/app-config';

/**
 * Cookie layout:
 *  - access  (`__Host-ap_at`): short-lived JWT, HttpOnly, SameSite=Lax, path "/".
 *  - refresh (`__Secure-ap_rt`): opaque rotating token, HttpOnly, SameSite=Strict, path "/api/auth".
 *  - csrf    (`__Host-ap_csrf`): readable by JS (double-submit token), SameSite=Strict.
 * The `__Host-`/`__Secure-` prefixes are only used when cookies are Secure (production / HTTPS).
 */
export function cookieNames(config: AppConfig) {
  const secure = config.env.COOKIE_SECURE;
  const hostPrefix = secure && !config.env.COOKIE_DOMAIN ? '__Host-' : '';
  const securePrefix = secure ? '__Secure-' : '';
  return {
    access: `${hostPrefix}ap_at`,
    refresh: `${securePrefix}ap_rt`,
    csrf: `${hostPrefix}ap_csrf`,
  };
}

function base(config: AppConfig): CookieOptions {
  return {
    secure: config.env.COOKIE_SECURE,
    domain: config.env.COOKIE_DOMAIN || undefined,
  };
}

export function setAccessCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(cookieNames(config).access, token, {
    ...base(config),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.env.ACCESS_TOKEN_TTL_MINUTES * 60 * 1000,
  });
}

export function setRefreshCookie(res: Response, config: AppConfig, token: string, expiresAt: Date): void {
  res.cookie(cookieNames(config).refresh, token, {
    ...base(config),
    httpOnly: true,
    sameSite: 'strict',
    path: '/api/auth',
    expires: expiresAt,
  });
}

export function setCsrfCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(cookieNames(config).csrf, token, {
    ...base(config),
    httpOnly: false,
    sameSite: 'strict',
    path: '/',
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  const names = cookieNames(config);
  res.clearCookie(names.access, { ...base(config), path: '/' });
  res.clearCookie(names.refresh, { ...base(config), path: '/api/auth' });
}
