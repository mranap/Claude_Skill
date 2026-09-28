import { Injectable } from '@nestjs/common';
import { SYSTEM_ROLES } from '@adpilot/shared';
import { z } from 'zod';
import {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { SessionService } from '../auth/session.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../infra/prisma/prisma-errors';
import type { AuthUser } from '../auth/auth.types';
import { Prisma } from '../../generated/prisma/client';

const INVITE_TTL_HOURS = 72;

type ListQuery = z.infer<typeof adminUserListQuerySchema>;

/**
 * User administration. Privilege rules:
 *  - only SUPER_ADMIN can manage users that hold administrative permissions or assign such roles;
 *  - nobody can block/delete/demote themselves;
 *  - the last active SUPER_ADMIN can never be blocked, deleted or demoted.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly cache: AuthCacheService,
  ) {}

  async list(q: ListQuery) {
    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status } : { status: { not: 'DELETED' } }),
      ...(q.roleId ? { roleId: q.roleId } : {}),
      ...(q.q
        ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [field, dir] = (q.sort ?? 'createdAt:desc').split(':') as [string, 'asc' | 'desc'];
    const sortable = new Set(['createdAt', 'email', 'lastLoginAt', 'status']);
    const orderBy = { [sortable.has(field) ? field : 'createdAt']: dir } as Prisma.UserOrderByWithRelationInput;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          twoFactorEnabled: true,
          mustChangePassword: true,
          lockedUntil: true,
          storageUsedBytes: true,
          role: { select: { id: true, key: true, name: true, permissions: { select: { permission: { select: { key: true } } } } } },
          _count: { select: { metaProfiles: { where: { deletedAt: null } }, adAccounts: { where: { isConnected: true } }, campaigns: true, creativeFiles: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: users.map((u) => ({
        ...u,
        role: { id: u.role.id, key: u.role.key, name: u.role.name, permissions: u.role.permissions.map((p) => p.permission.key) },
        usage: {
          metaProfiles: u._count.metaProfiles,
          adAccounts: u._count.adAccounts,
          campaigns: u._count.campaigns,
          files: u._count.creativeFiles,
          storageBytes: u.storageUsedBytes.toString(),
        },
        _count: undefined,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(id: string, actor?: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        timezone: true,
        lastLoginAt: true,
        lastLoginIp: true,
        createdAt: true,
        blockedAt: true,
        blockedReason: true,
        deletedAt: true,
        twoFactorEnabled: true,
        mustChangePassword: true,
        lockedUntil: true,
        storageUsedBytes: true,
        storageQuotaBytes: true,
        role: { select: { id: true, key: true, name: true } },
        telegramConnection: { select: { username: true, isActive: true, linkedAt: true } },
        _count: {
          select: {
            metaProfiles: { where: { deletedAt: null } },
            adAccounts: { where: { isConnected: true } },
            campaigns: true,
            creativeFiles: { where: { deletedAt: null } },
            autoRules: { where: { deletedAt: null } },
            launchJobs: true,
          },
        },
      },
    });
    if (!user) throw AppError.notFound('User');
    // `current` marks the administrator's own session, so revoking it can be confirmed explicitly in the UI.
    const sessions = (await this.sessions.listActive(id)).map((s) => ({ ...s, current: s.id === actor?.sessionId }));
    const recentLogins = await this.prisma.loginEvent.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, success: true, reason: true, ip: true, userAgent: true, createdAt: true },
    });
    return { ...user, sessions, recentLogins };
  }

  async create(actor: AuthUser, input: z.infer<typeof adminCreateUserSchema>) {
    const role = await this.assertAssignableRole(actor, input.roleId);
    const initialPassword = input.mode === 'password' ? input.password! : this.hashing.randomToken(32);
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name ?? null,
          roleId: role.id,
          timezone: input.timezone ?? 'UTC',
          passwordHash: await this.hashing.hashPassword(initialPassword),
          mustChangePassword: input.mode === 'password',
          createdById: actor.id,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('A user with this e-mail already exists');
      throw err;
    }
    if (input.mode === 'invite') await this.issueSetPasswordLink(user.id, user.email, 'INVITE');
    await this.audit.log({
      action: 'admin.user.created',
      actorUserId: actor.id,
      subjectUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email, role: role.key, mode: input.mode },
    });
    return this.get(user.id);
  }

  async update(actor: AuthUser, id: string, input: z.infer<typeof adminUpdateUserSchema>) {
    const target = await this.assertManageable(actor, id);
    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.timezone) data.timezone = input.timezone;
    if (input.storageQuotaMb !== undefined) {
      data.storageQuotaBytes = input.storageQuotaMb === null ? null : BigInt(input.storageQuotaMb) * 1024n * 1024n;
    }
    if (input.roleId && input.roleId !== target.roleId) {
      if (target.id === actor.id) throw AppError.forbidden('You cannot change your own role');
      const role = await this.assertAssignableRole(actor, input.roleId);
      if (target.role.key === SYSTEM_ROLES.SUPER_ADMIN) await this.assertNotLastSuperAdmin(target.id);
      data.role = { connect: { id: role.id } };
    }
    await this.prisma.user.update({ where: { id }, data });
    await this.cache.invalidateUser(id);
    await this.audit.log({
      action: 'admin.user.updated',
      actorUserId: actor.id,
      subjectUserId: id,
      targetType: 'user',
      targetId: id,
      metadata: { changes: input },
    });
    return this.get(id);
  }

  async block(actor: AuthUser, id: string, reason?: string) {
    const target = await this.assertManageable(actor, id);
    if (target.id === actor.id) throw AppError.forbidden('You cannot block yourself');
    if (target.role.key === SYSTEM_ROLES.SUPER_ADMIN) await this.assertNotLastSuperAdmin(id);
    if (target.status === 'DELETED') throw AppError.conflict('User is deleted');
    await this.prisma.user.update({
      where: { id },
      data: { status: 'BLOCKED', blockedAt: new Date(), blockedReason: reason ?? null },
    });
    await this.sessions.revokeAllForUser(id, 'user_blocked');
    await this.cache.invalidateUser(id);
    await this.audit.log({ action: 'admin.user.blocked', actorUserId: actor.id, subjectUserId: id, targetType: 'user', targetId: id, metadata: { reason } });
  }

  async unblock(actor: AuthUser, id: string) {
    const target = await this.assertManageable(actor, id);
    if (target.status !== 'BLOCKED') throw AppError.conflict('User is not blocked');
    await this.prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE', blockedAt: null, blockedReason: null, failedLoginCount: 0, lockedUntil: null },
    });
    await this.cache.invalidateUser(id);
    await this.audit.log({ action: 'admin.user.unblocked', actorUserId: actor.id, subjectUserId: id, targetType: 'user', targetId: id });
  }

  async resetPassword(actor: AuthUser, id: string, input: z.infer<typeof adminResetPasswordSchema>) {
    const target = await this.assertManageable(actor, id);
    if (target.status === 'DELETED') throw AppError.conflict('User is deleted');
    if (input.mode === 'password') {
      await this.prisma.user.update({
        where: { id },
        data: {
          passwordHash: await this.hashing.hashPassword(input.password!),
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    } else {
      await this.issueSetPasswordLink(id, target.email, 'RESET');
    }
    await this.sessions.revokeAllForUser(id, 'password_reset_by_admin');
    await this.cache.invalidateUser(id);
    await this.audit.log({ action: 'admin.user.password_reset', actorUserId: actor.id, subjectUserId: id, targetType: 'user', targetId: id, metadata: { mode: input.mode } });
  }

  async resetTwoFactor(actor: AuthUser, id: string) {
    await this.assertManageable(actor, id);
    await this.prisma.user.update({
      where: { id },
      data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorPendingSecretEnc: null, twoFactorRecoveryHashes: [] },
    });
    await this.sessions.revokeAllForUser(id, '2fa_reset_by_admin');
    await this.cache.invalidateUser(id);
    await this.audit.log({ action: 'admin.user.2fa_reset', actorUserId: actor.id, subjectUserId: id, targetType: 'user', targetId: id });
  }

  async revokeSessions(actor: AuthUser, id: string, sessionId?: string) {
    await this.assertManageable(actor, id);
    if (sessionId) {
      const s = await this.prisma.session.findFirst({ where: { id: sessionId, userId: id } });
      if (!s) throw AppError.notFound('Session');
      await this.sessions.revoke(sessionId, 'revoked_by_admin');
    } else {
      await this.sessions.revokeAllForUser(id, 'revoked_by_admin');
    }
    await this.audit.log({ action: 'admin.user.sessions_revoked', actorUserId: actor.id, subjectUserId: id, targetType: 'user', targetId: id, metadata: { sessionId } });
  }

  /**
   * Deactivates the account (soft delete kept for the audit trail) and destroys every secret the user
   * owns: Meta tokens, app secrets, proxy passwords, sessions, Telegram links, one-time tokens, 2FA data.
   */
  async delete(actor: AuthUser, id: string) {
    const target = await this.assertManageable(actor, id);
    if (target.id === actor.id) throw AppError.forbidden('You cannot delete your own account');
    if (target.role.key === SYSTEM_ROLES.SUPER_ADMIN) await this.assertNotLastSuperAdmin(id);
    if (target.status === 'DELETED') return;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          status: 'DELETED',
          deletedAt: now,
          email: `deleted+${id}@deleted.invalid`,
          name: null,
          passwordHash: await this.hashing.hashPassword(this.hashing.randomToken(32)),
          twoFactorEnabled: false,
          twoFactorSecretEnc: null,
          twoFactorPendingSecretEnc: null,
          twoFactorRecoveryHashes: [],
        },
      }),
      this.prisma.metaProfile.updateMany({
        where: { userId: id },
        data: { tokenEnc: null, appSecretEnc: null, isEnabled: false, deletedAt: now, tokenMask: '[deleted]' },
      }),
      this.prisma.proxy.updateMany({ where: { userId: id }, data: { passwordEnc: null, username: null } }),
      this.prisma.telegramConnection.deleteMany({ where: { userId: id } }),
      this.prisma.telegramLinkCode.deleteMany({ where: { userId: id } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
      this.prisma.emailChangeToken.deleteMany({ where: { userId: id } }),
      this.prisma.adAccount.updateMany({ where: { userId: id }, data: { isConnected: false } }),
      this.prisma.autoRule.updateMany({ where: { userId: id }, data: { isActive: false } }),
      this.prisma.launchJob.updateMany({
        where: { userId: id, status: { in: ['QUEUED', 'VALIDATING', 'UPLOADING_CREATIVES', 'CREATING_CAMPAIGN', 'CREATING_ADSETS', 'CREATING_ADS', 'VERIFYING', 'ACTIVATING'] } },
        data: { cancelRequestedAt: now },
      }),
      this.prisma.creativeFile.updateMany({ where: { userId: id, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'user_deleted' } }),
    ]);
    await this.cache.invalidateUser(id);
    const sessionIds = (await this.prisma.session.findMany({ where: { userId: id }, select: { id: true } })).map((s) => s.id);
    await this.cache.invalidateSession(...sessionIds);
    await this.audit.log({
      action: 'admin.user.deleted',
      actorUserId: actor.id,
      subjectUserId: id,
      targetType: 'user',
      targetId: id,
      metadata: { emailHash: this.hashing.sha256(target.email) },
    });
  }

  // ─────────────── helpers ───────────────

  private async issueSetPasswordLink(userId: string, email: string, purpose: 'INVITE' | 'RESET') {
    const token = this.hashing.randomToken(32);
    const hours = purpose === 'INVITE' ? INVITE_TTL_HOURS : 1;
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId, tokenHash: this.hashing.sha256(token), purpose, expiresAt: new Date(Date.now() + hours * 3600_000) },
      }),
    ]);
    if (purpose === 'INVITE') await this.mail.sendInvitation(email, token, hours, userId);
    else await this.mail.sendPasswordReset(email, token, hours * 60, userId);
  }

  private async roleIsPrivileged(roleId: string): Promise<{ id: string; key: string; privileged: boolean }> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });
    if (!role) throw AppError.validation('Unknown role', [{ path: 'roleId', message: 'Unknown role' }]);
    const privileged =
      role.key === SYSTEM_ROLES.SUPER_ADMIN || role.permissions.some((p) => p.permission.key.startsWith('admin.'));
    return { id: role.id, key: role.key, privileged };
  }

  private async assertAssignableRole(actor: AuthUser, roleId: string) {
    const role = await this.roleIsPrivileged(roleId);
    if (actor.roleKey !== SYSTEM_ROLES.SUPER_ADMIN && role.privileged) {
      throw AppError.forbidden('Only a Super Admin can assign administrative roles');
    }
    return role;
  }

  private async assertManageable(actor: AuthUser, id: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw AppError.notFound('User');
    if (actor.roleKey !== SYSTEM_ROLES.SUPER_ADMIN && target.id !== actor.id) {
      const { privileged } = await this.roleIsPrivileged(target.roleId);
      if (privileged) throw AppError.forbidden('Only a Super Admin can manage administrators');
    }
    return target;
  }

  private async assertNotLastSuperAdmin(excludingUserId: string) {
    const others = await this.prisma.user.count({
      where: { role: { key: SYSTEM_ROLES.SUPER_ADMIN }, status: 'ACTIVE', id: { not: excludingUserId } },
    });
    if (others === 0) throw AppError.forbidden('The last active Super Admin cannot be removed, blocked or demoted');
  }
}
