import { z } from 'zod';
import { PROXY_TYPES } from '../enums';
import { paginationQuerySchema } from './common';

const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.\-:[\]]+$/, 'Enter a hostname or IP address');

/** Proxy used as network route for one Meta profile. `null` = direct connection. */
export const proxyInputSchema = z.object({
  type: z.enum(PROXY_TYPES),
  host: hostSchema,
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().max(255).optional().nullable(),
  /** undefined → keep the stored password (updates), null/'' → no password, string → set. */
  password: z.string().max(255).optional().nullable(),
});
export type ProxyInput = z.infer<typeof proxyInputSchema>;

export const accessTokenSchema = z
  .string()
  .trim()
  .min(20, 'The access token looks too short')
  .max(1024)
  .regex(/^[A-Za-z0-9_|.-]+$/, 'The access token contains invalid characters');

export const metaAppIdSchema = z.string().trim().regex(/^\d{5,20}$/, 'App ID must be numeric');

export const metaProfileCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  accessToken: accessTokenSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
  proxy: proxyInputSchema.nullable().optional(),
  /** Optional app credentials of the token's app: enable appsecret_proof and precise token debugging. */
  appId: metaAppIdSchema.optional().nullable(),
  appSecret: z.string().trim().regex(/^[a-f0-9]{32}$/i, 'App secret is a 32 character hex string').optional().nullable(),
});

export const metaProfileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  /** Omit to keep the current token. */
  accessToken: accessTokenSchema.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** undefined → keep, null → remove proxy, object → set/replace. */
  proxy: proxyInputSchema.nullable().optional(),
  appId: metaAppIdSchema.optional().nullable(),
  appSecret: z.string().trim().regex(/^[a-f0-9]{32}$/i, 'App secret is a 32 character hex string').optional().nullable(),
  isEnabled: z.boolean().optional(),
});

/** Test a token / proxy before saving (nothing is stored). */
export const metaConnectionTestSchema = z.object({
  accessToken: accessTokenSchema.optional(),
  proxy: proxyInputSchema.nullable().optional(),
  appId: metaAppIdSchema.optional().nullable(),
  appSecret: z.string().trim().regex(/^[a-f0-9]{32}$/i).optional().nullable(),
});

export const adAccountListQuerySchema = paginationQuerySchema.extend({
  profileId: z.uuid().optional(),
  status: z.string().max(40).optional(),
  connected: z
    .enum(['true', 'false', 'all'])
    .optional()
    .default('true'),
});

export const adAccountUpdateSchema = z.object({
  isConnected: z.boolean().optional(),
  statusCheckIntervalMinutes: z.number().int().min(15).max(10080).optional(),
  statsSyncEnabled: z.boolean().optional(),
  statsSyncIntervalMinutes: z.number().int().min(1).max(1440).optional(),
});

export const adAccountBulkConnectSchema = z.object({
  profileId: z.uuid(),
  connect: z.array(z.string().regex(/^\d+$/)).max(500).default([]),
  disconnect: z.array(z.string().regex(/^\d+$/)).max(500).default([]),
});

/** Required and optional Meta permissions (see docs/META_API.md for what stops working without each). */
export const META_REQUIRED_PERMISSIONS = ['ads_management', 'ads_read'] as const;
export const META_RECOMMENDED_PERMISSIONS = ['business_management', 'pages_show_list', 'pages_read_engagement'] as const;
export const META_OPTIONAL_PERMISSIONS = ['pages_manage_ads', 'leads_retrieval', 'instagram_basic'] as const;

export interface TokenInspection {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'INVALID' | 'PERMISSION_REVOKED' | 'ERROR';
  message: string;
  metaUserId?: string;
  metaUserName?: string;
  tokenType?: 'USER' | 'SYSTEM_USER' | 'PAGE' | 'APP' | 'UNKNOWN';
  appId?: string;
  appName?: string;
  expiresAt?: string | null;
  dataAccessExpiresAt?: string | null;
  scopes: string[];
  missingRequired: string[];
  missingRecommended: string[];
  latencyMs?: number;
}

export interface ProxyTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  /** Public IP seen by Meta's edge (from a direct call through the proxy). */
  egressIp?: string;
}
