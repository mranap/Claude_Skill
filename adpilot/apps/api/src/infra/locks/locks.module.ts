import { Global, Module } from '@nestjs/common';
import { LockService } from './lock.service';
import { RateLimiterService } from './rate-limiter.service';

@Global()
@Module({
  providers: [LockService, RateLimiterService],
  exports: [LockService, RateLimiterService],
})
export class LocksModule {}
