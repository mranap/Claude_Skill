import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RATE_LIMIT, RateLimitOptions } from '../decorators/auth.decorators';
import { AppError } from '../errors/app-error';
import { RateLimiterService } from '../../infra/locks/rate-limiter.service';
import type { AuthUser } from '../../modules/auth/auth.types';

/** Global per-user API limit plus stricter per-route limits declared with `@RateLimit()`. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const ip = req.ip ?? 'unknown';

    // Coarse global protection: 600 requests/minute per user (or per IP when anonymous).
    const global = await this.limiter.hit('api', req.user?.id ?? `ip:${ip}`, req.user ? 600 : 120, 60_000);
    if (!global.allowed) throw AppError.rateLimited(Math.ceil(global.retryAfterMs / 1000));

    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!opts) return true;
    const id = opts.by === 'ip' || !req.user ? `ip:${ip}` : req.user.id;
    const res = await this.limiter.hit(opts.bucket, id, opts.limit, opts.windowSeconds * 1000);
    if (!res.allowed) throw AppError.rateLimited(Math.ceil(res.retryAfterMs / 1000));
    return true;
  }
}
