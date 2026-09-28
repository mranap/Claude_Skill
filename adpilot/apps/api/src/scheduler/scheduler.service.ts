import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { hostname } from 'node:os';
import { LockHandle, LockService } from '../infra/locks/lock.service';
import { RedisService } from '../infra/redis/redis.service';
import { SystemLogService } from '../modules/system-log/system-log.service';
import { RequestContext } from '../common/context/request-context';
import { AppLogger } from '../infra/logger/logger';
import { SCHEDULER_TASKS, SchedulerTask } from './scheduler-task';

const LEADER_LOCK = 'scheduler:leader';
const LEADER_TTL_MS = 30_000;
/** Leadership is renewed well within its TTL, also while a long tick is running. */
const LEADER_RENEW_MS = 10_000;
const TICK_MS = 15_000;

/**
 * Server-side scheduler (independent of any browser). Several replicas may run for availability: a Redis
 * leader lock guarantees that only one of them executes tasks. Tasks only *enqueue* jobs; the heavy work is
 * done by the workers. All due-work claiming is atomic in PostgreSQL (see the individual tasks), so even a
 * split-brain moment cannot enqueue the same work twice (BullMQ job ids are deterministic as well).
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new AppLogger('Scheduler');
  private lock: LockHandle | null = null;
  /** The lock is ours until then (TTL counted from the last successful acquire/renewal). */
  private leaseUntil = 0;
  private timer: NodeJS.Timeout | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly lastRun = new Map<string, number>();

  constructor(
    @Inject(SCHEDULER_TASKS) private readonly tasks: SchedulerTask[],
    private readonly locks: LockService,
    private readonly redis: RedisService,
    private readonly systemLog: SystemLogService,
  ) {}

  get isLeader(): boolean {
    return this.lock !== null && Date.now() < this.leaseUntil;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.renewTimer = setInterval(() => void this.renew(), LEADER_RENEW_MS);
    void this.tick();
  }

  private tick(): Promise<void> {
    if (this.running || this.stopped) return this.running ?? Promise.resolve();
    this.running = this.runTasks()
      .catch((err: unknown) => this.logger.warn('Scheduler tick failed', { err: String(err) }))
      .finally(() => (this.running = null));
    return this.running;
  }

  private async runTasks(): Promise<void> {
    if (!(await this.ensureLeadership())) return;
    await this.redis.client.set(
      this.redis.key('scheduler', 'hb'),
      JSON.stringify({
        host: hostname(),
        pid: process.pid,
        at: new Date().toISOString(),
        tasks: this.tasks.map((t) => t.name),
      }),
      'EX',
      60,
    );
    const now = Date.now();
    for (const task of this.tasks) {
      // Checked before every task: a replica that lost the lock mid-tick stops instead of running next to the new leader.
      if (this.stopped || !this.isLeader) break;
      const last = this.lastRun.get(task.name) ?? 0;
      if (now - last < task.everyMs) continue;
      this.lastRun.set(task.name, now);
      await RequestContext.run({ requestId: `scheduler:${task.name}:${now}` }, async () => {
        try {
          await task.run();
        } catch (err) {
          await this.systemLog.error('scheduler', `Task ${task.name} failed: ${(err as Error).message}`, {
            task: task.name,
          });
        }
      });
    }
  }

  private async ensureLeadership(): Promise<boolean> {
    if (this.lock && (await this.renew())) return true;
    const lock = await this.locks.acquire(LEADER_LOCK, LEADER_TTL_MS);
    if (lock) {
      this.lock = lock;
      this.leaseUntil = Date.now() + LEADER_TTL_MS;
      this.logger.info('Acquired scheduler leadership', { host: hostname(), pid: process.pid });
    }
    return lock !== null;
  }

  /**
   * Extends the leader lock (every LEADER_RENEW_MS and at each tick). A refused extension ends leadership at
   * once; a Redis error keeps it only until the current lease runs out, like the lock itself.
   */
  private async renew(): Promise<boolean> {
    const lock = this.lock;
    if (!lock) return false;
    const started = Date.now();
    let extended: boolean;
    try {
      extended = await this.locks.extend(lock, LEADER_TTL_MS);
    } catch {
      return this.isLeader;
    }
    if (this.lock !== lock) return false;
    if (extended) {
      this.leaseUntil = started + LEADER_TTL_MS;
      return true;
    }
    this.logger.warn('Lost scheduler leadership');
    this.lock = null;
    return false;
  }

  /**
   * Shutdown phase 1: stop ticking, let the running task finish while leadership is still renewed (the jobs
   * it enqueues must reach Redis before the queues close in phase 2), then hand leadership over.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
    if (this.renewTimer) clearInterval(this.renewTimer);
    const lock = this.lock;
    this.lock = null;
    if (lock) await this.locks.release(lock).catch(() => undefined);
  }
}
