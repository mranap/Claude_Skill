import { Injectable } from '@nestjs/common';
import { ALL_PERMISSION_KEYS, SYSTEM_ROLES, type PermissionKey } from '@adpilot/shared';
import { z } from 'zod';
import { roleCreateSchema, roleUpdateSchema } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../infra/prisma/prisma-errors';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: AuthCacheService,
  ) {}

  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { users: { where: { status: { not: 'DELETED' } } } } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.key === SYSTEM_ROLES.SUPER_ADMIN ? ALL_PERMISSION_KEYS : r.permissions.map((p) => p.permission.key),
      userCount: r._count.users,
      editable: r.key !== SYSTEM_ROLES.SUPER_ADMIN,
    }));
  }

  async permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
  }

  async create(actor: AuthUser, input: z.infer<typeof roleCreateSchema>) {
    const permissionIds = await this.resolvePermissions(input.permissions);
    try {
      const role = await this.prisma.role.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
      });
      await this.audit.log({ action: 'admin.role.created', actorUserId: actor.id, targetType: 'role', targetId: role.id, metadata: input });
      return role;
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('A role with this key already exists');
      throw err;
    }
  }

  async update(actor: AuthUser, id: string, input: z.infer<typeof roleUpdateSchema>) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw AppError.notFound('Role');
    if (role.key === SYSTEM_ROLES.SUPER_ADMIN) throw AppError.forbidden('The Super Admin role always has every permission');
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      if (input.permissions) {
        const permissionIds = await this.resolvePermissions(input.permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissionIds.length) {
          await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) });
        }
      }
    });
    await this.cache.invalidateRole(id);
    await this.audit.log({ action: 'admin.role.updated', actorUserId: actor.id, targetType: 'role', targetId: id, metadata: input });
    return (await this.list()).find((r) => r.id === id);
  }

  async remove(actor: AuthUser, id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw AppError.notFound('Role');
    if (role.isSystem) throw AppError.forbidden('System roles cannot be deleted');
    if (role._count.users > 0) throw AppError.conflict('Move the users of this role to another role first');
    await this.prisma.role.delete({ where: { id } });
    await this.cache.invalidateRole(id);
    await this.audit.log({ action: 'admin.role.deleted', actorUserId: actor.id, targetType: 'role', targetId: id, metadata: { key: role.key } });
  }

  private async resolvePermissions(keys: string[]): Promise<string[]> {
    const unknown = keys.filter((k) => !ALL_PERMISSION_KEYS.includes(k as PermissionKey));
    if (unknown.length) throw AppError.validation(`Unknown permissions: ${unknown.join(', ')}`);
    const rows = await this.prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
}
