import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AccountStatusJob, QUEUES } from '../../infra/queue/queues';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MetaConnectionFactory } from '../../modules/meta/meta-connection.factory';
import { MetaGraphClient } from '../../modules/meta/graph/meta-graph.client';
import { MetaApiError } from '../../modules/meta/graph/meta-errors';
import { MetaProfileStatusService } from '../../modules/meta/meta-profile-status.service';
import { AccountStatusService, MetaAdAccountData } from '../../modules/ad-accounts/account-status.service';
import { AD_ACCOUNT_STATUS_FIELDS, actId } from '../../modules/meta/meta-fields';
import { QueueProcessor } from '../processor';
import { handleMetaJobError } from '../meta-job-errors';

/**
 * ACCOUNT_STATUS_CHECK: reads up to 50 ad accounts per request (`?ids=`) and applies the result. A change
 * of `account_status` produces exactly one history row + notification (see AccountStatusService).
 */
@Injectable()
export class AccountStatusProcessor implements QueueProcessor {
  readonly queue = QUEUES.ACCOUNT_STATUS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: MetaConnectionFactory,
    private readonly graph: MetaGraphClient,
    private readonly statusService: AccountStatusService,
    private readonly profileStatus: MetaProfileStatusService,
  ) {}

  async process(job: Job<AccountStatusJob>, token?: string): Promise<unknown> {
    const { profileId, userId, adAccountIds } = job.data;
    const profile = await this.prisma.metaProfile.findFirst({
      where: { id: profileId, userId, deletedAt: null, isEnabled: true },
      include: { proxy: true },
    });
    if (!profile || profile.status !== 'ACTIVE') return { skipped: 'profile inactive' };
    const accounts = await this.prisma.adAccount.findMany({ where: { id: { in: adAccountIds }, profileId, isConnected: true } });
    if (!accounts.length) return { skipped: 'no accounts' };

    const conn = await this.connections.forProfile(profile);
    let changed = 0;
    try {
      let data: Record<string, MetaAdAccountData> = {};
      try {
        data = await this.graph.getMany<MetaAdAccountData>(conn, accounts.map((a) => actId(a.metaAccountId)), AD_ACCOUNT_STATUS_FIELDS, 'account.status');
      } catch (err) {
        // One inaccessible account fails the whole multi-id request: fall back to single reads.
        if (!(err instanceof MetaApiError) || err.category === 'RATE_LIMIT' || err.category === 'AUTH') throw err;
        for (const a of accounts) {
          try {
            data[actId(a.metaAccountId)] = await this.graph.get<MetaAdAccountData>(conn, `/${actId(a.metaAccountId)}`, { fields: AD_ACCOUNT_STATUS_FIELDS }, 'account.status', { metaAccountId: a.metaAccountId });
          } catch (inner) {
            if (inner instanceof MetaApiError && (inner.category === 'RATE_LIMIT' || inner.category === 'AUTH')) throw inner;
            await this.statusService.markCheckFailed([a.id], inner instanceof MetaApiError ? inner.details.friendlyMessage : String(inner));
          }
        }
      }
      for (const a of accounts) {
        const d = data[actId(a.metaAccountId)];
        if (!d) continue;
        const res = await this.statusService.apply(a, d, { notify: true });
        if (res.changed) changed++;
      }
      return { checked: accounts.length, changed };
    } catch (err) {
      if (err instanceof MetaApiError && err.category !== 'RATE_LIMIT') {
        await this.statusService.markCheckFailed(accounts.map((a) => a.id), err.details.friendlyMessage);
      }
      return handleMetaJobError(err, job, token, { profileId, profileStatus: this.profileStatus, tokenFingerprint: conn.tokenFingerprint });
    }
  }
}
