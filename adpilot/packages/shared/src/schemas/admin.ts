import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth';
import { paginationQuerySchema } from './common';

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'BLOCKED', 'DELETED']).optional(),
  roleId: z.uuid().optional(),
});

export const adminCreateUserSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().max(100).optional(),
    roleId: z.uuid(),
    /** "invite": e-mail a one-time link to set the password; "password": set a temporary password. */
    mode: z.enum(['invite', 'password']),
    password: passwordSchema.optional(),
    timezone: z.string().trim().max(64).optional(),
  })
  .refine((v) => v.mode === 'invite' || !!v.password, { message: 'Password is required', path: ['password'] });

export const adminUpdateUserSchema = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  roleId: z.uuid().optional(),
  timezone: z.string().trim().max(64).optional(),
  storageQuotaMb: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

export const adminBlockUserSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const adminResetPasswordSchema = z
  .object({
    mode: z.enum(['link', 'password']),
    password: passwordSchema.optional(),
  })
  .refine((v) => v.mode === 'link' || !!v.password, { message: 'Password is required', path: ['password'] });

export const roleKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use UPPER_CASE letters, digits and _');

export const roleCreateSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string().max(80)).max(200),
});

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.string().max(80)).max(200).optional(),
});

export const broadcastSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  channels: z.array(z.enum(['EMAIL', 'TELEGRAM'])).max(2),
  inApp: z.boolean().default(true),
  audience: z.enum(['ALL', 'SELECTED']),
  userIds: z.array(z.uuid()).max(10000).default([]),
});

export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorUserId: z.uuid().optional(),
  subjectUserId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const logsQuerySchema = paginationQuerySchema.extend({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  source: z.string().trim().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const metaApiLogsQuerySchema = paginationQuerySchema.extend({
  userId: z.uuid().optional(),
  onlyErrors: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  category: z.string().trim().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
