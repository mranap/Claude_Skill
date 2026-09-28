import path from 'node:path';
import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
/** Where the Next.js server forwards `/api/*` when no reverse proxy sits in front of it (development). */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const monorepoRoot = path.join(__dirname, '../..');

/**
 * The Content-Security-Policy is set per request by `src/proxy.ts` (it carries a fresh script nonce).
 * One-time tokens travel in URL fragments and the Referer header is never sent (`no-referrer`).
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Monorepo: trace and resolve workspace packages (@adpilot/shared) from the repository root.
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  allowedDevOrigins: ['127.0.0.1'],
  // Do not let `next dev` write AGENTS.md / CLAUDE.md into the app folder.
  agentRules: false,
  devIndicators: { position: 'bottom-right' },

  async headers() {
    return [{ source: '/((?!api/).*)', headers: securityHeaders }];
  },

  async redirects() {
    return [
      { source: '/', destination: '/dashboard', permanent: false },
      { source: '/settings', destination: '/settings/profile', permanent: false },
      { source: '/admin/settings', destination: '/admin/settings/general', permanent: false },
      // Launch notifications from the API link to /launch/jobs/:id.
      { source: '/launch/jobs/:id', destination: '/launches/:id', permanent: false },
    ];
  },

  async rewrites() {
    // Production runs behind a reverse proxy (Caddy) that serves /api from the API container.
    if (!isDev && !process.env.API_INTERNAL_URL) return [];
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
