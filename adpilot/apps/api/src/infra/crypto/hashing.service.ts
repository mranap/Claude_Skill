import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../config/app-config';

// OWASP-compliant Argon2id parameters (64 MiB, 3 iterations, 1 lane).
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

@Injectable()
export class HashingService {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly config: AppConfig) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }

  /** Burns the same CPU/memory as a real verification (prevents user enumeration by timing). */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= argon2.hash(randomBytes(16).toString('hex'), ARGON2_OPTIONS);
    await this.verifyPassword(await this.dummyHash, password);
  }

  /** SHA-256 for high-entropy random tokens (reset links, refresh tokens, link codes). */
  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Keyed fingerprint (non-reversible) used to detect duplicate secrets without storing them. */
  fingerprint(value: string): string {
    return createHmac('sha256', this.config.env.CSRF_SECRET).update(`fp:${value}`).digest('hex');
  }

  hmac(value: string, purpose: string): string {
    return createHmac('sha256', this.config.env.CSRF_SECRET).update(`${purpose}:${value}`).digest('base64url');
  }

  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}
