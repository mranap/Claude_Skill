import { BeforeApplicationShutdown, Injectable, OnModuleInit } from '@nestjs/common';
import {
  SECRET_SETTING_FIELDS,
  SETTINGS_SCHEMAS,
  SETTING_KEYS,
  SettingKey,
  SettingValue,
  defaultSettings,
} from '@adpilot/shared';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../infra/logger/logger';
import { Prisma } from '../../generated/prisma/client';

const CACHE_TTL_MS = 30_000;
type Stored = Record<string, unknown>;

export interface SecretPatch {
  /** undefined or '' → keep the current value, null → clear, non-empty string → replace. */
  [field: string]: string | null | undefined;
}

/**
 * Typed access to system settings with an in-process cache that is invalidated across all processes
 * (API replicas, workers, scheduler) through Redis pub/sub.
 */
@Injectable()
export class SettingsService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new AppLogger('SettingsService');
  private readonly cache = new Map<SettingKey, { value: Stored; at: number }>();
  private subscriber: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly encryption: EncryptionService,
  ) {}

  private get channel(): string {
    return this.redis.key('settings', 'invalidate');
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.create('settings-sub');
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on('message', (_ch, key: string) => {
      if (key === '*') this.cache.clear();
      else this.cache.delete(key as SettingKey);
    });
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  private async loadRaw(key: SettingKey): Promise<Stored> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const value = (row?.value as Stored | null) ?? {};
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  /** Public (non-secret) part of a setting group, merged with defaults. */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const raw = await this.loadRaw(key);
    const parsed = SETTINGS_SCHEMAS[key].safeParse(this.withoutSecrets(key, raw));
    if (!parsed.success) {
      this.logger.warn('Stored setting is invalid, falling back to defaults', { key });
      return defaultSettings(key);
    }
    return parsed.data as SettingValue<K>;
  }

  /** Decrypted secret field (server-side use only). */
  async getSecret(key: SettingKey, field: string): Promise<string | null> {
    const raw = await this.loadRaw(key);
    const enc = raw[field];
    if (typeof enc !== 'string' || !enc) return null;
    try {
      return this.encryption.decrypt(enc, Aad.setting(`${key}.${field}`));
    } catch (err) {
      this.logger.error('Cannot decrypt setting secret (wrong ENCRYPTION_KEYS?)', { key, field, err });
      return null;
    }
  }

  /** Setting as returned to the admin UI: secrets replaced by `<field>Set` flags. */
  async getForAdmin(key: SettingKey): Promise<Record<string, unknown>> {
    const raw = await this.loadRaw(key);
    const value = (await this.get(key)) as Record<string, unknown>;
    for (const field of SECRET_SETTING_FIELDS[key] ?? []) {
      value[`${field}Set`] = typeof raw[field] === 'string' && raw[field] !== '';
    }
    return value;
  }

  async update<K extends SettingKey>(
    key: K,
    patch: Partial<SettingValue<K>>,
    secrets: SecretPatch = {},
    actorId?: string,
  ): Promise<SettingValue<K>> {
    if (!SETTING_KEYS.includes(key)) throw AppError.notFound('Setting');
    // Read-merge-write under a row lock on the stored value (never the cache): concurrent edits of the same
    // group, or a secret rotated on another replica, cannot be reverted by a stale copy.
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO system_settings (key, value, "updatedAt") VALUES (${key}, '{}'::jsonb, now()) ON CONFLICT (key) DO NOTHING`;
      const rows = await tx.$queryRaw<
        { value: Stored }[]
      >`SELECT value FROM system_settings WHERE key = ${key} FOR UPDATE`;
      const current = rows[0]?.value ?? {};
      const merged = { ...this.withoutSecrets(key, current), ...patch };
      const parsed = SETTINGS_SCHEMAS[key].safeParse(merged);
      if (!parsed.success) {
        throw AppError.validation(
          'Invalid settings',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const next: Stored = { ...(parsed.data as Stored) };
      for (const field of SECRET_SETTING_FIELDS[key] ?? []) {
        const incoming = secrets[field];
        if (incoming === undefined || incoming === '') {
          // An empty input keeps the stored secret: clearing it must be explicit (null).
          if (typeof current[field] === 'string') {
            assertSecretStillBound(key, field, current, next);
            next[field] = current[field];
          }
        } else if (incoming !== null) {
          next[field] = this.encryption.encrypt(incoming, Aad.setting(`${key}.${field}`));
        }
      }
      await tx.systemSetting.update({
        where: { key },
        data: { value: next as Prisma.InputJsonValue, updatedById: actorId ?? null },
      });
      return parsed.data as SettingValue<K>;
    });
    await this.invalidate(key);
    return saved;
  }

  async invalidate(key: SettingKey | '*'): Promise<void> {
    if (key === '*') this.cache.clear();
    else this.cache.delete(key);
    await this.redis.client.publish(this.channel, key).catch(() => undefined);
  }

  private withoutSecrets(key: SettingKey, raw: Stored): Stored {
    const secretFields = SECRET_SETTING_FIELDS[key] ?? [];
    const out: Stored = {};
    for (const [k, v] of Object.entries(raw)) if (!secretFields.includes(k)) out[k] = v;
    return out;
  }
}

/**
 * Secrets that are sent to the configured server itself (SMTP AUTH transmits the password): keeping the stored
 * secret while pointing the settings at another server would hand it to that server, so it must be re-entered.
 */
const SECRET_BINDINGS: Partial<Record<SettingKey, Record<string, readonly string[]>>> = {
  smtp: { password: ['host', 'port', 'encryption', 'username'] },
};

function assertSecretStillBound(key: SettingKey, field: string, current: Stored, next: Stored): void {
  const changed = (SECRET_BINDINGS[key]?.[field] ?? []).filter((f) => f in current && current[f] !== next[f]);
  if (changed.length) {
    throw AppError.validation(
      `Enter the ${field} again: it is only kept while ${changed.join(', ')} stay the same`,
      [{ path: `secrets.${field}`, message: 'Required when the server settings change' }],
    );
  }
}
