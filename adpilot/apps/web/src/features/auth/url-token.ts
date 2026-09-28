'use client';

import { useSyncExternalStore } from 'react';

/**
 * One-time tokens (password reset, invitation, e-mail confirmation) arrive in the URL fragment
 * (`#token=…`), which browsers never send to servers or in the Referer header. `?token=` is still accepted
 * for older links. The token is kept in memory and removed from the address bar right after the page
 * mounts, so it does not stay in the history or leak through screenshots.
 */
let captured: string | null = null;

function tokenFromUrl(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
  return fromHash ?? new URLSearchParams(window.location.search).get('token');
}

function readToken(): string | null {
  const token = tokenFromUrl();
  if (token) captured = token;
  return captured;
}

function stripToken(): void {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  if (!hash.has('token') && !query.has('token')) return;
  hash.delete('token');
  query.delete('token');
  const qs = query.toString();
  const fragment = hash.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${fragment ? `#${fragment}` : ''}`);
}

function subscribe(): () => void {
  // Runs after hydration: the token was captured by the first client render, now drop it from the URL.
  stripToken();
  return () => undefined;
}

/** The one-time token of the current page: `undefined` while server rendering, `null` when absent. */
export function useUrlToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, readToken, () => undefined);
}

/** Forget the token once it has been used. */
export function forgetUrlToken(): void {
  captured = null;
}
