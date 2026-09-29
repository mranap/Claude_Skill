import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AppError } from '../../common/errors/app-error';
import { MetaConnectionFactory } from '../meta/meta-connection.factory';
import { MetaGraphClient, type MetaConnection } from '../meta/graph/meta-graph.client';
import { MetaApiError } from '../meta/graph/meta-errors';

export interface InterestHit {
  id: string;
  name: string;
  path: string[];
  audienceSizeLower: number | null;
  audienceSizeUpper: number | null;
}

export interface LocaleHit {
  key: number;
  name: string;
}

export interface LeadForm {
  id: string;
  name: string;
  /** ACTIVE, ARCHIVED, DELETED or DRAFT; only ACTIVE forms can be used in ads. */
  status: string;
  locale: string | null;
}

const CACHE_TTL_S = 24 * 3600;

/**
 * Look-ups the campaign builder needs from Meta: interests and languages (Targeting Search, `GET /search`) and
 * the Instant Forms of a Page (`GET /{page-id}/leadgen_forms`). Calls go through the ad account's profile
 * connection (its proxy, rate limits and API log). Targeting results are public reference data and are cached
 * for a day; nothing tenant-specific is shared.
 */
@Injectable()
export class TargetingLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly connections: MetaConnectionFactory,
    private readonly graph: MetaGraphClient,
  ) {}

  async interests(userId: string, adAccountId: string, q: string): Promise<InterestHit[]> {
    const conn = await this.connection(userId, adAccountId);
    return this.cached('adinterest', q, async () => {
      const res = await this.graph.get<{ data?: RawInterest[] }>(
        conn,
        '/search',
        { type: 'adinterest', q, limit: 25 },
        'targeting.search',
      );
      return (res.data ?? []).map((i) => ({
        id: String(i.id),
        name: i.name,
        path: i.path ?? [],
        audienceSizeLower: i.audience_size_lower_bound ?? null,
        audienceSizeUpper: i.audience_size_upper_bound ?? null,
      }));
    });
  }

  /** An empty query lists every targetable language (Meta: `q=` with a large limit). */
  async locales(userId: string, adAccountId: string, q: string): Promise<LocaleHit[]> {
    const conn = await this.connection(userId, adAccountId);
    return this.cached('adlocale', q, async () => {
      const res = await this.graph.get<{ data?: { key: number; name: string }[] }>(
        conn,
        '/search',
        { type: 'adlocale', q, limit: q ? 50 : 1000 },
        'targeting.search',
      );
      return (res.data ?? []).map((l) => ({ key: Number(l.key), name: l.name }));
    });
  }

  /**
   * Instant Forms of one of the profile's Pages. Meta serves them only with a Page access token (the person
   * behind the token needs a Page task that allows advertising, and the `pages_manage_ads` permission); the
   * Page token is requested for this call and kept in memory only.
   */
  async leadForms(userId: string, adAccountId: string, metaPageId: string): Promise<LeadForm[]> {
    const account = await this.account(userId, adAccountId);
    const page = await this.prisma.page.findFirst({
      where: { userId, profileId: account.profileId, metaPageId },
      select: { id: true },
    });
    if (!page) throw AppError.notFound('Page');
    const conn = await this.connections.forProfile(account.profile);
    try {
      const { access_token: pageToken } = await this.graph.get<{ access_token?: string }>(
        conn,
        `/${metaPageId}`,
        { fields: 'access_token' },
        'page.token',
      );
      if (!pageToken) throw new AppError('META_PERMISSION_ERROR', NO_PAGE_ACCESS);
      const pageConn: MetaConnection = { ...conn, accessToken: pageToken, tokenFingerprint: undefined };
      const forms = await this.graph.paginate<{
        id: string;
        name?: string;
        status?: string;
        locale?: string;
      }>(
        pageConn,
        `/${metaPageId}/leadgen_forms`,
        { fields: 'id,name,status,locale' },
        'page.leadgen_forms',
        {},
        500,
      );
      return forms
        .filter((f) => f.status !== 'DELETED')
        .map((f) => ({
          id: f.id,
          name: f.name ?? f.id,
          status: f.status ?? 'ACTIVE',
          locale: f.locale ?? null,
        }))
        .sort(
          (a, b) =>
            Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || a.name.localeCompare(b.name),
        );
    } catch (err) {
      // Optional helper: a missing Page permission must not affect the profile's status, only this list.
      if (err instanceof MetaApiError && (err.category === 'PERMISSION' || err.category === 'AUTH')) {
        throw new AppError('META_PERMISSION_ERROR', NO_PAGE_ACCESS, undefined, { meta: err.details });
      }
      throw toAppError(err);
    }
  }

  private async account(userId: string, adAccountId: string) {
    const account = await this.prisma.adAccount.findFirst({
      where: { id: adAccountId, userId },
      include: { profile: { include: { proxy: true } } },
    });
    if (!account) throw AppError.notFound('Ad account');
    if (account.profile.deletedAt || account.profile.status !== 'ACTIVE') {
      throw new AppError('META_AUTH_ERROR', 'The Meta profile of this ad account is not active');
    }
    return account;
  }

  private async connection(userId: string, adAccountId: string): Promise<MetaConnection> {
    return this.connections.forProfile((await this.account(userId, adAccountId)).profile);
  }

  private async cached<T>(type: string, q: string, load: () => Promise<T>): Promise<T> {
    const key = this.redis.key(
      'targeting',
      type,
      createHash('sha256').update(q.trim().toLowerCase()).digest('hex').slice(0, 32),
    );
    const hit = await this.redis.client.get(key);
    if (hit) return JSON.parse(hit) as T;
    let value: T;
    try {
      value = await load();
    } catch (err) {
      throw toAppError(err);
    }
    await this.redis.client.set(key, JSON.stringify(value), 'EX', CACHE_TTL_S);
    return value;
  }
}

interface RawInterest {
  id: string | number;
  name: string;
  path?: string[];
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
}

const NO_PAGE_ACCESS =
  'Meta did not return the Instant Forms of this Page. Listing them needs the pages_manage_ads permission on the token and a Page role that can advertise. You can still paste the form ID.';

function toAppError(err: unknown): unknown {
  if (!(err instanceof MetaApiError)) return err;
  const code = err.category === 'RATE_LIMIT' ? 'META_RATE_LIMITED' : 'META_API_ERROR';
  return new AppError(code, err.details.friendlyMessage, undefined, {
    meta: err.details,
    retryAfterSeconds: err.details.retryAfterMs ? Math.ceil(err.details.retryAfterMs / 1000) : undefined,
    cause: err,
  });
}
