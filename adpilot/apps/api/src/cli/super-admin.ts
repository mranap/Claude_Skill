import * as argon2 from 'argon2';
import { SYSTEM_ROLES, emailSchema, passwordSchema } from '@adpilot/shared';
import type { PrismaClient } from '../generated/prisma/client';

export interface SuperAdminInput {
  email: string;
  password: string;
  name?: string;
  /** Reset the password when the user already exists. */
  resetPassword?: boolean;
}

/** Creates the Super Admin or promotes an existing user. Credentials always come from ENV/CLI args. */
export async function ensureSuperAdmin(
  prisma: PrismaClient,
  input: SuperAdminInput,
): Promise<'created' | 'promoted' | 'unchanged'> {
  const email = emailSchema.parse(input.email);
  const pw = passwordSchema.safeParse(input.password);
  if (!pw.success)
    throw new Error(`SUPER_ADMIN_PASSWORD rejected: ${pw.error.issues.map((i) => i.message).join('; ')}`);
  const role = await prisma.role.findUnique({ where: { key: SYSTEM_ROLES.SUPER_ADMIN } });
  if (!role) throw new Error('Run the seed first: the SUPER_ADMIN role does not exist');

  const hash = () =>
    argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        name: input.name ?? 'Super Admin',
        roleId: role.id,
        passwordHash: await hash(),
        passwordChangedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: { action: 'system.super_admin.created', actorType: 'SYSTEM', metadata: { email } },
    });
    return 'created';
  }
  const changes: Record<string, unknown> = {};
  if (existing.roleId !== role.id) changes.roleId = role.id;
  if (existing.status !== 'ACTIVE')
    Object.assign(changes, { status: 'ACTIVE', blockedAt: null, blockedReason: null });
  if (input.resetPassword)
    Object.assign(changes, {
      passwordHash: await hash(),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    });
  if (!Object.keys(changes).length) return 'unchanged';
  await prisma.user.update({ where: { id: existing.id }, data: changes });
  await prisma.auditLog.create({
    data: {
      action: 'system.super_admin.updated',
      actorType: 'SYSTEM',
      subjectUserId: existing.id,
      metadata: { email, fields: Object.keys(changes).filter((k) => k !== 'passwordHash') },
    },
  });
  return 'promoted';
}
