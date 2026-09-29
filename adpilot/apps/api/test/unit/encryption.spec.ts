import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Aad, EncryptionService } from '../../src/infra/crypto/encryption.service';
import type { AppConfig } from '../../src/config/app-config';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');

function service(keys: string, active: string): EncryptionService {
  return new EncryptionService({
    env: { ENCRYPTION_KEYS: keys, ENCRYPTION_ACTIVE_KEY_ID: active },
  } as unknown as AppConfig);
}

describe('EncryptionService (AES-256-GCM envelopes)', () => {
  const enc = service(`k1:${k1}`, 'k1');

  it('round-trips and never stores the plaintext', () => {
    const token = 'EAABsbCW1234567890abcdefXYZ';
    const envelope = enc.encrypt(token, Aad.metaToken('p1'));
    expect(envelope.startsWith('enc1:k1:')).toBe(true);
    expect(envelope).not.toContain(token);
    expect(enc.decrypt(envelope, Aad.metaToken('p1'))).toBe(token);
  });

  it('uses a fresh IV for every value', () => {
    expect(enc.encrypt('same', 'aad')).not.toBe(enc.encrypt('same', 'aad'));
  });

  it('binds ciphertext to its row/field through AAD', () => {
    const envelope = enc.encrypt('secret', Aad.metaToken('p1'));
    expect(() => enc.decrypt(envelope, Aad.metaToken('p2'))).toThrow();
    expect(() => enc.decrypt(envelope, Aad.proxyPassword('p1'))).toThrow();
  });

  it('detects tampering and truncated authentication tags', () => {
    const envelope = enc.encrypt('secret', 'aad');
    const [prefix, keyId, iv, tag, ct] = envelope.split(':') as [string, string, string, string, string];
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] = flipped[0] ^ 0xff;
    expect(() =>
      enc.decrypt([prefix, keyId, iv, tag, flipped.toString('base64url')].join(':'), 'aad'),
    ).toThrow();
    const shortTag = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => enc.decrypt([prefix, keyId, iv, shortTag, ct].join(':'), 'aad')).toThrow(/Malformed/);
    expect(() => enc.decrypt('plaintext-value', 'aad')).toThrow(/Malformed/);
  });

  it('supports key rotation: old values stay readable, new values use the active key', () => {
    const old = enc.encrypt('rotate-me', 'aad');
    const rotated = service(`k1:${k1},k2:${k2}`, 'k2');
    expect(rotated.decrypt(old, 'aad')).toBe('rotate-me');
    expect(rotated.needsRotation(old)).toBe(true);
    const fresh = rotated.encrypt('rotate-me', 'aad');
    expect(fresh.startsWith('enc1:k2:')).toBe(true);
    expect(rotated.needsRotation(fresh)).toBe(false);
    // A process that lost the old key cannot decrypt (and says which key is missing).
    expect(() => service(`k2:${k2}`, 'k2').decrypt(old, 'aad')).toThrow(/k1/);
  });

  it('refuses invalid key configuration', () => {
    expect(() => service(`k1:${randomBytes(16).toString('base64')}`, 'k1')).toThrow(/32 bytes/);
    expect(() => service(`k1:${k1}`, 'k9')).toThrow(/not present/);
    expect(() => service('garbage', 'k1')).toThrow();
  });

  it('handles nullable helpers', () => {
    expect(enc.encryptNullable('', 'a')).toBeNull();
    expect(enc.encryptNullable(null, 'a')).toBeNull();
    expect(enc.decryptNullable(null, 'a')).toBeNull();
    expect(enc.isEncrypted(enc.encrypt('x', 'a'))).toBe(true);
    expect(enc.isEncrypted('x')).toBe(false);
  });
});
