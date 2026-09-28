import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  META_PROFILE_STATUS_LABELS,
  metaConnectionTestSchema,
  metaProfileCreateSchema,
  metaProfileUpdateSchema,
  type ProxyInput,
  type ProxyTestResult,
  type TokenInspection,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { QueueService, jobId } from '../../infra/queue/queue.service';
import { JOBS, QUEUES } from '../../infra/queue/queues';
import { maskSecret } from '../../infra/logger/sanitize';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { MetaConnectionFactory } from '../meta/meta-connection.factory';
import { TokenInspectorService } from '../meta/token-inspector.service';
import { MetaProfileStatusService } from '../meta/meta-profile-status.service';
import { Prisma } from '../../generated/prisma/client';

type CreateInput = z.infer<typeof metaProfileCreateSchema>;
type UpdateInput = z.infer<typeof metaProfileUpdateSchema>;
type TestInput = z.infer<typeof metaConnectionTestSchema>;

const PROFILE_INCLUDE = {
  proxy: true,
  _count: {
    select: {
      businessAccounts: true,
      adAccounts: true,
      pages: true,
    },
  },
} satisfies Prisma.MetaProfileInclude;

type ProfileRow = Prisma.MetaProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

@Injectable()
export class MetaProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly hashing: HashingService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly connections: MetaConnectionFactory,
    private readonly inspector: TokenInspectorService,
    private readonly status: MetaProfileStatusService,
  ) {}

  // ───────────── queries ─────────────

  async list(userId: string) {
    const rows = await this.prisma.metaProfile.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: PROFILE_INCLUDE,
    });
    const connected = await this.prisma.adAccount.groupBy({
      by: ['profileId'],
      where: { userId, isConnected: true },
      _count: { _all: true },
    });
    const connectedMap = new Map(connected.map((c) => [c.profileId, c._count._all]));
    return rows.map((r) => this.toDto(r, connectedMap.get(r.id) ?? 0));
  }

  async get(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    const connected = await this.prisma.adAccount.count({ where: { profileId: id, isConnected: true } });
    return this.toDto(row, connected);
  }

  /** Ownership-checked lookup — every profile access goes through here (no IDOR). */
  async findOwned(userId: string, id: string): Promise<ProfileRow> {
    const row = await this.prisma.metaProfile.findFirst({ where: { id, userId, deletedAt: null }, include: PROFILE_INCLUDE });
    if (!row) throw AppError.notFound('Meta profile');
    return row;
  }

  async connectionFor(userId: string, id: string) {
    const row = await this.findOwned(userId, id);
    return { profile: row, conn: await this.connections.forProfile(row) };
  }

  // ───────────── mutations ─────────────

  async create(userId: string, input: CreateInput) {
    if (input.proxy) await this.connections.assertProxyAllowed(input.proxy.host);
    const fingerprint = this.hashing.fingerprint(input.accessToken);
    const duplicate = await this.prisma.metaProfile.findFirst({ where: { userId, tokenFingerprint: fingerprint, deletedAt: null }, select: { name: true } });
    if (duplicate) throw AppError.conflict(`This token is already connected in the profile "${duplicate.name}"`);

    const profileId = randomUUID();
    const proxyId = input.proxy ? randomUUID() : null;
    await this.prisma.$transaction(async (tx) => {
      if (input.proxy && proxyId) {
        await tx.proxy.create({ data: this.proxyData(userId, proxyId, input.proxy) as Prisma.ProxyUncheckedCreateInput });
      }
      await tx.metaProfile.create({
        data: {
          id: profileId,
          userId,
          name: input.name,
          notes: input.notes ?? null,
          tokenEnc: this.encryption.encrypt(input.accessToken, Aad.metaToken(profileId)),
          tokenMask: maskSecret(input.accessToken),
          tokenFingerprint: fingerprint,
          appId: input.appId ?? null,
          appSecretEnc: input.appSecret ? this.encryption.encrypt(input.appSecret, Aad.metaAppSecret(profileId)) : null,
          proxyId,
          nextTokenCheckAt: new Date(Date.now() + 12 * 3600_000),
        },
      });
    });
    await this.audit.log({
      action: 'meta_profile.created',
      actorUserId: userId,
      subjectUserId: userId,
      targetType: 'meta_profile',
      targetId: profileId,
      metadata: { name: input.name, proxy: input.proxy ? { type: input.proxy.type, host: input.proxy.host, port: input.proxy.port } : null },
    });

    const inspection = await this.validate(userId, profileId);
    if (inspection.valid) await this.requestSync(userId, profileId, 'created');
    return { profile: await this.get(userId, profileId), inspection };
  }

  async update(userId: string, id: string, input: UpdateInput) {
    if (input.proxy) await this.connections.assertProxyAllowed(input.proxy.host);
    const current = await this.findOwned(userId, id);
    const data: Prisma.MetaProfileUpdateInput = {};
    const audited: string[] = [];
    if (input.name !== undefined) data.name = input.name;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (input.accessToken) {
      const fingerprint = this.hashing.fingerprint(input.accessToken);
      const duplicate = await this.prisma.metaProfile.findFirst({
        where: { userId, tokenFingerprint: fingerprint, deletedAt: null, id: { not: id } },
        select: { name: true },
      });
      if (duplicate) throw AppError.conflict(`This token is already connected in the profile "${duplicate.name}"`);
      Object.assign(data, {
        tokenEnc: this.encryption.encrypt(input.accessToken, Aad.metaToken(id)),
        tokenMask: maskSecret(input.accessToken),
        tokenFingerprint: fingerprint,
        status: 'UNCHECKED',
        tokenAppId: null,
        tokenScopes: [],
        expiryWarnedAt: null,
      });
      audited.push('token');
    }
    if (input.appId !== undefined) {
      data.appId = input.appId;
      audited.push('appId');
    }
    if (input.appSecret !== undefined) {
      data.appSecretEnc = input.appSecret ? this.encryption.encrypt(input.appSecret, Aad.metaAppSecret(id)) : null;
      audited.push('appSecret');
    }
    if (input.proxy !== undefined) {
      audited.push('proxy');
      if (input.proxy === null) {
        data.proxy = { disconnect: true };
      } else if (current.proxyId) {
        await this.prisma.proxy.update({
          where: { id: current.proxyId },
          data: this.proxyData(userId, current.proxyId, input.proxy, true),
        });
      } else {
        const proxyId = randomUUID();
        await this.prisma.proxy.create({ data: this.proxyData(userId, proxyId, input.proxy) as Prisma.ProxyUncheckedCreateInput });
        data.proxy = { connect: { id: proxyId } };
      }
    }
    await this.prisma.metaProfile.update({ where: { id }, data });
    if (input.proxy === null && current.proxyId) await this.deleteProxyIfUnused(current.proxyId);

    for (const field of audited) {
      await this.audit.log({
        action: field === 'token' ? 'meta_profile.token_updated' : field === 'proxy' ? 'meta_profile.proxy_updated' : 'meta_profile.app_updated',
        actorUserId: userId,
        subjectUserId: userId,
        targetType: 'meta_profile',
        targetId: id,
      });
    }
    let inspection: TokenInspection | undefined;
    if (input.accessToken || input.proxy !== undefined || input.appSecret !== undefined) {
      inspection = await this.validate(userId, id);
      if (input.accessToken && inspection.valid) await this.requestSync(userId, id, 'manual');
    }
    return { profile: await this.get(userId, id), inspection };
  }

  /**
   * Soft delete: the row stays for the audit trail but the token, app secret and proxy password are
   * destroyed, connected ad accounts stop being monitored and rules on them stop acting.
   */
  async remove(userId: string, id: string): Promise<void> {
    const current = await this.findOwned(userId, id);
    await this.prisma.$transaction([
      this.prisma.metaProfile.update({
        where: { id },
        data: { tokenEnc: null, appSecretEnc: null, tokenMask: '[deleted]', isEnabled: false, deletedAt: new Date(), proxyId: null },
      }),
      this.prisma.adAccount.updateMany({ where: { profileId: id }, data: { isConnected: false } }),
    ]);
    if (current.proxyId) await this.deleteProxyIfUnused(current.proxyId);
    await this.audit.log({ action: 'meta_profile.deleted', actorUserId: userId, subjectUserId: userId, targetType: 'meta_profile', targetId: id, metadata: { name: current.name } });
  }

  // ───────────── validation & tests ─────────────

  async validate(userId: string, id: string): Promise<TokenInspection> {
    const { conn } = await this.connectionFor(userId, id);
    const inspection = await this.inspector.inspect(conn);
    await this.status.applyInspection(id, inspection);
    return inspection;
  }

  /** Test token/proxy BEFORE saving: nothing is persisted, the token is only kept in memory. */
  async testUnsaved(userId: string, input: TestInput): Promise<{ token?: TokenInspection; proxy?: ProxyTestResult }> {
    const out: { token?: TokenInspection; proxy?: ProxyTestResult } = {};
    if (input.proxy) {
      const blocked = await this.connections.proxyPolicyViolation(input.proxy.host);
      if (blocked) return { proxy: { ok: false, message: blocked } };
      out.proxy = await this.inspector.testProxy({
        type: input.proxy.type,
        host: input.proxy.host,
        port: input.proxy.port,
        username: input.proxy.username ?? null,
        password: input.proxy.password ?? null,
      });
      if (!out.proxy.ok) return out;
    }
    if (input.accessToken) {
      out.token = await this.inspector.inspect(await this.connections.forTest(userId, { ...input, accessToken: input.accessToken }));
    }
    return out;
  }

  async testProxy(userId: string, id: string): Promise<ProxyTestResult> {
    const profile = await this.findOwned(userId, id);
    if (!profile.proxy) return { ok: true, message: 'No proxy configured: direct connection is used.' };
    const blocked = await this.connections.proxyPolicyViolation(profile.proxy.host);
    const result = blocked ? { ok: false, message: blocked } : await this.inspector.testProxy(this.connections.proxyConfig(profile.proxy));
    await this.prisma.proxy.update({
      where: { id: profile.proxy.id },
      data: { lastTestAt: new Date(), lastTestOk: result.ok, lastTestError: result.ok ? null : result.message, lastTestLatencyMs: result.latencyMs ?? null },
    });
    return result;
  }

  async requestSync(userId: string, id: string, reason: 'manual' | 'scheduled' | 'created'): Promise<{ queued: boolean }> {
    const profile = await this.findOwned(userId, id);
    if (profile.status !== 'ACTIVE' && reason !== 'created') {
      throw AppError.conflict(`The profile token is ${META_PROFILE_STATUS_LABELS[profile.status].toLowerCase()}; fix the token first`);
    }
    await this.prisma.metaProfile.update({ where: { id }, data: { syncStatus: 'QUEUED' } });
    // Unique job per request: the worker coalesces redundant syncs (see MetaSyncProcessor).
    await this.queue.add(QUEUES.META_SYNC, JOBS.META_SYNC, { profileId: id, userId, reason }, { jobId: jobId('meta-sync', id, randomUUID()) });
    return { queued: true };
  }

  // ───────────── helpers ─────────────

  private proxyData(userId: string, proxyId: string, p: ProxyInput, isUpdate = false) {
    const base: Record<string, unknown> = {
      type: p.type,
      host: p.host,
      port: p.port,
      username: p.username || null,
      lastTestAt: null,
      lastTestOk: null,
      lastTestError: null,
    };
    if (!isUpdate) Object.assign(base, { id: proxyId, userId });
    if (p.password !== undefined) base.passwordEnc = p.password ? this.encryption.encrypt(p.password, Aad.proxyPassword(proxyId)) : null;
    return base;
  }

  private async deleteProxyIfUnused(proxyId: string): Promise<void> {
    const used = await this.prisma.metaProfile.count({ where: { proxyId } });
    if (!used) await this.prisma.proxy.delete({ where: { id: proxyId } }).catch(() => undefined);
  }

  private toDto(r: ProfileRow, connectedAdAccounts: number) {
    return {
      id: r.id,
      name: r.name,
      notes: r.notes,
      status: r.status,
      statusLabel: META_PROFILE_STATUS_LABELS[r.status],
      isEnabled: r.isEnabled,
      tokenMask: r.tokenMask,
      tokenType: r.tokenType,
      tokenExpiresAt: r.tokenExpiresAt,
      dataAccessExpiresAt: r.dataAccessExpiresAt,
      tokenScopes: r.tokenScopes,
      tokenAppId: r.tokenAppId,
      metaUserId: r.metaUserId,
      metaUserName: r.metaUserName,
      appId: r.appId,
      hasAppSecret: !!r.appSecretEnc,
      proxy: r.proxy
        ? {
            id: r.proxy.id,
            type: r.proxy.type,
            host: r.proxy.host,
            port: r.proxy.port,
            username: r.proxy.username,
            hasPassword: !!r.proxy.passwordEnc,
            lastTestAt: r.proxy.lastTestAt,
            lastTestOk: r.proxy.lastTestOk,
            lastTestError: r.proxy.lastTestError,
            lastTestLatencyMs: r.proxy.lastTestLatencyMs,
          }
        : null,
      lastValidatedAt: r.lastValidatedAt,
      lastValidationError: r.lastValidationError,
      syncStatus: r.syncStatus,
      lastSyncAt: r.lastSyncAt,
      syncError: r.syncError,
      counts: {
        businesses: r._count.businessAccounts,
        adAccounts: r._count.adAccounts,
        connectedAdAccounts,
        pages: r._count.pages,
      },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
