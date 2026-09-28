/**
 * Create or promote a Super Admin.
 *
 *   node dist/cli/create-super-admin.js --email admin@example.com [--name "Jane"] [--reset-password]
 *
 * The password is read from the SUPER_ADMIN_PASSWORD environment variable or, when it is not set, from an
 * interactive prompt (input hidden). It is never accepted as a command-line argument (shell history).
 */
import '../bootstrap/polyfills';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createCliPrisma } from './cli-prisma';
import { seedRbac } from './seed-core';
import { ensureSuperAdmin } from './super-admin';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main(): Promise<void> {
  const email = arg('email') ?? process.env.SUPER_ADMIN_EMAIL;
  if (!email) throw new Error('Usage: create-super-admin --email <email> [--name <name>] [--reset-password]');
  const password = process.env.SUPER_ADMIN_PASSWORD || (await promptHidden('Password (min 10 chars, letters + digits): '));
  const prisma = createCliPrisma();
  try {
    await seedRbac(prisma);
    const result = await ensureSuperAdmin(prisma, {
      email,
      password,
      name: arg('name') ?? process.env.SUPER_ADMIN_NAME,
      resetPassword: process.argv.includes('--reset-password'),
    });
    console.log(`Super Admin ${email}: ${result}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
