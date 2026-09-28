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
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private readonly lastRun = new Map<string, number>();

  constructor(
    @Inject(SCHEDULER_TASKS) private readonly tasks: SchedulerTask[],
    private readonly locks: LockService,
    private readonly redis: RedisService,
    private readonly systemLog: SystemLogService,
  ) {}

  get isLeader(): boolean {
    return this.lock !== null;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      if (!(await this.ensureLeadership())) return;
      await this.redis.client.set(
        this.redis.key('scheduler', 'hb'),
        JSON.stringify({ host: hostname(), pid: process.pid, at: new Date().toISOString(), tasks: this.tasks.map((t) => t.name) }),
        'EX',
        60,
      );
      const now = Date.now();
      for (const task of this.tasks) {
        if (this.stopped || !this.lock) break;
        const last = this.lastRun.get(task.name) ?? 0;
        if (now - last < task.everyMs) continue;
        this.lastRun.set(task.name, now);
        await RequestContext.run({ requestId: `scheduler:${task.name}:${now}` }, async () => {
          try {
            await task.run();
          } catch (err) {
            await this.systemLog.error('scheduler', `Task ${task.name} failed: ${(err as Error).message}`, { task: task.name });
          }
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async ensureLeadership(): Promise<boolean> {
    if (this.lock) {
      if (await this.locks.extend(this.lock, LEADER_TTL_MS)) return true;
      this.logger.warn('Lost scheduler leadership');
      this.lock = null;
    }
    this.lock = await this.locks.acquire(LEADER_LOCK, LEADER_TTL_MS);
    if (this.lock) this.logger.info('Acquired scheduler leadership', { host: hostname(), pid: process.pid });
    return this.lock !== null;
  }

  /** Shutdown phase 1: stop ticking and hand leadership over immediately (Redis is still connected). */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.lock) await this.locks.release(this.lock).catch(() => undefined);
  }
}
