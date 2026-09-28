import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppConfig } from '../../config/app-config';
import { SKIP_CSRF } from '../decorators/auth.decorators';
import { AppError } from '../errors/app-error';
import { CsrfService } from '../../modules/auth/csrf.service';
import { cookieNames } from '../../modules/auth/cookies';
import type { AuthUser } from '../../modules/auth/auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated requests:
 *  1. Origin/Referer must match an allowed origin for state-changing methods;
 *  2. double-submit token (cookie == X-CSRF-Token header) bound to the current session.
 * Runs after AuthGuard so the session id is known.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
    private readonly csrf: CsrfService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin ?? this.originFromReferer(req.headers.referer);
    if (origin && !this.config.corsOrigins.includes(origin)) {
      throw new AppError('CSRF_INVALID', 'Request origin is not allowed');
    }
    // Endpoints authenticated by other means (webhook secret) or only by SameSite=Strict cookies
    // (refresh/logout) skip the token check but still get the Origin check above.
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;

    const cookie = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.config).csrf];
    const header = req.headers['x-csrf-token'];
    const ok = this.csrf.verify(cookie, typeof header === 'string' ? header : undefined, req.user?.sessionId ?? null);
    if (!ok) throw new AppError('CSRF_INVALID', 'Security token is missing or expired. Reload the page and try again.');
    return true;
  }

  private originFromReferer(referer?: string): string | undefined {
    if (!referer) return undefined;
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
}
