import { Global, Module } from '@nestjs/common';
import { SystemLogService } from './system-log.service';

@Global()
@Module({
  providers: [SystemLogService],
  exports: [SystemLogService],
})
export class SystemLogModule {}
