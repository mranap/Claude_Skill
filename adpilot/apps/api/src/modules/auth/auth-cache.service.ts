import { Injectable } from '@nestjs/common';
import { RedisService } from '../../infra/redis/redis.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { CachedRole, CachedUser } from './auth.types';

const TTL_SECONDS = 60;

/**
 * Short-lived Redis cache for the data needed on every authenticated request (session validity, user
 * status/role, role permissions). Revocation and blocking delete the relevant keys, so they take effect
 * immediately on all API replicas.
 */
@Injectable()
export class AuthCacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private sessionKey(id: string) {
    return this.redis.key('auth', 'sess', id);
  }
  private userKey(id: string) {
    return this.redis.key('auth', 'user', id);
  }
  private roleKey(id: string) {
    return this.redis.key('auth', 'role', id);
  }

  /** Returns true when the session exists, is not revoked and not expired. */
  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const key = this.sessionKey(sessionId);
    const cached = await this.redis.client.get(key);
    if (cached !== null) return cached === userId;
    const s = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    const active = !!s && !s.revokedAt && s.expiresAt > new Date() && s.userId === userId;
    await this.redis.client.set(key, active ? userId : '-', 'EX', TTL_SECONDS);
    return active;
  }

  async getUser(userId: string): Promise<CachedUser | null> {
    const key = this.userKey(userId);
    const cached = await this.redis.client.get(key);
    if (cached) return cached === '-' ? null : (JSON.parse(cached) as CachedUser);
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        roleId: true,
        timezone: true,
        twoFactorEnabled: true,
        mustChangePassword: true,
      },
    });
    await this.redis.client.set(key, u ? JSON.stringify(u) : '-', 'EX', TTL_SECONDS);
    return u;
  }

  async getRole(roleId: string): Promise<CachedRole | null> {
    const key = this.roleKey(roleId);
    const cached = await this.redis.client.get(key);
    if (cached) return JSON.parse(cached) as CachedRole;
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) return null;
    const value: CachedRole = { key: role.key, permissions: role.permissions.map((p) => p.permission.key) };
    await this.redis.client.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
    return value;
  }

  async invalidateSession(...sessionIds: string[]): Promise<void> {
    if (sessionIds.length) await this.redis.client.del(...sessionIds.map((id) => this.sessionKey(id)));
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.redis.client.del(this.userKey(userId));
  }

  async invalidateRole(roleId: string): Promise<void> {
    await this.redis.client.del(this.roleKey(roleId));
  }
}
