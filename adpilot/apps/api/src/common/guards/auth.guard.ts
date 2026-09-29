import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SYSTEM_ROLES, isAdminRole } from '@adpilot/shared';
import { AppConfig } from '../../config/app-config';
import { ALLOW_PENDING_PASSWORD_CHANGE, IS_PUBLIC } from '../decorators/auth.decorators';
import { AppError } from '../errors/app-error';
import { RequestContext } from '../context/request-context';
import { SessionService } from '../../modules/auth/session.service';
import { AuthCacheService } from '../../modules/auth/auth-cache.service';
import { cookieNames } from '../../modules/auth/cookies';
import type { AuthUser } from '../../modules/auth/auth.types';

/**
 * Global authentication guard: validates the access JWT cookie, then checks (via a 60 s Redis cache)
 * that the session is not revoked and the user is active. Public routes still get `req.user` populated
 * when a valid session exists.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly cache: AuthCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const user = await this.authenticate(req);
    if (user) {
      req.user = user;
      RequestContext.patch({ userId: user.id, sessionId: user.sessionId });
    }
    if (isPublic) return true;
    if (!user) throw new AppError('UNAUTHORIZED', 'Please sign in to continue');

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (user.mustChangePassword && !allowPending) {
      throw new AppError(
        'PASSWORD_CHANGE_REQUIRED',
        'Please change the temporary password before continuing',
      );
    }
    return true;
  }

  private async authenticate(req: Request): Promise<AuthUser | null> {
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.config).access];
    if (!token) return null;
    const claims = this.sessions.verifyAccessToken(token);
    if (!claims) return null;
    const [active, user] = await Promise.all([
      this.cache.isSessionActive(claims.sid, claims.sub),
      this.cache.getUser(claims.sub),
    ]);
    if (!active || !user || user.status !== 'ACTIVE') return null;
    const role = await this.cache.getRole(user.roleId);
    if (!role) return null;
    const permissions = role.key === SYSTEM_ROLES.SUPER_ADMIN ? ['*'] : role.permissions;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      roleKey: role.key,
      permissions,
      timezone: user.timezone,
      sessionId: claims.sid,
      twoFactorEnabled: user.twoFactorEnabled,
      mustChangePassword: user.mustChangePassword,
      isAdmin: isAdminRole(role.key, permissions),
    };
  }
}
