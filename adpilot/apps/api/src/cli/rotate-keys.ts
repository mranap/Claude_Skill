/**
 * Encryption key rotation:
 *   1. add a new key to ENCRYPTION_KEYS (keep the old one) and set ENCRYPTION_ACTIVE_KEY_ID to the new id;
 *   2. restart the API/worker/scheduler (new secrets are written with the new key);
 *   3. run `node dist/cli/rotate-keys.js` — every stored secret is re-encrypted with the active key;
 *   4. remove the old key from ENCRYPTION_KEYS and restart again.
 * Idempotent and safe while the platform is running (see rotate-core.ts).
 */
import '../bootstrap/polyfills';
import { AppConfig } from '../config/app-config';
import { EncryptionService } from '../infra/crypto/encryption.service';
import { createCliPrisma } from './cli-prisma';
import { rotateEncryptedData } from './rotate-core';

async function main(): Promise<void> {
  const config = new AppConfig();
  const encryption = new EncryptionService(config);
  const prisma = createCliPrisma();
  try {
    const report = await rotateEncryptedData(prisma, encryption);
    console.log(`Re-encrypted with key "${config.env.ENCRYPTION_ACTIVE_KEY_ID}": ${JSON.stringify(report)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
