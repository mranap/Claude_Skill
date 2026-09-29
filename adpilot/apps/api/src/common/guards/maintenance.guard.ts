import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from '../decorators/auth.decorators';
import { AppError } from '../errors/app-error';
import { SettingsService } from '../../modules/settings/settings.service';
import type { AuthUser } from '../../modules/auth/auth.types';

/** In maintenance mode only administrators (and public auth/health routes) can use the API. */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const maintenance = await this.settings.get('maintenance');
    if (!maintenance.enabled) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (isPublic || req.user?.isAdmin) return true;
    if (req.path.endsWith('/auth/me') || req.path.endsWith('/auth/logout')) return true;
    throw new AppError('MAINTENANCE', maintenance.message);
  }
}
