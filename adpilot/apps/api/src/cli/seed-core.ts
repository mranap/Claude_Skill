import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  SYSTEM_ROLES,
  type SystemRoleKey,
} from '@adpilot/shared';
import type { PrismaClient } from '../generated/prisma/client';

const ROLE_INFO: Record<SystemRoleKey, { name: string; description: string }> = {
  USER: { name: 'User', description: 'Manages only their own Meta profiles, campaigns, rules and files.' },
  ADMIN: { name: 'Administrator', description: 'Manages regular users and can view operations data.' },
  SUPER_ADMIN: { name: 'Super Admin', description: 'Full access to the platform.' },
};

/**
 * Idempotent seed of permissions and system roles. Safe to run on every deployment:
 *  - new permission keys are created and granted to the system roles that have them by default;
 *  - existing role/permission assignments customised in the UI are left untouched.
 */
export async function seedRbac(prisma: PrismaClient): Promise<{ createdPermissions: string[] }> {
  const existing = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const createdPermissions: string[] = [];

  for (const key of ALL_PERMISSION_KEYS) {
    const info = PERMISSION_DESCRIPTIONS[key];
    await prisma.permission.upsert({
      where: { key },
      create: { key, group: info.group, description: info.description },
      update: { group: info.group, description: info.description },
    });
    if (!existing.has(key)) createdPermissions.push(key);
  }

  for (const roleKey of Object.values(SYSTEM_ROLES)) {
    const info = ROLE_INFO[roleKey];
    const roleExisted = await prisma.role.findUnique({ where: { key: roleKey }, select: { id: true } });
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      create: { key: roleKey, name: info.name, description: info.description, isSystem: true },
      update: { isSystem: true },
    });
    const grant = roleExisted
      ? DEFAULT_ROLE_PERMISSIONS[roleKey].filter((p) => createdPermissions.includes(p))
      : DEFAULT_ROLE_PERMISSIONS[roleKey];
    if (grant.length) {
      const perms = await prisma.permission.findMany({ where: { key: { in: grant } }, select: { id: true } });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }
  return { createdPermissions };
}
