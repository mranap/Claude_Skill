/**
 * Replaces the query string without a server round trip. Every page is rendered dynamically (the CSP
 * nonce), so `router.replace` would refetch the page from the server for each filter or tab change; Next.js
 * keeps `useSearchParams` in sync with native history calls instead.
 */
export function replaceQuery(pathname: string, params: URLSearchParams | string): void {
  const qs = typeof params === 'string' ? params : params.toString();
  window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
}
