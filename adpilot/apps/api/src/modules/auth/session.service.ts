import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { AppConfig } from '../../config/app-config';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { AuthCacheService } from './auth-cache.service';
import type { ClientInfo } from './auth.types';

/** A refresh token presented again within this window after rotation is treated as a benign race (multi-tab). */
const ROTATION_GRACE_MS = 60_000;
const JWT_ISSUER = 'adpilot';
const JWT_AUDIENCE = 'adpilot-api';

export interface AccessClaims {
  sub: string;
  sid: string;
  typ: 'access';
}

export interface IssuedSession {
  sessionId: string;
  userId: string;
  accessToken: string;
  /** null when the refresh cookie must not be replaced (grace-period refresh). */
  refreshToken: string | null;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly cache: AuthCacheService,
    private readonly audit: AuditService,
  ) {}

  signAccessToken(userId: string, sessionId: string): string {
    const claims: AccessClaims = { sub: userId, sid: sessionId, typ: 'access' };
    return jwt.sign(claims, this.config.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: this.config.env.ACCESS_TOKEN_TTL_MINUTES * 60,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: randomUUID(),
    });
  }

  verifyAccessToken(token: string): AccessClaims | null {
    try {
      const payload = jwt.verify(token, this.config.env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as jwt.JwtPayload;
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string')
        return null;
      return { sub: payload.sub, sid: payload.sid, typ: 'access' };
    } catch {
      return null;
    }
  }

  /** Short-lived single-purpose token used between password and TOTP verification. */
  signMfaTicket(userId: string): { ticket: string; jti: string } {
    const jti = randomUUID();
    const ticket = jwt.sign({ sub: userId, typ: 'mfa' }, this.config.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: 300,
      issuer: JWT_ISSUER,
      audience: `${JWT_AUDIENCE}-mfa`,
      jwtid: jti,
    });
    return { ticket, jti };
  }

  verifyMfaTicket(ticket: string): { userId: string; jti: string } | null {
    try {
      const p = jwt.verify(ticket, this.config.env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: `${JWT_AUDIENCE}-mfa`,
      }) as jwt.JwtPayload;
      if (p.typ !== 'mfa' || typeof p.sub !== 'string' || typeof p.jti !== 'string') return null;
      return { userId: p.sub, jti: p.jti };
    } catch {
      return null;
    }
  }

  async create(userId: string, client: ClientInfo): Promise<IssuedSession> {
    const security = await this.settings.get('security');
    const refreshToken = this.hashing.randomToken(32);
    const expiresAt = new Date(Date.now() + security.sessionLifetimeDays * 86400_000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: this.hashing.sha256(refreshToken),
        ip: client.ip ?? null,
        userAgent: client.userAgent?.slice(0, 500) ?? null,
        expiresAt,
      },
    });
    return {
      sessionId: session.id,
      userId,
      accessToken: this.signAccessToken(userId, session.id),
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Refresh-token rotation with reuse detection:
   *  - current token → new refresh token + access token;
   *  - previous token within the grace window (parallel tabs) → access token only;
   *  - previous token after the grace window → token theft suspected, session revoked.
   */
  async rotate(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
    const hash = this.hashing.sha256(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { OR: [{ refreshTokenHash: hash }, { previousRefreshHash: hash }] },
      include: { user: { select: { status: true } } },
    });
    if (!session) throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');

    const security = await this.settings.get('security');
    const now = Date.now();
    const idleLimit = security.sessionIdleDays * 86400_000;
    if (
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      now - session.lastUsedAt.getTime() > idleLimit ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }

    if (session.previousRefreshHash === hash) {
      if (session.rotatedAt && now - session.rotatedAt.getTime() <= ROTATION_GRACE_MS) {
        return {
          sessionId: session.id,
          userId: session.userId,
          accessToken: this.signAccessToken(session.userId, session.id),
          refreshToken: null,
          expiresAt: session.expiresAt,
        };
      }
      await this.revoke(session.id, 'refresh_token_reuse');
      await this.audit.log({
        action: 'auth.session.refresh_reuse_detected',
        actorUserId: session.userId,
        subjectUserId: session.userId,
        targetType: 'session',
        targetId: session.id,
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }

    const nextToken = this.hashing.randomToken(32);
    const updated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        previousRefreshHash: hash,
        refreshTokenHash: this.hashing.sha256(nextToken),
        rotatedAt: new Date(now),
        lastUsedAt: new Date(now),
        ip: client.ip ?? session.ip,
        userAgent: client.userAgent?.slice(0, 500) ?? session.userAgent,
      },
    });
    return {
      sessionId: session.id,
      userId: session.userId,
      accessToken: this.signAccessToken(session.userId, session.id),
      // Lost the race against a parallel refresh: the other response already set the new cookie.
      refreshToken: updated.count === 1 ? nextToken : null,
      expiresAt: session.expiresAt,
    };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.cache.invalidateSession(sessionId);
  }

  /** Revokes every active session of the user, optionally keeping one (the current one). */
  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      select: { id: true },
    });
    if (!sessions.length) return 0;
    await this.prisma.session.updateMany({
      where: { id: { in: sessions.map((s) => s.id) } },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.cache.invalidateSession(...sessions.map((s) => s.id));
    return sessions.length;
  }

  async listActive(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
  }
}
