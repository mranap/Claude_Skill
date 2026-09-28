import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BackupTask, OutboxSweepTask } from '../../src/scheduler/tasks/platform.tasks';
import { QueueService, jobId } from '../../src/infra/queue/queue.service';
import { JOBS, QUEUES } from '../../src/infra/queue/queues';
import { bulkJobId } from '../../src/modules/campaigns/bulk-actions.service';
import { TestStack, type TestUser } from '../support/harness';
import { ApiClient, expectStatus } from '../support/http-client';

const MINUTE = 60_000;

describe('recovery of interrupted background work', () => {
  const stack = new TestStack();
  let admin: ApiClient;
  let user: TestUser;
  let accountId: string;
  let metaAccountId: string;
  const queues = () => stack.api.get(QueueService);
  const jobState = async (queue: (typeof QUEUES)[keyof typeof QUEUES], id: string) =>
    (await queues().queue(queue).getJob(id))?.getState();
  const key = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await stack.start({ worker: true, scheduler: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    await stack.configureSmtp();
    admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    const world = stack.meta.seed();
    metaAccountId = world.accountIds[0]!;
    const profileId = expectStatus(
      await user.client.post('/api/meta-profiles', { name: 'Recovery BM', accessToken: world.token }),
      201,
    ).body.profile.id;
    await stack.waitFor(async () => (await stack.prisma.adAccount.count({ where: { profileId } })) === 2);
    expectStatus(
      await user.client.post('/api/ad-accounts/connect', { profileId, connect: [metaAccountId] }),
      200,
    );
    accountId = (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId } })).id;
  });
  afterAll(() => stack.stop());

  describe('bulk actions', () => {
    /** An active campaign that exists in Meta and in the local mirror. */
    async function campaign(name: string) {
      const meta = stack.meta.createObject('campaign', metaAccountId, {
        name,
        objective: 'OUTCOME_LEADS',
        status: 'ACTIVE',
        special_ad_categories: [],
      });
      const row = await stack.prisma.campaign.create({
        data: {
          userId: user.id,
          adAccountId: accountId,
          metaCampaignId: meta.id,
          name,
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
        },
      });
      return { id: row.id, meta };
    }

    const finished = (id: string) =>
      stack.waitFor(
        async () => {
          const op = await stack.prisma.bulkOperation.findUniqueOrThrow({ where: { id } });
          return op.status === 'SUCCESS' || op.status === 'FAILED' ? op : null;
        },
        { message: 'bulk operation did not finish' },
      );

    it('an inline bulk action stopped by a Meta rate limit is continued by the queue', async () => {
      const a = await campaign('Inline A');
      const b = await campaign('Inline B');
      stack.meta.inject({
        match: /^POST \/\d+$/,
        times: 1,
        kind: 'error',
        status: 400,
        error: {
          code: 17,
          error_subcode: 2446079,
          message: 'User request limit reached',
          type: 'OAuthException',
          is_transient: true,
        },
      });
      const body = {
        level: 'CAMPAIGN',
        ids: [a.id, b.id],
        status: 'PAUSED',
        idempotencyKey: key('inline'),
        confirmed: true,
      };
      const op = expectStatus(await user.client.post('/api/campaigns/actions/bulk-status', body), 202).body;
      expect(op.status).toBe('RUNNING');
      // Not left alone: the rest waits in the queue for the cool-down.
      expect(await jobState(QUEUES.BULK_ACTIONS, bulkJobId(op.id))).toBe('delayed');

      await stack.clearMetaRateLimits();
      await stack.promoteDelayed(QUEUES.BULK_ACTIONS);
      expect(await finished(op.id)).toMatchObject({ status: 'SUCCESS', succeeded: 2, failed: 0 });
      expect([a.meta.fields.status, b.meta.fields.status]).toEqual(['PAUSED', 'PAUSED']);
      // Replaying the idempotency key returns the finished operation.
      expect(
        expectStatus(await user.client.post('/api/campaigns/actions/bulk-status', body), 202).body,
      ).toMatchObject({ id: op.id, status: 'SUCCESS' });
    });

    it('an operation left RUNNING without a job (the API stopped mid-run) is queued again and finished', async () => {
      const c = await campaign('Orphaned');
      const op = await stack.prisma.bulkOperation.create({
        data: {
          userId: user.id,
          idempotencyKey: key('orphan'),
          level: 'CAMPAIGN',
          action: 'PAUSE',
          targetIds: [c.id],
          total: 1,
          status: 'RUNNING',
          createdAt: new Date(Date.now() - 10 * MINUTE),
        },
      });
      await stack.runTask(OutboxSweepTask);
      expect(await finished(op.id)).toMatchObject({ status: 'SUCCESS', succeeded: 1 });
      expect(c.meta.fields.status).toBe('PAUSED');
    });

    it('an operation whose job ran out of attempts is closed instead of staying RUNNING', async () => {
      const confirmed = await campaign('Confirmed');
      const open = await campaign('Unconfirmed');
      const op = await stack.prisma.bulkOperation.create({
        data: {
          userId: user.id,
          idempotencyKey: key('exhausted'),
          level: 'CAMPAIGN',
          action: 'PAUSE',
          targetIds: [confirmed.id, open.id],
          total: 2,
          status: 'RUNNING',
          results: [{ id: confirmed.id, ok: true, changed: true }],
          succeeded: 1,
          createdAt: new Date(Date.now() - 10 * MINUTE),
        },
      });
      // The operation's job fails for good (here it points at an operation that does not exist).
      await queues().add(
        QUEUES.BULK_ACTIONS,
        JOBS.BULK_ACTION,
        { bulkOperationId: randomUUID(), userId: user.id },
        { jobId: bulkJobId(op.id), attempts: 1 },
      );
      await stack.waitFor(async () => (await jobState(QUEUES.BULK_ACTIONS, bulkJobId(op.id))) === 'failed');

      await stack.runTask(OutboxSweepTask);
      const closed = await stack.prisma.bulkOperation.findUniqueOrThrow({ where: { id: op.id } });
      expect(closed).toMatchObject({ status: 'SUCCESS', succeeded: 1, failed: 1 });
      expect(closed.finishedAt).not.toBeNull();
      const results = closed.results as { id: string; ok: boolean; error?: string }[];
      expect(results.find((r) => r.id === open.id)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^Not confirmed: the operation stopped/),
      });
      expect(open.meta.fields.status).toBe('ACTIVE');
    });
  });

  describe('database backups', () => {
    const finished = (id: string) =>
      stack.waitFor(
        async () => {
          const b = await stack.prisma.backup.findUniqueOrThrow({ where: { id } });
          return b.status === 'SUCCESS' || b.status === 'FAILED' ? b : null;
        },
        { timeoutMs: 60_000, message: 'backup did not finish' },
      );

    it('backups abandoned by their worker (or never started) no longer block new backups', async () => {
      const dead = await stack.prisma.backup.create({
        data: {
          kind: 'DATABASE',
          status: 'RUNNING',
          triggeredById: randomUUID(),
          startedAt: new Date(Date.now() - 20 * MINUTE),
          heartbeatAt: new Date(Date.now() - 10 * MINUTE),
        },
      });
      const lost = await stack.prisma.backup.create({
        data: {
          kind: 'DATABASE',
          status: 'QUEUED',
          triggeredById: randomUUID(),
          startedAt: new Date(Date.now() - 2 * 60 * MINUTE),
        },
      });
      const { id } = expectStatus(await admin.post('/api/admin/backups'), 202).body;
      expect(await stack.prisma.backup.findUniqueOrThrow({ where: { id: dead.id } })).toMatchObject({
        status: 'FAILED',
        error: expect.stringMatching(/worker stopped/),
      });
      expect(await stack.prisma.backup.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({
        status: 'FAILED',
        error: expect.stringMatching(/did not start/),
      });
      const backup = await finished(id);
      expect(backup.status, backup.error ?? '').toBe('SUCCESS');
      expect(backup.heartbeatAt).not.toBeNull();
    });

    it('concurrent backup requests start exactly one backup', async () => {
      const [a, b] = await Promise.all([admin.post('/api/admin/backups'), admin.post('/api/admin/backups')]);
      expect([a.status, b.status].sort()).toEqual([202, 409]);
      const started = a.status === 202 ? a : b;
      expect((await finished(started.body.id)).status).toBe('SUCCESS');
    });

    it('the scheduled backup runs once a day and never next to another running backup', async () => {
      const scheduled = () => stack.prisma.backup.findMany({ where: { triggeredById: null } });
      const dueNow = () => stack.setSettings('backups', { enabled: true, hourUtc: new Date().getUTCHours() });
      const manual = await stack.prisma.backup.create({
        data: { kind: 'DATABASE', status: 'RUNNING', triggeredById: randomUUID(), heartbeatAt: new Date() },
      });
      await dueNow();
      await stack.runTask(BackupTask);
      expect(await scheduled()).toHaveLength(0);

      await stack.prisma.backup.update({
        where: { id: manual.id },
        data: { status: 'SUCCESS', finishedAt: new Date() },
      });
      await dueNow();
      await Promise.all([stack.runTask(BackupTask), stack.runTask(BackupTask)]);
      const rows = await scheduled();
      expect(rows).toHaveLength(1);
      expect((await finished(rows[0].id)).status).toBe('SUCCESS');
      await stack.runTask(BackupTask);
      expect(await scheduled()).toHaveLength(1);
      await stack.setSettings('backups', { enabled: false });
    });
  });

  describe('notification outbox', () => {
    it('re-queues a PENDING delivery whose earlier job already failed (its id is still in the failed set)', async () => {
      const past = new Date(Date.now() - 5 * MINUTE);
      const n = await stack.prisma.notification.create({
        data: {
          userId: user.id,
          type: 'SYSTEM_MESSAGE',
          title: 'Revived delivery',
          body: 'Sent after all',
          createdAt: past,
        },
      });
      const d = await stack.prisma.notificationDelivery.create({
        data: { notificationId: n.id, userId: user.id, channel: 'EMAIL', createdAt: past, updatedAt: past },
      });
      // The delivery's job failed for good while the row stayed PENDING (e.g. the claim failed on every attempt).
      await queues().add(
        QUEUES.EMAIL,
        JOBS.EMAIL_SEND,
        { kind: 'sealed', sealed: 'enc1:damaged', tag: 'test' },
        { jobId: jobId('delivery', d.id), attempts: 1 },
      );
      await stack.waitFor(async () => (await jobState(QUEUES.EMAIL, jobId('delivery', d.id))) === 'failed');
      expect(
        (await stack.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).status,
      ).toBe('PENDING');

      await stack.runTask(OutboxSweepTask);
      await stack.smtp.waitFor((m) => m.to.includes(user.email) && /Revived delivery/.test(m.subject));
      await stack.waitFor(
        async () =>
          (await stack.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).status ===
          'SENT',
      );
    });
  });
});
