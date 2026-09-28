import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content Security Policy with a nonce (Next.js "proxy", formerly middleware).
 *
 * Scripts only run when they carry this request's nonce ('strict-dynamic' then trusts the chunks they
 * load); Next.js reads the nonce from the request's CSP header and adds it to its own framework and inline
 * RSC scripts, and the root layout passes it to next-themes for the no-flash theme script. React needs
 * `eval` in development only. Styles keep 'unsafe-inline' because inline `style` attributes (Radix
 * positioning, progress bars) cannot carry a nonce.
 */
export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Every page; not the API (proxied to the backend), static assets or router prefetches.
      source: '/((?!api/|_next/static|_next/image|favicon.ico|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
