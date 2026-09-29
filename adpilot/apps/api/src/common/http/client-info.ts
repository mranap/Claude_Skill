import type { Request } from 'express';
import type { ClientInfo } from '../../modules/auth/auth.types';

/** Client IP (respecting TRUST_PROXY) and user agent of the request. */
export function clientInfo(req: Request): ClientInfo {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 500) : undefined };
}
