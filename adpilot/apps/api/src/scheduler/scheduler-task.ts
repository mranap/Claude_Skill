/** A periodic task executed by the scheduler leader. */
export interface SchedulerTask {
  readonly name: string;
  /** How often the task runs (the scheduler ticks every 15 s). */
  readonly everyMs: number;
  run(): Promise<void>;
}

export const SCHEDULER_TASKS = Symbol('SCHEDULER_TASKS');

/** Deterministic slot id used for job deduplication, e.g. minute or day buckets. */
export function slot(date: Date, granularityMs: number): string {
  return String(Math.floor(date.getTime() / granularityMs));
}
