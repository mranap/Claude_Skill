import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AutoRuleJob, QUEUES } from '../../infra/queue/queues';
import { RuleEngineService } from '../../modules/rules/rule-engine.service';
import { MetaApiError } from '../../modules/meta/graph/meta-errors';
import { QueueProcessor } from '../processor';
import { deferJob } from '../job-errors';

/** AUTO_RULE_CHECK: evaluates one rule (lease-protected, see RuleEngineService). */
@Injectable()
export class AutoRulesProcessor implements QueueProcessor {
  readonly queue = QUEUES.AUTO_RULES;

  constructor(private readonly engine: RuleEngineService) {}

  async process(job: Job<AutoRuleJob>, token?: string): Promise<unknown> {
    try {
      return await this.engine.run(job.data.ruleId, { manual: job.data.slot.startsWith('manual') });
    } catch (err) {
      if (err instanceof MetaApiError && err.category === 'RATE_LIMIT')
        return deferJob(job, token, err.details.retryAfterMs ?? 60_000);
      throw err;
    }
  }
}
