import { Global, Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { RuleEngineService } from './rule-engine.service';
import { RuleMetricsService } from './rule-metrics.service';

@Global()
@Module({
  controllers: [RulesController],
  providers: [RulesService, RuleEngineService, RuleMetricsService],
  exports: [RuleEngineService],
})
export class RulesModule {}
