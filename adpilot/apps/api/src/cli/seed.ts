/**
 * `pnpm db:seed` / `node dist/cli/seed.js`
 * Idempotent: permissions + system roles; creates the first Super Admin when SUPER_ADMIN_EMAIL and
 * SUPER_ADMIN_PASSWORD are set and no active Super Admin exists yet. Passwords are never hard-coded.
 */
import '../bootstrap/polyfills';
import { SYSTEM_ROLES } from '@adpilot/shared';
import { loadEnv } from '../config/env';
import { createCliPrisma } from './cli-prisma';
import { seedRbac } from './seed-core';
import { ensureSuperAdmin } from './super-admin';

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = createCliPrisma();
  try {
    const { createdPermissions } = await seedRbac(prisma);
    console.log(`RBAC seeded (${createdPermissions.length} new permissions).`);

    const activeSuperAdmins = await prisma.user.count({ where: { role: { key: SYSTEM_ROLES.SUPER_ADMIN }, status: 'ACTIVE' } });
    if (activeSuperAdmins === 0) {
      if (env.SUPER_ADMIN_EMAIL && env.SUPER_ADMIN_PASSWORD) {
        const result = await ensureSuperAdmin(prisma, {
          email: env.SUPER_ADMIN_EMAIL,
          password: env.SUPER_ADMIN_PASSWORD,
          name: env.SUPER_ADMIN_NAME,
        });
        console.log(`Super Admin ${env.SUPER_ADMIN_EMAIL}: ${result}. Remove SUPER_ADMIN_PASSWORD from the environment now.`);
      } else {
        console.warn('No Super Admin exists. Set SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD and re-run, or use `pnpm admin:create`.');
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
