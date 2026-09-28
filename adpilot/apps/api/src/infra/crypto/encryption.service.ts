import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/app-config';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc1';

/**
 * Envelope format: `enc1:<keyId>:<iv>:<authTag>:<ciphertext>` (base64url parts).
 *
 * - AES-256-GCM authenticated encryption, random 96-bit IV per value.
 * - Keys come from the ENCRYPTION_KEYS environment variable (`id:base64key,id2:base64key`) and are never
 *   stored in the database or in database backups. ENCRYPTION_ACTIVE_KEY_ID selects the key used for new
 *   values; older keys stay available for decryption, which allows key rotation (`cli/rotate-keys`).
 * - Every value is bound to its location through AAD (e.g. `meta_profile:<id>:token`), so ciphertext
 *   copied into another row/column fails authentication instead of decrypting.
 */
@Injectable()
export class EncryptionService {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKeyId: string;

  constructor(config: AppConfig) {
    for (const entry of config.env.ENCRYPTION_KEYS.split(',').map((s) => s.trim()).filter(Boolean)) {
      const idx = entry.indexOf(':');
      if (idx <= 0) throw new Error('ENCRYPTION_KEYS entries must look like "<id>:<base64-32-bytes>"');
      const id = entry.slice(0, idx);
      const key = Buffer.from(entry.slice(idx + 1), 'base64');
      if (key.length !== 32) throw new Error(`Encryption key "${id}" must be exactly 32 bytes (base64 encoded)`);
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error(`Invalid encryption key id "${id}"`);
      this.keys.set(id, key);
    }
    this.activeKeyId = config.env.ENCRYPTION_ACTIVE_KEY_ID;
    if (!this.keys.has(this.activeKeyId)) {
      throw new Error(`ENCRYPTION_ACTIVE_KEY_ID "${this.activeKeyId}" is not present in ENCRYPTION_KEYS`);
    }
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, this.activeKeyId, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(
      ':',
    );
  }

  decrypt(envelope: string, aad: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 5 || parts[0] !== PREFIX) throw new Error('Malformed encrypted value');
    const [, keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Encryption key "${keyId}" is not configured`);
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    // Reject truncated tags explicitly: GCM would otherwise accept shorter (forgeable) tags.
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Malformed encrypted value');
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptNullable(plaintext: string | null | undefined, aad: string): string | null {
    return plaintext === null || plaintext === undefined || plaintext === '' ? null : this.encrypt(plaintext, aad);
  }

  decryptNullable(envelope: string | null | undefined, aad: string): string | null {
    return envelope ? this.decrypt(envelope, aad) : null;
  }

  /** True when the value was encrypted with a key other than the active one (rotation candidate). */
  needsRotation(envelope: string): boolean {
    return envelope.split(':')[1] !== this.activeKeyId;
  }

  isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
  }
}

/** AAD builders — keep them in one place so every writer/reader uses the same context string. */
export const Aad = {
  metaToken: (profileId: string) => `meta_profile:${profileId}:token`,
  metaAppSecret: (profileId: string) => `meta_profile:${profileId}:app_secret`,
  proxyPassword: (proxyId: string) => `proxy:${proxyId}:password`,
  totpSecret: (userId: string) => `user:${userId}:totp`,
  totpPendingSecret: (userId: string) => `user:${userId}:totp_pending`,
  setting: (key: string) => `setting:${key}`,
  mailJob: () => 'mail:system-job',
};
