import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@adpilot/shared';
import type { AuthUser } from '../../modules/auth/auth.types';

export const IS_PUBLIC = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';
export const ANY_PERMISSION_KEY = 'auth:anyPermission';
export const ALLOW_PENDING_PASSWORD_CHANGE = 'auth:allowPendingPasswordChange';
export const SKIP_CSRF = 'auth:skipCsrf';
export const RATE_LIMIT = 'http:rateLimit';

/** Route does not require an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires all listed permissions (SUPER_ADMIN always passes). */
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Route requires at least one of the listed permissions (read access shared by several features). */
export const RequireAnyPermission = (...permissions: readonly PermissionKey[]) => SetMetadata(ANY_PERMISSION_KEY, permissions);

/** Route stays reachable while the user must change the password set by an administrator. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

/** Route authenticates requests by other means (e.g. Telegram webhook secret header). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export interface RateLimitOptions {
  /** Bucket name, e.g. "upload". */
  bucket: string;
  limit: number;
  windowSeconds: number;
  /** Rate-limit per authenticated user (default) or per IP address. */
  by?: 'user' | 'ip';
}
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT, opts);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});
