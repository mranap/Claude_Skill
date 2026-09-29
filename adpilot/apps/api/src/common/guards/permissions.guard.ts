import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionKey, SYSTEM_ROLES, hasPermission } from '@adpilot/shared';
import { ANY_PERMISSION_KEY, PERMISSIONS_KEY } from '../decorators/auth.decorators';
import { AppError } from '../errors/app-error';
import { SettingsService } from '../../modules/settings/settings.service';
import type { AuthUser } from '../../modules/auth/auth.types';

/**
 * Enforces `@RequirePermissions(...)` (all of) and `@RequireAnyPermission(...)` (at least one of). Admin
 * permissions additionally require 2FA when the Super Admin enabled "Require 2FA for administrators".
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_KEY, targets);
    const anyOf = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(ANY_PERMISSION_KEY, targets);
    if (!required?.length && !anyOf?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new AppError('UNAUTHORIZED', 'Please sign in to continue');
    if (anyOf?.length && !anyOf.some((p) => hasPermission(user.roleKey, user.permissions, p)))
      throw AppError.forbidden();
    if (!required?.length) return true;
    if (!hasPermission(user.roleKey, user.permissions, required)) throw AppError.forbidden();

    if (required.some((p) => p.startsWith('admin.'))) {
      const security = await this.settings.get('security');
      if (security.require2faForAdmins && !user.twoFactorEnabled) {
        throw AppError.forbidden(
          'Enable two-factor authentication in Settings → Security to use admin features',
        );
      }
    }
    return true;
  }
}

export function isSuperAdmin(user: AuthUser): boolean {
  return user.roleKey === SYSTEM_ROLES.SUPER_ADMIN;
}
